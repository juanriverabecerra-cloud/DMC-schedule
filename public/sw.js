// Offline support: the app shell is cached; schedule data is cached by the app itself
// (localStorage), so API and calendar requests always go to the network.
const CACHE = "dmc-shell-v20";
const NETWORK_WAIT = 3500; // a weak signal shouldn't leave the screen blank
const SHELL = [
  "/", "/index.html", "/css/app.css", "/manifest.webmanifest",
  "/js/app.js", "/js/api.js", "/js/ui.js", "/js/logged.js", "/js/push.js",
  "/js/views/today.js", "/js/views/tonight.js", "/js/views/board.js", "/js/views/person.js", "/js/views/hours.js",
  "/js/views/gaps.js", "/js/views/more.js", "/js/views/admin.js", "/js/views/setup.js", "/js/views/common.js", "/js/views/call.js", "/js/views/didactics.js", "/js/views/fairness.js", "/js/views/reminders.js", "/js/views/rate.js", "/js/views/alerts.js", "/js/views/chief.js", "/js/views/requests.js", "/js/views/inbox.js",
  "/core/dates.js", "/core/codes.js", "/core/names.js", "/core/model.js", "/core/hours.js", "/core/logged.js", "/core/reminders.js", "/core/gaps.js", "/core/swap.js", "/core/ics.js", "/core/directory.js", "/core/didactics.js", "/core/fairness.js", "/core/survey.js", "/core/alerts.js", "/core/chief.js", "/core/requests.js",
  "/icons/icon-192.png", "/icons/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (/^\/(api|cal|bg)\//.test(url.pathname)) return;
  event.respondWith(fromNetworkFirst(event.request));
});

// Network first so updates show up right away, but a saved copy wins if the network stalls, as
// it can deep inside the hospital. Offline falls back to the cached shell.
async function fromNetworkFirst(request) {
  const network = fetch(request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
    return res;
  });
  const saved = await caches.match(request);
  if (!saved) return network.catch(() => caches.match("/index.html"));
  return Promise.race([network.catch(() => saved), new Promise((resolve) => setTimeout(() => resolve(saved), NETWORK_WAIT))]);
}

// Lock-screen alerts: the server sends one when a day's OR schedule is posted.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "DMC Schedule", {
    // renotify: a follow-up for the same day replaces the old alert, but still has to buzz.
    body: data.body || "", tag: data.tag || undefined, renotify: !!data.tag, icon: "/icons/icon-192.png", data: { url: data.url || "/" },
  }));
});

// Tapping an alert opens the app on that day, reusing a window that's already open.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) { await win.focus(); win.postMessage({ type: "open", url }); return; }
    await self.clients.openWindow(url);
  })());
});
