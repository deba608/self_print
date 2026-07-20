// Minimal offline shell — no attempt to cache job/pricing data (that must
// always be fresh). Only static, rarely-changing assets are cached so a
// dropped connection shows the branded offline page instead of Chrome's.
const CACHE = "selfprint-shell-v1";
const SHELL_URLS = ["/offline.html", "/web-app-manifest-192x192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Never intercept API calls — job status, pricing, everything must be live.
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  // Page navigations: try the network, fall back to the offline shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // Static assets (icons, css, js chunks): cache-first, and stash fresh
  // fetches as they come in so a later offline visit has more to serve.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
