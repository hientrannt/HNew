"use strict";

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem("hnews:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("hnews:" + k, JSON.stringify(v)); } catch {} },
};

// ---- Chạy trong app Android (Capacitor) hay trên trình duyệt? ----
const Cap = window.Capacitor;
const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plugin = (name) => (NATIVE ? (window.capacitorExports?.registerPlugin || Cap.registerPlugin)(name) : null);
const Browser = plugin("Browser");
const App = plugin("App");
const SystemBars = plugin("SystemBars");
const VERSION = "1.1.0";

const state = {
  items: [],
  meta: null,
  config: null,
  source: store.get("source", ""),
  category: store.get("category", ""),
  compact: store.get("compact", true),
  unreadOnly: store.get("unreadOnly", false),
  theme: store.get("theme", "auto"),
  size: store.get("size", "m"),
  off: new Set(store.get("off", [])),
  query: "",
  read: new Set(store.get("read", [])),
  loading: false,
  lastRefresh: store.get("lastRefresh", 0),
};
const keyOf = (i) => `${i.source}|${i.category || ""}`;
const saveRead = () => store.set("read", [...state.read].slice(-4000));

// ---------- Định dạng ----------
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
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function updateDateline() {
  const narrow = innerWidth < 500; // màn hình ngoài của Fold: dòng ngày ngắn gọn
  const today = cap1(new Date().toLocaleDateString("vi-VN", narrow
    ? { weekday: "long", day: "numeric", month: "numeric" }
    : { weekday: "long", day: "numeric", month: "numeric", year: "numeric" }));
  $("#dateline").textContent = state.meta?.generated && !narrow ? `${today} · cập nhật ${ago(state.meta.generated)}` : today;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- Giao diện: chủ đề, cỡ chữ ----------
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "auto") delete root.dataset.theme; else root.dataset.theme = state.theme;
  root.dataset.size = state.size;
  const dark = state.theme === "dark" || (state.theme === "auto" && darkMQ.matches);
  // "DARK" = chữ/biểu tượng sáng trên thanh trạng thái (cho nền tối).
  SystemBars?.setStyle({ style: dark ? "DARK" : "LIGHT" }).catch(() => {});
}
darkMQ.addEventListener?.("change", applyTheme);

// ---------- Vẽ danh sách ----------
function chips(el, values, current, onPick, counts) {
  el.replaceChildren(...["", ...values].map((v) => {
    const b = document.createElement("button");
    b.textContent = v || "Tất cả";
    if (counts && v && counts[v]) { const n = document.createElement("span"); n.className = "n"; n.textContent = counts[v]; b.append(n); }
    b.className = v === current ? "on" : "";
    b.onclick = () => onPick(v);
    return b;
  }));
  el.hidden = values.length < 2;
}

const visibleItems = () => state.items.filter((i) => !state.off.has(keyOf(i)));

function filtered() {
  const q = norm(state.query.trim());
  return visibleItems().filter((i) =>
    (!state.source || i.source === state.source) &&
    (!state.category || i.category === state.category) &&
    (!state.unreadOnly || !state.read.has(i.id)) &&
    (!q || norm(i.title + " " + i.summary + " " + (i.publisher || "")).includes(q)));
}

function skeleton(n = 8) {
  const frag = document.createDocumentFragment();
  for (let k = 0; k < n; k++) {
    const a = document.createElement("article");
    a.className = "item skel";
    a.innerHTML = '<div class="body"><div class="bone s"></div><div class="bone t"></div><div class="bone"></div><div class="bone s"></div></div>';
    frag.append(a);
  }
  return frag;
}

function emptyState(title, text) {
  const p = document.createElement("p"); p.className = "empty";
  const b = document.createElement("b"); b.textContent = title;
  p.append(b, text);
  return p;
}

