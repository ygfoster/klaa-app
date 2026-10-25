/**
 * sw.js — Service Worker（アプリの画面ファイルを端末に保存し、電波が弱くても起動できるようにする）
 *
 * ・画面ファイルは「ネット優先・失敗したら保存済みを使う」。更新はオンライン時にすぐ反映される。
 * ・API（GAS）への通信には一切関与しない（会員データを端末に保存しない）。
 * ・画面ファイルを変えたら VERSION を上げる。
 */
const VERSION = 'v0.4.1';
const CACHE = 'klaa-shell-' + VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/api.js', './js/config.js', './js/session.js', './js/offline.js', './js/ui.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('klaa-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
