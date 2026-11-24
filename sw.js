// JagoTrack service worker — cache app shell agar bisa dibuka offline.
// Naikkan CACHE_VERSION setiap kali index.html diubah agar pengguna mendapat versi terbaru.
const CACHE_VERSION = 'jagotrack-v4';
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com/3.4.17',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'
];
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(SHELL).catch(() => {});
    await Promise.all(CDN_ASSETS.map(async (u) => {
      try { await cache.put(u, await fetch(u, { mode: 'no-cors' })); } catch (e) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isShell = url.origin === self.location.origin;
  const isCdn = CDN_ASSETS.includes(req.url);
  if (!isShell && !isCdn) return; // API Google Apps Script/AI tidak pernah di-cache

  // Halaman: coba jaringan dulu (agar update cepat), jatuh ke cache saat offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Aset: cache dulu, perbarui di latar belakang
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(async (res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, res.clone());
      }
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
