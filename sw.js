const CACHE_NAME = "my-pay-v1.01";
const APP_SHELL = [
  "./",
  "./index.html",
  "./landing.css?v=1.01",
  "./landing.js?v=1.01",
  "./app.html",
  "./style.css",
  "./script.js?v=1.01",
  "./style.css?v=1.01",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./privacy.html",
  "./fonts/manrope-cyrillic-wght-normal.woff2",
  "./fonts/manrope-cyrillic-ext-wght-normal.woff2",
  "./fonts/manrope-latin-wght-normal.woff2",
  "./fonts/manrope-latin-ext-wght-normal.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((c) =>
        Promise.allSettled(
          APP_SHELL.map((url) =>
            fetch(url, { cache: "no-cache" }).then((res) =>
              res.ok ? c.put(url, res) : undefined
            )
          )
        )
      )
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    const fallback = url.pathname.endsWith("/app.html")
      ? "./app.html"
      : url.pathname.endsWith("/privacy.html")
        ? "./privacy.html"
        : "./index.html";
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request, { cache: "no-store" });
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(CACHE_NAME)
                .then((c) => c.put(fallback, copy))
                .catch(() => {})
            );
          }
          return response;
        } catch {
          return (
            (await caches.match(event.request)) ||
            (await caches.match(fallback)) ||
            (await caches.match("./app.html")) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then((c) => c.put(event.request, copy))
              .catch(() => {})
          );
        }
        return response;
      } catch {
        return (
          (await caches.match(event.request, { ignoreSearch: true })) ||
          Response.error()
        );
      }
    })()
  );
});
