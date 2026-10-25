/* Sogndal.live · service worker
 * Nett først, cache som reserve: sida er alltid fersk når du er på nett,
 * og skalet (HTML/CSS/JS/skrift) opnar sjølv utan dekning.
 * Sanntidsdata (Entur, fly, vêr, vegmeldingar) vert aldri cacha her.
 */
const CACHE = "sogndal-live-v1";
const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/config.js",
  "/js/core.js",
  "/js/vehicles.js",
  "/js/planes.js",
  "/js/stops.js",
  "/js/roads.js",
  "/js/trip.js",
  "/js/extras.js",
  "/vendor/maplibre/maplibre-gl.js",
  "/vendor/maplibre/maplibre-gl.css",
  "/vendor/fonts/inter-latin-wght-normal.woff2",
  "/vendor/fonts/fraunces-latin-600-normal.woff2",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (/^\/(adsb|met|ad)\//.test(url.pathname)) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error())))
  );
});
