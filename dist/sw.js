const cacheName = 'mun-public-static-v1';
const publicAssets = ['/offline.html', '/style.css', '/logo.jpg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable.png', '/icons/apple.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(publicAssets)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const previous = (await caches.keys()).filter(name => name.startsWith('mun-public-static-') && name !== cacheName);
    await Promise.all(previous.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/push/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(cacheName)).match('/offline.html')));
  } else if (!url.search && publicAssets.includes(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request)));
  }
});
