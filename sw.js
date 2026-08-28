// Minimal service worker: caches the app shell so the UI still loads
// even without a network connection. Data operations still
// need network access to reach Supabase.
const CACHE_NAME = 'expense-tracker-v1';
const SHELL_FILES = ['index.html', 'style.css', 'app.js', 'manifest.json'];

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
    // Network-first for Supabase API calls, cache-first for the app shell.
    if (event.request.url.includes('supabase.co')) return;

    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});