function render() {
  document.body.classList.toggle("compact", state.compact);
  $("#btn-unread").setAttribute("aria-pressed", state.unreadOnly);
  $("#btn-density use").setAttribute("href", state.compact ? "#i-cards" : "#i-list");
  $("#btn-density").setAttribute("aria-label", state.compact ? "Xem dạng thẻ ảnh" : "Xem dạng danh sách");

  const all = visibleItems();
  const unread = (arr) => arr.filter((i) => !state.read.has(i.id)).length;
  const bySource = {}, byCat = {};
  for (const i of all) (bySource[i.source] ||= []).push(i);
  for (const i of all) if ((!state.source || i.source === state.source) && i.category) (byCat[i.category] ||= []).push(i);
  if (state.source && !bySource[state.source]) state.source = "";
  if (state.category && !byCat[state.category]) state.category = "";
  const counts = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, unread(v)]));

  chips($("#sources"), Object.keys(bySource), state.source, (v) => {
    state.source = v; state.category = ""; store.set("source", v); store.set("category", ""); render(); scrollTo(0, 0);
  }, counts(bySource));
  chips($("#categories"), Object.keys(byCat), state.category, (v) => {
    state.category = v; store.set("category", v); render(); scrollTo(0, 0);
  }, counts(byCat));

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
    node.querySelector(".cat").textContent = state.source && !state.category ? it.category : "";
    const t = node.querySelector("time"); t.dateTime = it.published || ""; t.textContent = ago(it.published);
    node.querySelector(".title").textContent = it.title;
    node.querySelector(".summary").textContent = it.summary;
    const img = node.querySelector(".thumb");
    if (it.image) { img.src = it.image; img.onerror = () => { img.hidden = true; }; } else img.hidden = true;
    if (state.read.has(it.id)) art.classList.add("read");
    frag.append(node);
  }
  if (!items.length) {
    if (state.loading && !state.items.length) frag.append(skeleton());
    else if (!state.items.length) frag.append(emptyState("Chưa có tin", "Kiểm tra kết nối mạng rồi kéo xuống để tải lại."));
    else if (state.query) frag.append(emptyState("Không tìm thấy", `Không có tin nào khớp “${state.query}”.`));
    else if (state.unreadOnly) frag.append(emptyState("Đã đọc hết!", "Bạn đã đọc tất cả tin trong mục này."));
    else frag.append(emptyState("Không có tin", "Hãy bật thêm nguồn tin trong Cài đặt."));
  }
  list.replaceChildren(frag);

  const m = state.meta;
  $("#footer").textContent = m
    ? `${all.length} tin · ${new Set(all.map((i) => i.source)).size} báo · cập nhật lúc ${new Date(m.generated).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
    : "";
  updateDateline();
}

// Cập nhật "x phút trước" mỗi phút mà không vẽ lại cả danh sách.
setInterval(() => {
  for (const t of document.querySelectorAll("#list time")) t.textContent = ago(t.dateTime);
  updateDateline();
}, 60000);

// ---------- Giữ vị trí đang đọc (gập/mở Fold, tải lại tin, mở lại app) ----------
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
let anchor = store.get("anchor", null);
const headerH = () => $(".top").getBoundingClientRect().bottom;
function captureAnchor() {
  const top = headerH();
  for (const a of document.querySelectorAll("#list a[data-id]")) {
    const r = a.getBoundingClientRect();
    if (r.bottom > top + 4) {
      anchor = { id: a.dataset.id, offset: r.top - top, at: Date.now() };
      store.set("anchor", anchor);
      return;
    }
  }
}
function restoreAnchor() {
  if (!anchor) return;
  const a = document.querySelector(`#list a[data-id="${CSS.escape(anchor.id)}"]`);
  if (a) scrollBy(0, a.getBoundingClientRect().top - headerH() - anchor.offset);
}
let scrollTimer;
addEventListener("scroll", () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(captureAnchor, 120);
  if (scrollY < 80) $("#newpill").hidden = true;
}, { passive: true });
let lastWidth = innerWidth;
new ResizeObserver(() => {
  if (innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  updateDateline();
  restoreAnchor();
  requestAnimationFrame(restoreAnchor);
}).observe(document.documentElement);
addEventListener("pagehide", captureAnchor);

// ---------- Dữ liệu ----------
async function loadConfig() {
  if (state.config) return state.config;
  const r = await fetch("sources.json", { cache: "no-cache" });
  state.config = await r.json();
  return state.config;
}

function setData(data, { initial = false, manual = false } = {}) {
  const before = new Set(state.items.map((i) => i.id));
  if (!initial) captureAnchor();
  state.items = data.items || [];
  state.meta = data;
  render();
  if (!initial || (anchor && Date.now() - anchor.at < 12 * 3600e3)) restoreAnchor();
  if (initial || !before.size) return;
  const fresh = visibleItems().filter((i) => !before.has(i.id)).length;
  if (fresh && scrollY > 200) {
    const pill = $("#newpill");
    pill.querySelector("span").textContent = `${fresh} tin mới`;
    pill.hidden = false;
  } else if (fresh) toast(`Đã cập nhật · ${fresh} tin mới`);
  else if (manual) toast("Chưa có tin mới");
}

function setLoading(on, pct) {
  state.loading = on;
  $("#btn-refresh").disabled = on;
  const bar = $("#progress");
  bar.hidden = !on;
  bar.firstElementChild.style.width = (pct ?? (on ? 10 : 100)) + "%";
  $("#ptr").classList.toggle("spin", on);
  if (!on) hidePtr();
}

async function refresh({ manual = false } = {}) {
  if (state.loading) return;
  setLoading(true);
  if (!state.items.length) render(); // hiện khung chờ
  try {
    if (NATIVE) {
      // App Android: lấy tin trực tiếp từ các báo ngay trên máy.
      const cfg = await loadConfig();
      const total = cfg.sources.filter((s) => s.enabled !== false && !state.off.has(HNewFeeds.sourceKey(s))).length || 1;
      let done = 0;
      const data = await HNewFeeds.fetchAll(cfg, (k) => !state.off.has(k), () => setLoading(true, 10 + (90 * ++done) / total));
      if (!data.items.length && state.items.length) throw new Error("Không lấy được tin");
      store.set("cache", data);
      setData(data, { manual });
    } else {
      // Bản web: dữ liệu do GitHub Actions tạo sẵn.
      const r = await fetch("data/news.json" + (manual ? "?t=" + Date.now() : ""), { cache: manual ? "reload" : "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (data.generated !== state.meta?.generated) setData(data, { manual });
      else if (manual) toast("Chưa có tin mới");
    }
    state.lastRefresh = Date.now();
    store.set("lastRefresh", state.lastRefresh);
  } catch (e) {
    toast(navigator.onLine === false ? "Không có mạng. Đang hiện tin đã lưu." : "Không tải được tin, thử lại sau.");
    if (!state.items.length) render();
  } finally {
    setLoading(false);
  }
}

// ---------- Mở bài báo ----------
const originals = store.get("orig", {});
async function openArticle(it) {
  let url = it.link;
  if (NATIVE && /baomoi\.com\/.*-r\d+\.epi/.test(url)) {
    // Báo Mới -> mở thẳng bài gốc của tờ báo đăng tin.
    url = originals[it.id] || url;
    if (!originals[it.id]) {
      try {
        const real = await Promise.race([HNewFeeds.resolveOriginal(url), new Promise((r) => setTimeout(() => r(null), 2500))]);
        if (real) { url = real; originals[it.id] = real; store.set("orig", Object.fromEntries(Object.entries(originals).slice(-500))); }
      } catch {}
    }
  }
  if (Browser) await Browser.open({ url, toolbarColor: "#B3261E" });
  else window.open(url, "_blank", "noopener");
}

$("#list").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-id]");
  if (!a) return;
  state.read.add(a.dataset.id);
  saveRead();
  a.closest(".item").classList.add("read");
  if (NATIVE) {
    e.preventDefault();
    const it = state.items.find((i) => i.id === a.dataset.id);
    if (it) openArticle(it);
  }
});

