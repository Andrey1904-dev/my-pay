// Keep this cache version in sync with CACHE_VERSION in script.js.
const CACHE_NAME = "my-pay-v1.01";
const APP_SHELL = [
  "./",
  "./index.html",
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
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("my-pay-v") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  if (event.request.mode === "navigate") {
    // Keep the dashboard's offline entry separate from the public landing page.
    const pageKey = url.pathname.endsWith("/app.html") ? "./app.html" : "./index.html";
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request, { cache: "no-store" });
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(pageKey, copy))
                .catch(() => {}),
            );
          }
          return response;
        } catch {
          return (await caches.match(pageKey)) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request, { cache: "no-store" });
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => {}),
          );
        }
        return response;
      } catch {
        return (
          (await caches.match(event.request)) ||
          (await caches.match("./index.html")) ||
          Response.error()
        );
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "CASE.PLACE SALARY", body: "У тебя новое напоминание." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      data: data.data || {},
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow("./app.html");
      }),
  );
});
