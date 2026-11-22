const CACHE = 'brief-v5';
const SHELL = [
  './', 'index.html', 'assets/base.css', 'assets/themes.css', 'assets/editions.css', 'assets/publications.css', 'assets/app.js',
  'manifest.webmanifest', 'icons/favicon.svg', 'icons/icon-192.png',
  'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('brief-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (/^(data|mock)\/[^/]+\.json$/.test(path)) {
    const cachePromise = caches.open(CACHE);
    const network = cachePromise.then(cache => fetch(request).then(async response => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
    event.waitUntil(network.catch(() => {}));
    event.respondWith(cachePromise.then(async cache => {
      try {
        const response = await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))]);
        if (response.ok) return response;
        return (await cache.match(request)) || response;
      } catch {
        return (await cache.match(request)) || new Response('', { status: 503 });
      }
    }));
  } else if (request.mode === 'navigate' || SHELL.includes(path)) {
    const key = request.mode === 'navigate' ? 'index.html' : path;
    const cachePromise = caches.open(CACHE);
    const update = cachePromise.then(cache => fetch(request).then(async response => {
      if (response.ok) await cache.put(key, response.clone());
      return response;
    }));
    event.waitUntil(update.catch(() => {}));
    event.respondWith(cachePromise.then(async cache => {
      const cached = await cache.match(key);
      return cached || update;
    }));
  }
});
