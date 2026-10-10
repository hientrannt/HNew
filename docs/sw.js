// Cache giao diện để mở nhanh/offline; dữ liệu tin luôn lấy mới nhất khi có mạng.
const CACHE = "hnews-v2";
const SHELL = ["./", "index.html", "style.css", "app.js", "js/feeds.js", "vendor/capacitor.js", "sources.json",
  "icon.svg", "icon-192.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Mạng trước, cache dự phòng.
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
