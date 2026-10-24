import { accountId } from './cloud.js';
import { workNow } from './utils.js';
// Главный экран и сводка месяца.
import { updateProfileUI } from './profile.js';
import { refreshUndoUI, renderCalendar } from './calendar.js';
import { renderInsights, renderStats } from './stats.js';
import { renderPaydayStrip } from './payday.js';
import { renderTemplates } from './templates.js';
import { $, dateText, integer, money, num, pad2, plural, todayKey } from './utils.js';
import { WORK_END_MIN, WORK_START_MIN, save, state } from './state.js';
import { base, isWork, makeShift, monthEntries, monthSum, piece } from './pay.js';
import { cloudSaveShift } from './cloud.js';
import { showToast } from './dialogs.js';

export function renderAll() { updateProfileUI(); updateHome(); renderCalendar(); renderStats(); renderInsights(); renderPaydayStrip(); renderTemplates(); refreshUndoUI(); }

export function homeInputs() {
  return { cases: Math.max(0, Math.floor(num($("casesInput").value))), holiday: $("holidayInput").checked };
}

export function syncHomeInputsFromCloud() {
  if (state.homeDirty || document.activeElement === $("casesInput")) return;
  const today = state.shifts[todayKey()];
  $("casesInput").value = today ? String(today.cases || 0) : "";
  $("holidayInput").checked = !!today?.holiday;
}

export function updateHome() {
  const { cases, holiday } = homeInputs();
  const savedShift = state.shifts[todayKey()];
  const historical = !state.homeDirty && savedShift && savedShift.cases === cases && !!savedShift.holiday === holiday;
  const p = historical ? num(savedShift.piece) : piece(cases), b = historical ? num(savedShift.base) : base(holiday);
  const bonus = historical ? Math.max(0, num(savedShift.total) - b - p) : num(state.extra.shiftMeta?.[todayKey()]?.bonus);
  $("shiftTotal").textContent = money(historical ? savedShift.total : b + p + bonus);
  $("casesInput").style.width = Math.max(1, String(cases).length) + "ch";
  $("casesInput").style.fontSize = String(cases).length > 5 ? "22px" : "";
  $("homeBonus").textContent = money(bonus);
  $("homeBonusRow").classList.toggle("hidden", !bonus);
  $("homeBase").textContent = money(b);
  $("homeBaseLabel").textContent = holiday ? "Фикс × 2 + обед" : "Фикс + обед";
  $("homePiece").textContent = money(p);
  $("holidayChip").classList.toggle("hidden", !holiday);
  $("perCase").textContent = money(num(state.settings.casePrice) * num(state.settings.percent) / 100);
  $("perThousand").textContent = money(piece(1000));
  $("holidayRateLabel").textContent = money(state.settings.holidayPay);
  const now = workNow();
  $("todayLabel").textContent = "Сегодня, " + dateText(now, { day: "numeric", month: "long" });
  const badge = $("todayBadge"), work = isWork(now);
  badge.textContent = work ? "Работа" : "Выходной"; badge.classList.toggle("is-work", work);
  const saved = state.shifts[todayKey()];
  $("saveNote").textContent = state.homeDirty ? "Есть несохранённые изменения" : saved ? `Смена за сегодня сохранена: ${money(saved.total)}` : "";
  updateNextShiftCard();
  updateHomeDashboard();
}

export function updateHomeDashboard() {
  const es = monthEntries(workNow()), sum = monthSum(es), cases = es.reduce((a, v) => a + num(v.cases), 0);
  $("homeMonthTotal").textContent = money(sum);
  $("homeMonthShifts").textContent = integer(es.length);
  $("homeMonthShiftsUnit").textContent = plural(es.length, "смена", "смены", "смен");
  $("homeMonthName").textContent = dateText(workNow(), { month: "long" });
  $("homeMonthCases").textContent = integer(cases);
  $("homeAvgShift").textContent = money(es.length ? sum / es.length : 0);
}

export function updateNextShiftCard() {
  const card = $("nextShiftCard"), kicker = $("nextShiftKicker"), progress = $("shiftProgress");
  const now = workNow(), minutes = now.getHours() * 60 + now.getMinutes();
  if (isWork(now) && minutes >= WORK_START_MIN && minutes < WORK_END_MIN) {
    const left = WORK_END_MIN - minutes, h = Math.floor(left / 60), m = left % 60;
    card.classList.add("current-shift"); kicker.textContent = "Смена идёт";
    $("nextShiftDate").textContent = `До конца ${h} ч ${pad2(m)} мин`;
    $("nextShiftMeta").textContent = "Рабочее время 08:00–19:00";
    progress.classList.remove("hidden");
    $("shiftProgressBar").style.width = Math.round((minutes - WORK_START_MIN) / (WORK_END_MIN - WORK_START_MIN) * 100) + "%";
    return;
  }
  card.classList.remove("current-shift"); progress.classList.add("hidden"); kicker.textContent = "Ближайшая смена";
  if (isWork(now) && minutes < WORK_START_MIN) { $("nextShiftDate").textContent = "Сегодня"; $("nextShiftMeta").textContent = "Начало в 08:00"; return; }
  const d = new Date(now); d.setDate(d.getDate() + 1);
  for (let i = 0; i < 366; i++) {
    if (isWork(d)) {
      const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
      $("nextShiftDate").textContent = diff === 1 ? "Завтра" : dateText(d, { weekday: "long", day: "numeric", month: "long" });
      $("nextShiftMeta").textContent = diff === 1 ? "Начало в 08:00" : `Через ${diff} ${plural(diff, "день", "дня", "дней")} · в 08:00`;
      return;
    }
    d.setDate(d.getDate() + 1);
  }
}

export async function saveHomeShift({ silent = false } = {}) {
  const { cases, holiday } = homeInputs();
  $("casesInput").value = String(cases);
  const k = todayKey();
  const meta = state.extra.shiftMeta?.[k];
  const v = makeShift(cases, holiday, meta?.bonus || 0);
  // Commit locally before any network await. Queue coalesces edits by owner/date.
  state.shifts[k] = v; save();
  state.homeDirty = false; renderAll();
  if (!silent) showToast("Смена сохранена ✓");
  if (accountId()) await cloudSaveShift(k, v);
}
