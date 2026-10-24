import { PAY, fixedPart } from "../../supabase/functions/_shared/pay.ts";
import { workNow } from './utils.js';
// Состояние, нормализация и локальное хранение.
import { clamp, isDateKey, num, todayKey } from './utils.js';

export const DEFAULTS = { basePay: fixedPart(), holidayPay: fixedPart(true), casePrice: PAY.caseRate, percent: PAY.casePercent, scheduleStart: todayKey() };

export const EXTRA_DEFAULTS = {
  payday: { advanceDay: 23, salaryDay: 8 },
  templates: [{ id: "default", name: "Обычная", cases: 0, hours: 11, bonus: 0, holiday: false }],
  shiftMeta: {}, theme: "dark", undo: null
};

export const WORK_START_MIN = 8 * 60;

export const WORK_END_MIN = 19 * 60;

export const LEGACY_SETS = [{ basePay: 2415, casePrice: 8.05, percent: 25 }, { basePay: 2150, casePrice: 7, percent: 20 }, { basePay: 2627.84, casePrice: 1.69, percent: 100 }];

export function isLegacySet(b, c, p) { return LEGACY_SETS.some(l => num(b) === l.basePay && num(c) === l.casePrice && num(p) === l.percent); }

export function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : structuredCloneSafe(fallback); }
  catch { return structuredCloneSafe(fallback); }
}

export function structuredCloneSafe(v) { return JSON.parse(JSON.stringify(v)); }

export function normalizeSettings(s) {
  s = s && typeof s === "object" ? s : {};
  const out = {
    basePay: Math.max(0, num(s.basePay, DEFAULTS.basePay)),
    holidayPay: Math.max(0, num(s.holidayPay, DEFAULTS.holidayPay)),
    casePrice: Math.max(0, num(s.casePrice, DEFAULTS.casePrice)),
    percent: clamp(num(s.percent, DEFAULTS.percent), 0, 100),
    scheduleStart: isDateKey(s.scheduleStart) ? s.scheduleStart : todayKey()
  };
  if (isLegacySet(out.basePay, out.casePrice, out.percent)) {
    if (out.holidayPay === 4050) out.holidayPay = DEFAULTS.holidayPay;
    out.basePay = DEFAULTS.basePay; out.casePrice = DEFAULTS.casePrice; out.percent = DEFAULTS.percent;
  }
  return out;
}

export function normalizeExtra(e) {
  e = e && typeof e === "object" ? e : {};
  const out = { ...structuredCloneSafe(EXTRA_DEFAULTS), ...e };
  out.payday = out.payday && typeof out.payday === "object" ? { advanceDay: clamp(Math.round(num(out.payday.advanceDay, 0)), 0, 31), salaryDay: clamp(Math.round(num(out.payday.salaryDay, 0)), 0, 31) } : structuredCloneSafe(EXTRA_DEFAULTS.payday);
  if (out.payday.advanceDay === 25 && out.payday.salaryDay === 10) out.payday = { advanceDay: 23, salaryDay: 8 }; // старые дефолты → реальные даты выплат
  out.templates = Array.isArray(out.templates) ? out.templates.filter(t => t && typeof t === "object" && typeof t.id === "string").map(t => ({
    id: t.id, name: String(t.name || "Смена"), cases: Math.max(0, Math.floor(num(t.cases))),
    hours: Math.max(0, num(t.hours, 11)), bonus: Math.max(0, num(t.bonus)), holiday: !!t.holiday
  })) : structuredCloneSafe(EXTRA_DEFAULTS.templates);
  out.shiftMeta = Object.fromEntries(Object.entries(out.shiftMeta && typeof out.shiftMeta === "object" ? out.shiftMeta : {}).filter(([date, meta]) => isDateKey(date) && meta && typeof meta === "object").map(([date, meta]) => [date, {
    hours: Math.max(0, num(meta.hours, 11)), bonus: Math.max(0, num(meta.bonus)), note: String(meta.note || "")
  }]));
  out.theme = ["system", "light", "dark"].includes(out.theme) ? out.theme : "system";
  return out;
}

export const state = {
  settings: normalizeSettings(load("myPaySettings", DEFAULTS)),
  shifts: load("myPayShifts", {}),
  extra: normalizeExtra(load("myPayExtra", EXTRA_DEFAULTS)),
  calendarDate: workNow(),
  selectedDate: todayKey(),
  homeDirty: false,
  modalDate: null
};

if (!state.shifts || typeof state.shifts !== "object" || Array.isArray(state.shifts)) state.shifts = {};

export function save() {
  localStorage.setItem("myPaySettings", JSON.stringify(state.settings));
  localStorage.setItem("myPayShifts", JSON.stringify(state.shifts));
  localStorage.setItem("myPayExtra", JSON.stringify(state.extra));
}
