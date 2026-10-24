import { workNow } from './utils.js';
// Даты и оценка аванса и зарплаты.
import { $, clamp, dateText, money, num, plural } from './utils.js';
import { save, state } from './state.js';
import { monthEntries } from './pay.js';
import { closeModal, openModal, showToast } from './dialogs.js';
import { cloudSaveExtra } from './cloud.js';

export const DISTRICT_COEF = 1.15, LUNCH_PAY = 200;

export function rawShiftPay(e) { return Math.max(0, Math.round((num(e.base) / DISTRICT_COEF - LUNCH_PAY) * 100) / 100); }

export function advancePart(entries) { return entries.filter(e => Number(e.k.slice(8, 10)) <= 15).reduce((a, e) => a + rawShiftPay(e), 0); }

export function paydayInfo(today = workNow()) {
  const pd = state.extra.payday || {}; const adv = clamp(Math.round(num(pd.advanceDay, 0)), 0, 31), sal = clamp(Math.round(num(pd.salaryDay, 0)), 0, 31);
  if (!adv && !sal) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const candidates = [];
  for (const [type, day] of [["advance", adv], ["salary", sal]]) {
    if (!day) continue;
    for (let k = 0; k < 3; k++) {
      const y = today.getFullYear(), m = today.getMonth() + k;
      const d = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
      if (d >= start) { candidates.push({ type, date: d }); break; }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.date - b.date);
  const next = candidates[0], days = Math.round((next.date - start) / 86400000);
  // 23-го (аванс): только «чистый» выход за 1–15 число текущего месяца — без обедов и районного коэффициента.
  // 8-го (зарплата): всё остальное за прошлый месяц — выход + обеды + районный за 16–31, обеды и районный за 1–15,
  // сделка за весь месяц и премии. Т.е. весь заработок прошлого месяца минус уже выплаченный аванс.
  let expected = 0;
  if (next.type === "advance") {
    expected = advancePart(monthEntries(next.date));
  } else {
    const prev = new Date(next.date.getFullYear(), next.date.getMonth() - 1, 1);
    const es = monthEntries(prev), total = es.reduce((a, e) => a + num(e.total), 0);
    expected = Math.max(0, total - advancePart(es));
  }
  return { type: next.type, date: next.date, days, expected };
}

export function renderPaydayStrip() {
  const strip = $("paydayStrip"); if (!strip) return;
  const p = paydayInfo();
  strip.hidden = false;
  if (!p) { $("paydayTitle").textContent = "Когда аванс и зарплата?"; $("paydayMeta").textContent = "Укажи даты — покажу обратный отсчёт"; return; }
  const label = p.type === "advance" ? "аванса" : "зарплаты";
  $("paydayTitle").textContent = p.days === 0 ? `Сегодня день ${label} 🎉` : `До ${label} ${p.days} ${plural(p.days, "день", "дня", "дней")}`;
  $("paydayMeta").textContent = `${dateText(p.date, { day: "numeric", month: "long" })}${p.expected ? ` · ожидаемо ≈ ${money(p.expected)}` : ""}`;
}

export function openPaydayModal() { const p = state.extra.payday || {}; $("paydayAdvance").value = p.advanceDay || ""; $("paydaySalary").value = p.salaryDay || ""; openModal("paydayModal"); }

export async function savePayday() {
  state.extra.payday = { advanceDay: clamp(Math.round(num($("paydayAdvance").value, 0)), 0, 31), salaryDay: clamp(Math.round(num($("paydaySalary").value, 0)), 0, 31) };
  save(); cloudSaveExtra(); closeModal("paydayModal"); renderPaydayStrip(); showToast("Даты выплат сохранены");
}
