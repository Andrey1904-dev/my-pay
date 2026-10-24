// Форматирование, даты и небольшие DOM-утилиты.

export function $(id) { return document.getElementById(id); }

export function num(v, fallback = 0) { if (v === null || v === undefined || v === "") return fallback; const n = Number(typeof v === "string" ? v.replace(",", ".").trim() : v); return Number.isFinite(n) ? n : fallback; }

export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function money(n) {
  const v = Math.round(num(n) * 100) / 100;
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v) + "\u00a0₽"; // неразрывный пробел — знак ₽ не уезжает на новую строку
}

export function moneyShort(n) { n = num(n); return n >= 1000 ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n / 1000) + "к" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n); }

export function integer(n) { return new Intl.NumberFormat("ru-RU").format(num(n)); }

export function pad2(n) { return String(n).padStart(2, "0"); }

export function dateKey(d) { d = new Date(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// Calendar dates use the workshop's timezone, including when opened abroad.
export function workNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Yekaterinburg", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = type => Number(parts.find(part => part.type === type).value);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

export function todayKey() { return dateKey(workNow()); }

export function fromKey(k) { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, m - 1, d); }

export function isDateKey(k) { return typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) && dateKey(fromKey(k)) === k; }

export function monthPrefix(d = workNow()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-`; }

export function dateText(d, opt) { return new Intl.DateTimeFormat("ru-RU", opt || { day: "numeric", month: "long" }).format(d); }

export function plural(n, one, few, many) { n = Math.abs(n) % 100; const x = n % 10; return n > 10 && n < 20 ? many : x > 1 && x < 5 ? few : x === 1 ? one : many; }

export function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

export function uid(prefix = "id") { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function icon(name) { return `<svg aria-hidden="true"><use href="#${name}"/></svg>`; }

export function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
