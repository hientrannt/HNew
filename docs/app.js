"use strict";

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem("hnew:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("hnew:" + k, JSON.stringify(v)); } catch {} },
};

const state = {
  items: [],
  source: store.get("source", ""),
  category: store.get("category", ""),
  compact: store.get("compact", true),
  unreadOnly: store.get("unreadOnly", false),
  query: "",
  read: new Set(store.get("read", [])),
};

const rtf = new Intl.RelativeTimeFormat("vi", { numeric: "auto" });
function ago(iso) {
  if (!iso) return "";
  const s = (new Date(iso) - Date.now()) / 1000;
  if (s > -60) return "vừa xong";
  if (s > -3600) return rtf.format(Math.round(s / 60), "minute");
  if (s > -86400) return rtf.format(Math.round(s / 3600), "hour");
  return new Date(iso).toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" });
}
function dayLabel(iso) {
  if (!iso) return "Không rõ thời gian";
  const d = new Date(iso), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hôm nay";
  if (d.toDateString() === y.toDateString()) return "Hôm qua";
  return d.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "numeric" });
}
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

function chips(el, values, current, onPick, counts) {
  el.replaceChildren(...["", ...values].map((v) => {
    const b = document.createElement("button");
    b.textContent = v || "Tất cả";
    if (counts && v) { const n = document.createElement("span"); n.className = "n"; n.textContent = counts[v] || 0; b.append(n); }
    b.className = v === current ? "on" : "";
    b.onclick = () => onPick(v);
    return b;
  }));
  el.hidden = values.length < 2;
}

function filtered() {
  const q = norm(state.query.trim());
  return state.items.filter((i) =>
    (!state.source || i.source === state.source) &&
    (!state.category || i.category === state.category) &&
    (!state.unreadOnly || !state.read.has(i.id)) &&
    (!q || norm(i.title + " " + i.summary).includes(q)));
}

function render() {
  document.body.classList.toggle("compact", state.compact);
  $("#btn-density").setAttribute("aria-pressed", state.compact);
  $("#btn-unread").setAttribute("aria-pressed", state.unreadOnly);

  const unread = (arr) => arr.filter((i) => !state.read.has(i.id)).length;
  const bySource = {}, byCat = {};
  for (const i of state.items) (bySource[i.source] ||= []).push(i);
  const inSource = state.items.filter((i) => !state.source || i.source === state.source);
  for (const i of inSource) if (i.category) (byCat[i.category] ||= []).push(i);
  const srcCounts = Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, unread(v)]));
  const catCounts = Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, unread(v)]));

  chips($("#sources"), Object.keys(bySource), state.source, (v) => {
    state.source = v; state.category = ""; store.set("source", v); store.set("category", ""); render(); scrollTo(0, 0);
  }, srcCounts);
  chips($("#categories"), Object.keys(byCat), state.category, (v) => {
    state.category = v; store.set("category", v); render(); scrollTo(0, 0);
  }, catCounts);

  const list = $("#list"), tpl = $("#tpl-item").content, items = filtered();
  const frag = document.createDocumentFragment();
  let lastDay = null;
  for (const it of items) {
    const day = dayLabel(it.published);
    if (day !== lastDay) {
      const h = document.createElement("h3"); h.className = "day"; h.textContent = day; frag.append(h); lastDay = day;
    }
    const node = tpl.cloneNode(true), art = node.querySelector(".item"), a = node.querySelector("a");
    a.href = it.link;
    a.dataset.id = it.id;
    node.querySelector(".src").textContent = it.publisher ? `${it.source} · ${it.publisher}` : it.source;
    node.querySelector(".cat").textContent = state.source ? it.category : "";
    const t = node.querySelector("time"); t.dateTime = it.published || ""; t.textContent = ago(it.published);
    node.querySelector(".title").textContent = it.title;
    node.querySelector(".summary").textContent = it.summary;
    const img = node.querySelector(".thumb");
    if (it.image) { img.src = it.image; img.onerror = () => { img.hidden = true; }; } else img.hidden = true;
    if (state.read.has(it.id)) art.classList.add("read");
    frag.append(node);
  }
  if (!items.length) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = state.items.length ? "Không có tin phù hợp." : "Chưa có tin.";
    frag.append(p);
  }
  list.replaceChildren(frag);
}

// Đánh dấu đã đọc khi bấm vào tin (link vẫn mở trang báo gốc).
$("#list").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-id]");
  if (!a) return;
  state.read.add(a.dataset.id);
  store.set("read", [...state.read].slice(-3000));
  a.closest(".item").classList.add("read");
});

$("#btn-density").onclick = () => { state.compact = !state.compact; store.set("compact", state.compact); render(); };
$("#btn-unread").onclick = () => { state.unreadOnly = !state.unreadOnly; store.set("unreadOnly", state.unreadOnly); render(); };
$("#btn-refresh").onclick = () => load(true);
$("#btn-search").onclick = () => {
  const s = $("#search"); s.hidden = !s.hidden;
  if (!s.hidden) s.focus(); else { s.value = ""; state.query = ""; render(); }
};
$("#search").addEventListener("input", (e) => { state.query = e.target.value; render(); });

async function load(force) {
  const btn = $("#btn-refresh"); btn.disabled = true;
  try {
    const r = await fetch("data/news.json" + (force ? "?t=" + Date.now() : ""), { cache: force ? "reload" : "no-cache" });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    state.items = data.items || [];
    $("#updated").textContent = "cập nhật " + ago(data.generated);
    // Bỏ lọc đã lưu nếu nguồn/chuyên mục không còn tồn tại.
    if (state.source && !state.items.some((i) => i.source === state.source)) state.source = "";
    if (state.category && !state.items.some((i) => i.category === state.category)) state.category = "";
    render();
  } catch (e) {
    if (!state.items.length) $("#list").innerHTML = '<p class="empty">Không tải được tin. Kiểm tra kết nối rồi bấm ↻.</p>';
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
load();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
