// 只為了「裝到手機桌面」：瀏覽器要求 App 斷線時也打得開，才肯給安裝選項。
// 一律先連網路（拿到的一定是最新版，改版檢查才不會被騙），連不上才拿上次存的。
const CACHE = 'muscle-log';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? caches.match('./'))),
  );
});
