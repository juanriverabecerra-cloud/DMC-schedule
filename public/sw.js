// Offline support: the app shell is cached; schedule data is cached by the app itself
// (localStorage), so API and calendar requests always go to the network.
const CACHE = "dmc-shell-v7";
const SHELL = [
  "/", "/index.html", "/css/app.css", "/manifest.webmanifest",
  "/js/app.js", "/js/api.js", "/js/ui.js",
  "/js/views/today.js", "/js/views/tonight.js", "/js/views/board.js", "/js/views/person.js", "/js/views/hours.js",
  "/js/views/gaps.js", "/js/views/more.js", "/js/views/admin.js", "/js/views/setup.js", "/js/views/common.js", "/js/views/call.js", "/js/views/didactics.js",
  "/core/dates.js", "/core/codes.js", "/core/names.js", "/core/model.js", "/core/hours.js", "/core/gaps.js", "/core/swap.js", "/core/ics.js", "/core/directory.js", "/core/didactics.js",
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
  // Network first so updates show up right away; fall back to the cached shell offline.
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(event.request, copy)); }
      return res;
    }).catch(() => caches.match(event.request).then((hit) => hit || caches.match("/index.html"))),
  );
});
