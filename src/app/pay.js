import { workNow } from './utils.js';
// Расчёт смен, график 2/2 и аналитика.
import { dateKey, fromKey, monthPrefix, num, sameMonth } from './utils.js';
import { state } from './state.js';

export function piece(cases) { return Math.max(0, num(cases)) * num(state.settings.casePrice) * num(state.settings.percent) / 100; }

export function base(holiday) { return holiday ? num(state.settings.holidayPay) : num(state.settings.basePay); }

export function total(cases, holiday) { return base(holiday) + piece(cases); }

export function makeShift(cases, holiday, bonus = 0) {
  cases = Math.max(0, Math.floor(num(cases))); holiday = !!holiday; bonus = Math.max(0, num(bonus));
  return { cases, holiday, base: base(holiday), piece: piece(cases), total: total(cases, holiday) + bonus };
}

export function correctLegacyShift(s) {
  if (!s || typeof s !== "object") return s;
  const cases = num(s.cases), oldBase = s.holiday ? 4050 : 2415;
  if (cases < 0 || num(s.base) !== oldBase || Math.abs(num(s.piece) - cases * 2.0125) > .0051) return s;
  const bonus = num(s.total) - num(s.base) - num(s.piece);
  if (bonus < -.011) return s;
  const b = s.holiday ? 4600 : 2415, p = cases * 1.75;
  return { ...s, base: b, piece: p, total: b + p + Math.max(0, Math.round(bonus * 100) / 100) };
}

export function isWork(d) {
  const start = fromKey(state.settings.scheduleStart);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((t - start) / 86400000);
  return ((diff % 4) + 4) % 4 < 2;
}

export function monthEntries(d = state.calendarDate) {
  const prefix = monthPrefix(d);
  return Object.entries(state.shifts).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ k, ...v }));
}

export function monthSum(entries) { return entries.reduce((a, v) => a + num(v.total), 0); }

export function monthForecast(d = workNow()) {
  const es = monthEntries(d);
  if (!es.length) return null;
  const sum = monthSum(es);
  const today = workNow();
  if (!sameMonth(d, today)) return Math.round(sum);
  const avg = sum / es.length;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  let remaining = 0;
  for (let n = today.getDate(); n <= days; n++) {
    const x = new Date(d.getFullYear(), d.getMonth(), n);
    if (isWork(x) && !state.shifts[dateKey(x)]) remaining++;
  }
  return Math.round(sum + avg * remaining);
}

export function analyticsForMonth(d = state.calendarDate) {
  const es = monthEntries(d).sort((a, b) => a.k.localeCompare(b.k));
  const sum = monthSum(es);
  const best = es.reduce((a, v) => !a || num(v.total) > num(a.total) ? v : a, null);
  const avg = es.length ? sum / es.length : 0;
  let streak = 0, bestStreak = 0, prev = null;
  for (const v of es) {
    const x = fromKey(v.k);
    streak = prev && Math.round((x - prev) / 86400000) <= 3 ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak); prev = x;
  }
  return { es, sum, best, avg, bestStreak, cases: es.reduce((a, v) => a + num(v.cases), 0) };
}
