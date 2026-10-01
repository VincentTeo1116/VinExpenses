// Service worker: keeps the app installable and the UI loadable offline.
// Strategy: network-first (so a deploy is picked up immediately), falling
// back to the cache when offline. Supabase API calls are never intercepted.
// Bump CACHE_NAME whenever you want to force old caches to be dropped.
const CACHE_NAME = 'expense-tracker-v2';
const SHELL_FILES = [
    './',
    'index.html',
    'style.css',
    'app.js',
    'manifest.json',
    'icon.png',
    'icons/icon-192.png',
    'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    if (!req.url.startsWith('http')) return;
    if (req.url.includes('supabase.co')) return;

    event.respondWith(
        fetch(req)
            .then((res) => {
                // Cache good same-origin and CDN (opaque) responses for offline use
                if (res && (res.ok || res.type === 'opaque')) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() =>
                caches.match(req).then((cached) =>
                    cached || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())
                )
            )
    );
});