// ---------- Nút trên thanh tiêu đề ----------
$("#btn-density").onclick = () => setPref("compact", !state.compact);
$("#btn-unread").onclick = () => {
  state.unreadOnly = !state.unreadOnly; store.set("unreadOnly", state.unreadOnly); render(); scrollTo(0, 0);
  toast(state.unreadOnly ? "Chỉ hiện tin chưa đọc" : "Hiện tất cả tin");
};
$("#btn-refresh").onclick = () => refresh({ manual: true });
$("#btn-search").onclick = () => toggleSearch();
function toggleSearch(force) {
  const box = $("#searchbox"), open = force ?? box.hidden;
  box.hidden = !open;
  $("#btn-search").setAttribute("aria-pressed", open);
  if (open) $("#search").focus();
  else if (state.query) { $("#search").value = ""; state.query = ""; render(); }
}
$("#search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
$("#newpill").onclick = () => { $("#newpill").hidden = true; scrollTo({ top: 0, behavior: "smooth" }); };

// ---------- Kéo xuống để tải lại ----------
const ptr = $("#ptr");
let pull = null;
function hidePtr() { ptr.style.transition = "transform .25s, opacity .25s"; ptr.style.transform = ""; ptr.style.opacity = ""; }
addEventListener("touchstart", (e) => {
  pull = scrollY <= 0 && !state.loading && !$("#settings").open ? { y: e.touches[0].clientY, d: 0 } : null;
}, { passive: true });
addEventListener("touchmove", (e) => {
  if (!pull) return;
  pull.d = Math.max(0, (e.touches[0].clientY - pull.y) * 0.5);
  if (scrollY > 0) { pull = null; hidePtr(); return; }
  ptr.style.transition = "none";
  ptr.style.opacity = Math.min(1, pull.d / 60);
  ptr.style.transform = `translateY(${Math.min(pull.d, 90) - 60}px) rotate(${pull.d * 4}deg)`;
}, { passive: true });
addEventListener("touchend", () => {
  if (!pull) return;
  if (pull.d > 65) { ptr.style.transform = "translateY(0)"; refresh({ manual: true }); }
  else hidePtr();
  pull = null;
});

// ---------- Cài đặt ----------
function setPref(name, value) {
  if (name === "compact") captureAnchor();
  state[name] = value;
  store.set(name, value);
  applyTheme();
  render();
  if (name === "compact") restoreAnchor();
  syncSeg();
}
function syncSeg() {
  for (const seg of document.querySelectorAll(".seg")) {
    const v = String(state[seg.dataset.pref]);
    for (const b of seg.children) b.classList.toggle("on", b.value === v);
  }
}
for (const seg of document.querySelectorAll(".seg")) {
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const name = seg.dataset.pref;
    setPref(name, name === "compact" ? b.value === "true" : b.value);
  });
}

