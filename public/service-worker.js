// Minimal service worker — exists mainly so Chrome/Android treats this
// as an installable app. Deliberately network-first on every request so
// installed PWAs (especially on iOS) always pick up new deployments
// instead of running on stale cached JavaScript.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
