#!/usr/bin/env python3
"""Tải RSS từ các nguồn trong sources.json, tóm tắt từng tin và ghi ra docs/data/news.json.

Tóm tắt:
  - Mặc định dùng phần "sapo" (mô tả) mà báo cung cấp trong RSS, đã làm sạch HTML.
  - Nếu có biến môi trường ANTHROPIC_API_KEY và đã cài gói `anthropic`, Claude sẽ
    viết lại thành 1-2 câu tóm tắt ngắn gọn bằng tiếng Việt.

Chạy:  python3 scripts/build.py
"""
from __future__ import annotations

import concurrent.futures as cf
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources.json"
OUT = ROOT / "docs" / "data" / "news.json"
# UA máy tính: một số báo (VnExpress, Báo Mới) trả nội dung khác/rỗng cho UA di động.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SUMMARY_MAX_CHARS = 320
CLAUDE_MODEL = os.environ.get("HNEW_MODEL", "claude-opus-5-5")

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
}


def fetch(url: str, retries: int = 1) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, */*"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read()
    except OSError:
        if retries <= 0:
            raise
        time.sleep(2)
        return fetch(url, retries - 1)


def clean_text(raw: str | None) -> str:
    if not raw:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def first_image(*chunks: str | None) -> str:
    for c in chunks:
        if c:
            m = re.search(r"<img[^>]+src=[\"']([^\"']+)", c)
            if m:
                return html.unescape(m.group(1))
    return ""


def shorten(text: str, limit: int = SUMMARY_MAX_CHARS) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    # Ưu tiên cắt ở cuối câu, nếu không thì ở khoảng trắng.
    dot = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if dot > limit * 0.5:
        return cut[: dot + 1]
    return cut[: cut.rfind(" ")].rstrip(",;:") + "…"


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    value = re.sub(r" ([+-]\d{2})$", r" \g<1>00", value)  # CafeF ghi múi giờ "+07"
    try:
        d = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        d = None
    if d is None:
        try:
            d = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone(timedelta(hours=7)))  # báo VN thường dùng giờ VN
    return d.astimezone(timezone.utc)


def child_text(el: ET.Element, *paths: str) -> str:
    for p in paths:
        c = el.find(p, NS)
        if c is not None and (c.text or "").strip():
            return c.text.strip()
    return ""


def parse_feed(data: bytes, source: dict) -> list[dict]:
    root = ET.fromstring(data)
    items = root.findall("./channel/item") or root.findall(".//item")
    is_atom = False
    if not items:
        items = root.findall("atom:entry", NS)
        is_atom = True

    out = []
    for it in items:
        if is_atom:
            link_el = it.find("atom:link[@rel='alternate']", NS)
            if link_el is None:
                link_el = it.find("atom:link", NS)
            link = link_el.get("href", "") if link_el is not None else ""
            title = child_text(it, "atom:title")
            desc_raw = child_text(it, "atom:summary", "atom:content")
            date = parse_date(child_text(it, "atom:published", "atom:updated"))
        else:
            link = child_text(it, "link", "guid")
            title = child_text(it, "title")
            desc_raw = child_text(it, "description")
            date = parse_date(child_text(it, "pubDate", "{http://purl.org/dc/elements/1.1/}date"))
        content_raw = child_text(it, "content:encoded")

        image = ""
        for tag in ("media:thumbnail", "media:content", "enclosure"):
            m = it.find(tag, NS)
            if m is not None and m.get("url"):
                image = m.get("url")
                break
        image = image or first_image(desc_raw, content_raw)

        title = clean_text(title)
        link = link.strip()
        if not title or not link.startswith("http"):
            continue
        desc = clean_text(desc_raw) or clean_text(content_raw)
        if desc.lower().startswith(title.lower()):
            desc = desc[len(title):].lstrip(" .:-")

        out.append({
            "id": hashlib.sha1(link.encode()).hexdigest()[:12],
            "title": title,
            "link": link,
            "summary": shorten(desc),
            "image": image,
            "source": source["name"],
            "category": source.get("category", ""),
            "published": date.isoformat() if date else None,
        })
    return out


def parse_baomoi(data: bytes, source: dict) -> list[dict]:
    """Báo Mới không có RSS: đọc dữ liệu __NEXT_DATA__ nhúng trong trang."""
    m = re.search(rb'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', data, re.S)
    if not m:
        return []
    found: list[dict] = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("title") and o.get("contentId") and (o.get("redirectUrl") or o.get("url")):
                found.append(o)
                return
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(json.loads(m.group(1)))
    out, ids = [], set()
    for o in found:
        if o["contentId"] in ids:
            continue
        ids.add(o["contentId"])
        # redirectUrl (/...-rNNN.epi) chuyển thẳng tới bài gốc trên trang báo.
        path = (o.get("redirectUrl") or o["url"]).split("#")[0]
        link = "https://baomoi.com" + path if path.startswith("/") else path
        pub = o.get("publisher") if isinstance(o.get("publisher"), dict) else {}
        try:
            date = datetime.fromtimestamp(int(o.get("date")), timezone.utc)
        except (TypeError, ValueError):
            date = None
        out.append({
            "id": hashlib.sha1(link.encode()).hexdigest()[:12],
            "title": clean_text(o["title"]),
            "link": link,
            "summary": shorten(clean_text(o.get("description"))),
            "image": o.get("thumb") or "",
            "source": source["name"],
            "publisher": pub.get("name", ""),
            "category": source.get("category", ""),
            "published": date.isoformat() if date else None,
        })
    out.sort(key=lambda i: i["published"] or "", reverse=True)
    return out


def resolve_baomoi_links(items: list[dict], previous: dict[str, dict]) -> None:
    """Đổi link Báo Mới thành link bài gốc trên trang báo (có cache theo id)."""
    todo = []
    for it in items:
        if "baomoi.com" not in it["link"]:
            continue
        prev = previous.get(it["id"])
        if prev and prev.get("original"):
            it["link"] = it["original"] = prev["original"]
        else:
            todo.append(it)

    def resolve(it):
        try:
            m = re.search(rb'"originalUrl":"(https?://[^"]+)"', fetch(it["link"]))
            return it, m.group(1).decode() if m else None
        except Exception:
            return it, None

    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        for it, url in pool.map(resolve, todo):
            if url:
                it["link"] = it["original"] = url


PARSERS = {"rss": parse_feed, "baomoi": parse_baomoi}


def load_previous() -> dict[str, dict]:
    """Bản news.json lần trước (để không phải tóm tắt/giải link lại). Trên GitHub Actions
    lấy từ trang đã triển khai qua HNEW_PREVIOUS_URL, còn chạy máy thì đọc file local."""
    try:
        url = os.environ.get("HNEW_PREVIOUS_URL")
        raw = fetch(url) if url else OUT.read_bytes()
        return {i["id"]: i for i in json.loads(raw)["items"]}
    except (OSError, ValueError, KeyError):
        return {}


def claude_summarize(items: list[dict], previous: dict[str, dict]) -> None:
    """Viết lại tóm tắt bằng Claude cho các tin chưa có tóm tắt AI (cache theo id)."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return
    try:
        import anthropic
    except ImportError:
        print("! Chưa cài gói anthropic, bỏ qua tóm tắt AI", file=sys.stderr)
        return

    todo = []
    for it in items:
        prev = previous.get(it["id"])
        if prev and prev.get("ai"):
            it["summary"], it["ai"] = prev["summary"], True
        else:
            todo.append(it)
    if not todo:
        return

    client = anthropic.Anthropic()
    system = (
        "Bạn là biên tập viên tóm tắt tin tức. Với mỗi tin, viết 1-2 câu tiếng Việt "
        "(tối đa khoảng 45 từ) nêu ý chính: ai, cái gì, con số quan trọng. "
        "Chỉ dùng thông tin có trong tiêu đề và mô tả, không suy đoán. "
        "Trả về JSON dạng {\"<id>\": \"<tóm tắt>\"} và không có gì khác."
    )
    for start in range(0, len(todo), 30):
        batch = todo[start:start + 30]
        payload = [{"id": i["id"], "title": i["title"], "description": i["summary"]} for i in batch]
        try:
            resp = client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=16000,
                output_config={"effort": "low"},
                system=system,
                messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            )
        except anthropic.RateLimitError as e:
            print(f"! Claude bị giới hạn tốc độ, dừng tóm tắt AI: {e}", file=sys.stderr)
            return
        except anthropic.APIStatusError as e:
            print(f"! Lỗi API Claude ({e.status_code}), bỏ qua lô này", file=sys.stderr)
            continue
        except anthropic.APIConnectionError as e:
            print(f"! Không kết nối được Claude: {e}", file=sys.stderr)
            return
        if resp.stop_reason == "refusal":
            continue
        text = "".join(b.text for b in resp.content if b.type == "text")
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            continue
        try:
            result = json.loads(m.group(0))
        except ValueError:
            continue
        for it in batch:
            s = (result.get(it["id"]) or "").strip()
            if s:
                it["summary"], it["ai"] = s, True


def main() -> int:
    cfg = json.loads(SOURCES.read_text("utf-8"))
    per_source = int(cfg.get("max_items_per_source", 25))
    max_age = timedelta(hours=float(cfg.get("max_age_hours", 48)))
    now = datetime.now(timezone.utc)

    def work(src):
        try:
            parse = PARSERS[src.get("type", "rss")]
            got = parse(fetch(src["url"]), src)
            if not got:  # đôi khi báo trả về feed rỗng tạm thời, thử lại một lần
                got = parse(fetch(src["url"]), src)
            return src, got[:per_source], None
        except Exception as e:  # một nguồn lỗi không làm hỏng cả trang
            return src, [], e

    items, seen, status = [], set(), []
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        sources = [s for s in cfg["sources"] if s.get("enabled", True)]
        for src, got, err in pool.map(work, sources):
            if err:
                print(f"! {src['name']} ({src['url']}): {err}", file=sys.stderr)
            status.append({"name": src["name"], "category": src.get("category", ""), "ok": err is None, "count": len(got)})
            for it in got:
                if it["link"] in seen:
                    continue
                if it["published"] and now - datetime.fromisoformat(it["published"]) > max_age:
                    continue
                seen.add(it["link"])
                items.append(it)

    items.sort(key=lambda i: i["published"] or "", reverse=True)
    previous = load_previous()
    resolve_baomoi_links(items, previous)
    claude_summarize(items, previous)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated": now.isoformat(),
        "sources": status,
        "items": items,
    }, ensure_ascii=False, indent=1), "utf-8")
    print(f"Đã ghi {len(items)} tin từ {sum(s['ok'] for s in status)}/{len(status)} nguồn -> {OUT.relative_to(ROOT)}")
    return 0 if items else 1


if __name__ == "__main__":
    sys.exit(main())
