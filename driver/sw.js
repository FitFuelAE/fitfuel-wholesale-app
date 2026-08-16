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
const API = "https://sihvyglufmftrpwogbeq.supabase.co/functions/v1/api";
const CACHE = "ffws-driver-2026-08-16.4";
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

// ---- push ------------------------------------------------------------------
// The message arrives whether or not the app is open — that is the entire point.
// A note is a nudge to go and look, never the record itself, so it carries only
// enough to decide whether to walk over.
self.addEventListener("push", (e) => {
  let n = { title: "FitFuel Wholesale", body: "Something needs you.", url: "./" };
  try { if (e.data) n = { ...n, ...e.data.json() }; } catch { /* keep the default */ }

  e.waitUntil(self.registration.showNotification(n.title, {
    body: n.body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    // Same tag replaces an earlier unread note instead of stacking five of them.
    tag: n.tag || "ffws",
    renotify: true,
    data: { url: n.url || "./" },
  }));
});

// Tapping it should land in the app that is already open, not a second copy.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(target) && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});

// A browser may retire a push subscription and issue a replacement at any time —
// after an update, after its own housekeeping, for reasons it does not explain.
// It fires this event once, and if nobody listens the replacement is never
// reported: the server keeps pushing at the dead endpoint, gets 410, drops the
// row, and that person silently stops being told anything. Their app still says
// notifications are on, which is the worst part.
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil((async () => {
    try {
      const old = e.oldSubscription?.endpoint;
      let sub = e.newSubscription;
      if (!sub) {
        // Some browsers hand over the old subscription only and expect the app
        // to ask for a new one with the same key.
        const key = e.oldSubscription?.options?.applicationServerKey;
        if (!key) return;
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: key,
        });
      }
      if (!sub || !old) return;
      await fetch(API + "/push/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldEndpoint: old, subscription: sub.toJSON() }),
      });
    } catch { /* the app re-registers on next open as the backstop */ }
  })());
});