async function renderSourceList() {
  const box = $("#source-list");
  let cfg;
  try { cfg = await loadConfig(); } catch { box.textContent = "Không đọc được danh sách nguồn."; return; }
  const status = new Map((state.meta?.sources || []).map((s) => [`${s.name}|${s.category}`, s]));
  const groups = new Map();
  for (const s of cfg.sources) {
    if (s.enabled === false) continue;
    if (!groups.has(s.name)) groups.set(s.name, []);
    groups.get(s.name).push(s);
  }
  box.replaceChildren(...[...groups].map(([name, list]) => {
    const g = document.createElement("div"); g.className = "src-group";
    const h = document.createElement("h4"); h.textContent = name; g.append(h);
    for (const s of list) {
      const key = HNewFeeds.sourceKey(s), st = status.get(key);
      const label = document.createElement("label");
      const span = document.createElement("span"); span.textContent = s.category || "Tất cả";
      if (st) {
        const small = document.createElement("small");
        small.textContent = st.ok ? `(${st.count})` : "(lỗi)";
        if (!st.ok) small.className = "err";
        span.append(small);
      }
      const sw = document.createElement("input");
      sw.type = "checkbox"; sw.className = "switch"; sw.checked = !state.off.has(key);
      sw.onchange = () => {
        if (sw.checked) state.off.delete(key); else state.off.add(key);
        store.set("off", [...state.off]);
        sourcesChanged = true;
        render();
      };
      label.append(span, sw);
      g.append(label);
    }
    return g;
  }));
}

let sourcesChanged = false;
const dlg = $("#settings");
$("#btn-settings").onclick = () => {
  syncSeg();
  renderSourceList();
  $("#about").textContent = `HNews ${VERSION} · ${NATIVE ? "Ứng dụng Android" : "Bản web"} · Tin thuộc bản quyền của các báo.`;
  sourcesChanged = false;
  dlg.showModal();
};
dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
dlg.addEventListener("close", () => {
  // Bật thêm nguồn trong app -> lấy tin của nguồn đó ngay.
  if (NATIVE && sourcesChanged) {
    const have = new Set(state.items.map(keyOf));
    const cfg = state.config;
    if (cfg?.sources.some((s) => s.enabled !== false && !state.off.has(HNewFeeds.sourceKey(s)) && !have.has(HNewFeeds.sourceKey(s)))) refresh();
  }
});
$("#btn-markall").onclick = () => {
  for (const i of state.items) state.read.add(i.id);
  saveRead(); render(); toast("Đã đánh dấu tất cả là đã đọc");
};
$("#btn-clearread").onclick = () => {
  state.read.clear(); saveRead(); render(); toast("Đã xoá lịch sử đã đọc");
};

// ---------- Vòng đời app ----------
const STALE = 10 * 60e3; // tự cập nhật nếu tin cũ hơn 10 phút
function onResume() {
  updateDateline();
  if (Date.now() - state.lastRefresh > STALE) refresh();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) onResume(); });

if (App) {
  // Nút Back của Android: đóng bảng/ô tìm kiếm trước; ở màn hình chính thì chỉ thu nhỏ app
  // (không thoát) để quay lại vẫn đúng chỗ đang đọc.
  App.addListener("backButton", () => {
    if (dlg.open) dlg.close();
    else if (!$("#searchbox").hidden) toggleSearch(false);
    else { captureAnchor(); App.minimizeApp(); }
  });
}

// ---------- Khởi động ----------
applyTheme();
if (NATIVE) {
  const cache = store.get("cache", null);
  if (cache?.items?.length) setData(cache, { initial: true });
  else render();
  refresh();
} else {
  render();
  (async () => {
    state.loading = true; render();
    try {
      const r = await fetch("data/news.json", { cache: "no-cache" });
      const data = await r.json();
      state.loading = false;
      setData(data, { initial: true });
      state.lastRefresh = Date.now();
    } catch {
      state.loading = false; render();
    }
  })();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
