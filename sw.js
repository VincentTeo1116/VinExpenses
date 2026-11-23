// Service worker: tries the network first so updates arrive at once, and uses the cache when offline.
const CACHE_NAME = 'expense-tracker-__BUILD__'; // stamped per deploy, so every release replaces the old cache
const SHELL_FILES = [
    './',
    'index.html',
    'style.css',
    'fonts.css',
    'frame-guard.js',
    'app.js',
    // Libraries from vendor/ are cached for offline use. pdf.js is cached on first use because it is large.
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
    'finance-calc.js',
    'plan.js',
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

    // Only this site's own files are handled. Everything else goes straight to the network.
    if (new URL(req.url).origin !== self.location.origin) return;

    // Always recheck files with the server, or GitHub Pages serves a copy up to 10 minutes old.
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
