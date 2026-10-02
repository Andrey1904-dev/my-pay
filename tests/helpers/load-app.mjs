// Поднимает функциональное приложение в jsdom: app.html + script.js, без Supabase SDK (локальный режим).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(path.join(root, "app.html"), "utf8");
const script = readFileSync(path.join(root, "script.js"), "utf8");

/**
 * @param {object} [opts]
 * @param {object} [opts.settings]  содержимое localStorage.myPaySettings
 * @param {object} [opts.shifts]    содержимое localStorage.myPayShifts
 * @param {object} [opts.extra]     содержимое localStorage.myPayExtra
 * @param {boolean} [opts.dark]     эмулировать prefers-color-scheme: dark
 */
export function loadApp(opts = {}) {
  // Внешние скрипты (Supabase CDN, script.js) не грузим — script.js выполняем вручную после посева localStorage.
  const markup = html.replace(/<script src="[^"]+"[^>]*><\/script>\s*/g, "");
  const dom = new JSDOM(markup, {
    url: "https://andrey1904-dev.github.io/my-pay/app.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.error || e.message));

  // Полифилы того, чего нет в jsdom.
  window.matchMedia = (query) => ({
    matches: !!opts.dark && query.includes("dark"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.URL.createObjectURL = () => "blob:mock";
  window.URL.revokeObjectURL = () => {};
  if (!window.crypto?.randomUUID) window.crypto.randomUUID = () => globalThis.crypto.randomUUID();

  if (opts.settings) window.localStorage.setItem("myPaySettings", JSON.stringify(opts.settings));
  if (opts.shifts) window.localStorage.setItem("myPayShifts", JSON.stringify(opts.shifts));
  if (opts.extra) window.localStorage.setItem("myPayExtra", JSON.stringify(opts.extra));

  window.eval(script);
  if (!window.MyPay) throw new Error("script.js не создал window.MyPay: " + errors.map(String).join("; "));

  const $ = (id) => window.document.getElementById(id);
  return {
    dom,
    window,
    document: window.document,
    MyPay: window.MyPay,
    errors,
    $,
    text: (id) => $(id).textContent.replace(/\u00a0/g, " ").trim(),
    click: (idOrEl) => (typeof idOrEl === "string" ? $(idOrEl) : idOrEl).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })),
    input: (id, value) => {
      const el = $(id);
      el.value = String(value);
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
      el.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    close: () => window.close(),
  };
}

export function key(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
