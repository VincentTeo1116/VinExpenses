// Replaces the old app's service worker. People who installed or opened the old site still have it, and it would keep showing the old app
// from its cache. This one deletes every cache, removes itself, and reloads the open pages so the redirect page is fetched from the network.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (key) { return caches.delete(key); }));
      await self.registration.unregister();
      var windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach(function (client) { client.navigate(client.url); });
    })(),
  );
});
