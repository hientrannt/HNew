"use strict";
// Lấy tin trực tiếp trên điện thoại (bản app Android). Trong app, CapacitorHttp chuyển
// fetch() sang HTTP gốc của Android nên không bị chặn CORS như trên trình duyệt.
// Logic giống scripts/build.py (bản chạy trên GitHub Actions cho trang web).
const HNewFeeds = (() => {
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  const SUMMARY_MAX = 320;
  const TIMEOUT = 20000;

  const sourceKey = (s) => `${s.name}|${s.category || ""}`;

  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ c, 2246822519);
    }
    return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
  }

  const htmlParser = new DOMParser();
  function clean(raw) {
    if (!raw) return "";
    // DOMParser tạo tài liệu "trơ": không tải ảnh, không chạy script.
    const text = htmlParser.parseFromString(raw, "text/html").body.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  }

  function shorten(text, limit = SUMMARY_MAX) {
    if (text.length <= limit) return text;
    const cut = text.slice(0, limit);
    const dot = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    if (dot > limit * 0.5) return cut.slice(0, dot + 1);
    return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]+$/, "") + "…";
  }

  function parseDate(v) {
    if (!v) return null;
    v = v.trim().replace(/ ([+-]\d{2})$/, " $100"); // CafeF ghi "+07"
    if (!/([+-]\d{2}:?\d{2}|GMT|UTC|Z)$/i.test(v)) v += " +0700"; // không có múi giờ: giờ VN
    const t = Date.parse(v.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2").replace(/T(.*) \+0700$/, "T$1+07:00"));
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  async function fetchText(url, retries = 1) {
    try {
      const res = await Promise.race([
        fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/html, */*" } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Hết thời gian chờ")), TIMEOUT)),
      ]);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      if (retries <= 0) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      return fetchText(url, retries - 1);
    }
  }

  const child = (el, ...names) => {
    for (const n of names) {
      for (const c of el.children) if (c.nodeName === n && c.textContent.trim()) return c;
    }
    return null;
  };
  const childText = (el, ...names) => child(el, ...names)?.textContent.trim() || "";

  function parseRss(text, src) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("RSS lỗi định dạng");
    let entries = [...doc.getElementsByTagName("item")];
    const atom = !entries.length;
    if (atom) entries = [...doc.getElementsByTagName("entry")];

    const out = [];
    for (const it of entries) {
      let link, title, descRaw, date;
      if (atom) {
        const links = [...it.getElementsByTagName("link")];
        const alt = links.find((l) => (l.getAttribute("rel") || "alternate") === "alternate") || links[0];
        link = alt?.getAttribute("href") || "";
        title = childText(it, "title");
        descRaw = childText(it, "summary", "content");
        date = parseDate(childText(it, "published", "updated"));
      } else {
        link = childText(it, "link", "guid");
        title = childText(it, "title");
        descRaw = childText(it, "description");
        date = parseDate(childText(it, "pubDate", "dc:date"));
      }
      const contentRaw = childText(it, "content:encoded");
      let image = "";
      for (const tag of ["media:thumbnail", "media:content", "enclosure"]) {
        const m = it.getElementsByTagName(tag)[0];
        if (m?.getAttribute("url")) { image = m.getAttribute("url"); break; }
      }
      if (!image) {
        const m = /<img[^>]+src=["']([^"']+)/i.exec(descRaw + " " + contentRaw);
        if (m) image = clean(m[1]) || m[1];
      }
      title = clean(title);
      link = link.trim();
      if (!title || !/^https?:/.test(link)) continue;
      let desc = clean(descRaw) || clean(contentRaw);
      if (desc.toLowerCase().startsWith(title.toLowerCase())) desc = desc.slice(title.length).replace(/^[ .:-]+/, "");
      out.push({
        id: hash(link), title, link, summary: shorten(desc), image,
        source: src.name, category: src.category || "", published: date,
      });
    }
    return out;
  }

  function parseBaomoi(text, src) {
    const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(text);
    if (!m) return [];
    const found = [];
    (function walk(o) {
      if (Array.isArray(o)) { for (const v of o) walk(v); return; }
      if (!o || typeof o !== "object") return;
      if (o.title && o.contentId && (o.redirectUrl || o.url)) { found.push(o); return; }
      for (const v of Object.values(o)) walk(v);
    })(JSON.parse(m[1]));

    const seen = new Set(), out = [];
    for (const o of found) {
      if (seen.has(o.contentId)) continue;
      seen.add(o.contentId);
      const path = (o.redirectUrl || o.url).split("#")[0];
      const link = path.startsWith("/") ? "https://baomoi.com" + path : path;
      const ts = parseInt(o.date, 10);
      out.push({
        id: hash(link), title: clean(o.title), link, summary: shorten(clean(o.description)),
        image: o.thumb || "", source: src.name, publisher: o.publisher?.name || "",
        category: src.category || "", published: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null,
      });
    }
    return out;
  }

  const PARSERS = { rss: parseRss, baomoi: parseBaomoi };

  async function fetchSource(src, perSource) {
    const parse = PARSERS[src.type || "rss"];
    let items = parse(await fetchText(src.url), src);
    if (!items.length) items = parse(await fetchText(src.url), src); // feed rỗng tạm thời
    items.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
    return items.slice(0, perSource);
  }

  /** Lấy tất cả nguồn đang bật. onSource(src, items, error) được gọi khi từng nguồn xong. */
  async function fetchAll(config, isEnabled, onSource) {
    const perSource = config.max_items_per_source || 25;
    const maxAge = (config.max_age_hours || 48) * 3600e3;
    const sources = config.sources.filter((s) => s.enabled !== false && isEnabled(sourceKey(s)));
    const results = [];
    let next = 0;
    async function worker() {
      while (next < sources.length) {
        const src = sources[next++];
        try {
          const items = await fetchSource(src, perSource);
          results.push({ src, items });
          onSource?.(src, items, null);
        } catch (e) {
          results.push({ src, items: [], error: String(e.message || e) });
          onSource?.(src, [], e);
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));

    // Giữ thứ tự nguồn trong sources.json để tin trùng được gán cho chuyên mục đầu tiên.
    results.sort((a, b) => sources.indexOf(a.src) - sources.indexOf(b.src));
    const seen = new Set(), items = [], now = Date.now();
    for (const { items: got } of results) {
      for (const it of got) {
        if (seen.has(it.link)) continue;
        if (it.published && now - Date.parse(it.published) > maxAge) continue;
        seen.add(it.link);
        items.push(it);
      }
    }
    items.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
    return {
      generated: new Date().toISOString(),
      items,
      sources: results.map((r) => ({ name: r.src.name, category: r.src.category || "", ok: !r.error, count: r.items.length, error: r.error })),
    };
  }

  /** Link Báo Mới -> link bài gốc trên trang báo (đọc "originalUrl" trong trang). */
  async function resolveOriginal(link) {
    const text = await fetchText(link, 0);
    const m = /"originalUrl":"(https?:[^"]+)"/.exec(text);
    return m ? m[1].replace(/\\u002F/gi, "/").replace(/\\\//g, "/") : null;
  }

  // ---------- Tự dò nguồn mới từ địa chỉ trang báo hoặc link RSS ----------
  const COMMON_PATHS = ["/rss/home.rss", "/rss/tin-moi-nhat.rss", "/home.rss", "/rss.xml", "/rss", "/feed", "/feed.xml",
    "/index.rss", "/trang-chu.rss", "/tin-moi.rss", "/rss/trang-chu.rss"];
  const looksXml = (t) => /^\s*(<\?xml|<rss|<feed|<rdf)/i.test(t) || /<rss[\s>]|<feed[\s>]/i.test(t.slice(0, 2000));
  const abs = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };

  function feedTitle(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const t = doc.querySelector("channel > title, feed > title")?.textContent || "";
    return clean(t);
  }
  // Tên chuẩn của các báo hay gặp (theo tên miền).
  const KNOWN = {
    "vnexpress.net": "VnExpress", "tuoitre.vn": "Tuổi Trẻ", "thanhnien.vn": "Thanh Niên", "dantri.com.vn": "Dân Trí",
    "tienphong.vn": "Tiền Phong", "nhandan.vn": "Nhân Dân", "vietnamplus.vn": "VietnamPlus", "laodong.vn": "Lao Động",
    "genk.vn": "GenK", "kenh14.vn": "Kênh 14", "cafef.vn": "CafeF", "cafebiz.vn": "CafeBiz", "vneconomy.vn": "VnEconomy",
    "vietstock.vn": "Vietstock", "nld.com.vn": "Người Lao Động", "vtv.vn": "VTV", "soha.vn": "Soha", "tinhte.vn": "Tinh tế",
    "baomoi.com": "Báo Mới", "bbc.co.uk": "BBC Tiếng Việt", "bbc.com": "BBC Tiếng Việt", "znews.vn": "Znews",
    "vietnamnet.vn": "VietnamNet", "24h.com.vn": "24h", "plo.vn": "Pháp Luật TP.HCM", "sggp.org.vn": "Sài Gòn Giải Phóng",
    "vov.vn": "VOV", "baochinhphu.vn": "Báo Chính phủ", "afamily.vn": "aFamily", "ndh.vn": "NDH", "vnreview.vn": "VnReview",
  };
  const GENERIC = /^(feed|rss|home|trang chủ|tin mới( nhất)?|mới nhất|news|latest)$/i;
  function knownName(url) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const [d, n] of Object.entries(KNOWN)) if (host === d || host.endsWith("." + d)) return n;
    return null;
  }
  /** Đoán {name, category} từ link và tiêu đề feed. */
  function guessName(url, title) {
    const parts = (title || "").split(/\s+[-|–:»]\s+/).map((s) => s.replace(/\bRSS\b/gi, "").trim()).filter((s) => s && !GENERIC.test(s));
    const known = knownName(url);
    if (known) {
      // Tiêu đề kiểu "Thể thao - VnExpress RSS" -> chuyên mục "Thể thao".
      const cat = parts.find((p) => !norm(p).includes(norm(known)) && !norm(known).includes(norm(p)) && p.length <= 25 && !/báo|điện tử|online|news/i.test(p));
      return { name: known, category: cat || "" };
    }
    const short = [...parts].sort((a, b) => a.length - b.length)[0];
    if (short && short.length <= 30) return { name: short, category: "" };
    const host = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
    return { name: host.charAt(0).toUpperCase() + host.slice(1), category: "" };
  }
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();

  async function tryFeed(url) {
    const text = await fetchText(url, 0);
    if (!looksXml(text)) return { html: text };
    const items = parseRss(text, { name: "", category: "" });
    return items.length ? { url, items, title: feedTitle(text) } : {};
  }

  /** Tìm nguồn tin từ thứ người dùng nhập. Trả về {url, type, name, category, items} hoặc ném lỗi. */
  async function discover(input) {
    let url = input.trim();
    if (!url) throw new Error("Hãy nhập địa chỉ trang báo hoặc link RSS");
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    let u;
    try { u = new URL(url); } catch { throw new Error("Địa chỉ không hợp lệ"); }

    if (/(^|\.)baomoi\.com$/i.test(u.hostname)) {
      const html = await fetchText(url);
      const items = parseBaomoi(html, { name: "Báo Mới", category: "" });
      if (!items.length) throw new Error("Không đọc được tin từ trang Báo Mới này");
      const cat = clean(/<title>([^<]+)<\/title>/i.exec(html)?.[1] || "").split(/\s+[-|]\s+/)[0].trim();
      return { url, type: "baomoi", name: "Báo Mới", category: cat.length <= 25 && !/báo mới/i.test(cat) ? cat : "", items };
    }

    const tried = new Set();
    const attempt = async (cand) => {
      if (!cand || tried.has(cand)) return null;
      tried.add(cand);
      try { return await tryFeed(cand); } catch { return null; }
    };

    // 1) Chính là link RSS?  2) Trang có khai báo RSS?  3) Thử các đường dẫn RSS hay gặp.
    const first = await attempt(url);
    if (first?.items) return { url, type: "rss", ...guessName(url, first.title), items: first.items };
    const candidates = [];
    if (first?.html) {
      const re = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi;
      for (const tag of first.html.match(re) || []) {
        const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
        if (href) candidates.push(abs(href.replace(/&amp;/g, "&"), url));
      }
      // Trang liệt kê RSS (vd. /rss): lấy các link .rss trong trang.
      for (const m of first.html.matchAll(/href=["']([^"']+\.(?:rss|xml))["']/gi)) candidates.push(abs(m[1].replace(/&amp;/g, "&"), url));
    }
    for (const p of COMMON_PATHS) candidates.push(u.origin + p);
    for (const cand of candidates.slice(0, 24)) {
      const r = await attempt(cand);
      if (r?.items) return { url: cand, type: "rss", ...guessName(cand, r.title), items: r.items };
    }
    throw new Error("Không tìm thấy RSS ở trang này. Hãy thử dán trực tiếp link RSS của báo.");
  }

  return { fetchAll, resolveOriginal, sourceKey, discover };
})();
