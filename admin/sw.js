// Offline support for the app shell.
//
// NETWORK FIRST, cache as the fallback. An earlier version was cache-first,
// which meant a deployed change never reached anyone who had already opened the
// app — the cached index.html was served forever because the cache name never
// changed. For an app that is updated regularly, correctness beats the few
// milliseconds cache-first saves.
//
// API responses are never cached at all: a stale order list or a stale cash
// position is worse than an honest offline error.
const CACHE = "ffws-admin-2026-08-15.3";
const SHELL = ["./", "./index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.includes("/functions/v1/")) return;      // never cache the API
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Keep a copy so the app still opens without a signal.
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html"))),
  );
});
