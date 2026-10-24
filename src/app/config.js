// Версия и управление кэшем.

export const APP_VERSION = "1.02";

export const CACHE_VERSION = "my-pay-v" + APP_VERSION;

(async () => {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith("my-pay-v") && k !== CACHE_VERSION).map(k => caches.delete(k)));
    }
  } catch (e) { console.warn("Cache cleanup:", e); }
})();
