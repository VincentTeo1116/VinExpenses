// Service worker: keeps the app installable and the UI loadable offline.
// Strategy: network-first (so a deploy is picked up immediately), falling
// back to the cache when offline. Supabase API calls are never intercepted.
// Bump CACHE_NAME whenever you want to force old caches to be dropped.
const CACHE_NAME = 'expense-tracker-__BUILD__'; // stamped per deploy, so every release replaces the old cache
const SHELL_FILES = [
    './',
    'index.html',
    'style.css',
    'fonts.css',
    'frame-guard.js',
    'app.js',
    // Self-hosted libraries (vendor/): cached so the app still opens offline. pdf.js is large, so it is cached
    // the first time someone opens a PDF instead.
    'vendor/supabase-js/supabase.js',
    'vendor/chartjs/chart.umd.js',
    'vendor/fontawesome/css/all.min.css',
    'vendor/fontawesome/webfonts/fa-solid-900.woff2',
    'vendor/fontawesome/webfonts/fa-regular-400.woff2',
    'vendor/fontawesome/webfonts/fa-brands-400.woff2',
    'vendor/inter/files/inter-latin-wght-normal.woff2',
    'vendor/inter/files/inter-latin-ext-wght-normal.woff2',
    'receipt-parser.js',
    'smart-entry.js',
    'csv-import.js',
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

    // This worker only ever handles THIS site's own files. Everything else (Supabase, the map service, anything an
    // attacker might try to route through here) goes straight to the network, untouched and never stored.
    if (new URL(req.url).origin !== self.location.origin) return;

    // Files are revalidated with the server on every load. Without this, GitHub Pages'
    // `max-age=600` header lets a phone keep serving a 10-minute-old stylesheet.
    event.respondWith(
        fetch(req, { cache: 'no-cache' })
            .then((res) => {
                // Cache good responses for offline use (basic = same-origin; never opaque cross-origin ones)
                if (res && res.ok && res.type === 'basic') {
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
