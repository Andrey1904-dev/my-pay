import { greetingWorkDay } from './greeting.js';
import { accountId } from './cloud.js';
import { workNow } from './utils.js';
// Календарь, редактирование, удаление и восстановление смен.
import { save, state } from './state.js';
import { $, dateKey, dateText, fromKey, integer, money, num, plural, todayKey } from './utils.js';
import { makeShift, total } from './pay.js';
import { renderInsights, renderStats } from './stats.js';
import { renderModalTemplates } from './templates.js';
import { closeModal, confirmAction, openModal, showToast } from './dialogs.js';
import { cloudDeleteShift, cloudSaveExtra, cloudSaveShift } from './cloud.js';
import { renderAll, syncHomeInputsFromCloud } from './dashboard.js';

export function renderCalendar() {
  const d = state.calendarDate;
  $("monthTitle").textContent = dateText(d, { month: "long", year: "numeric" }).replace(" г.", "");
  const first = new Date(d.getFullYear(), d.getMonth(), 1), offset = (first.getDay() + 6) % 7;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), box = $("calendarDays");
  const today = todayKey(), frag = document.createDocumentFragment();
  for (let i = 0; i < offset; i++) { const e = document.createElement("div"); e.className = "day empty"; frag.appendChild(e); }
  for (let n = 1; n <= days; n++) {
    const x = new Date(d.getFullYear(), d.getMonth(), n), k = dateKey(x), s = state.shifts[k], b = document.createElement("button");
    b.type = "button"; b.className = "day"; b.setAttribute("role", "gridcell");
    if (greetingWorkDay(x)) b.classList.add("work");
    if (s) { b.classList.add("saved"); if (s.holiday) b.classList.add("holiday"); }
    if (k === today) b.classList.add("today");
    if (k === state.selectedDate) { b.classList.add("selected"); b.setAttribute("aria-selected", "true"); }
    b.textContent = n;
    b.setAttribute("aria-label", `${dateText(x, { day: "numeric", month: "long" })}${s ? ", смена " + money(s.total) : greetingWorkDay(x) ? ", рабочий день" : ", выходной"}`);
    if (s) { const i = document.createElement("i"); i.className = "tiny"; b.appendChild(i); }
    b.onclick = () => { if (state.selectedDate === k) openShiftModal(k); else selectCalendarDate(k); };
    frag.appendChild(b);
  }
  box.replaceChildren(frag);
  renderSelectedCard();
}

export function renderSelectedCard() {
  const k = state.selectedDate, d = fromKey(k), s = state.shifts[k], meta = state.extra.shiftMeta?.[k];
  $("selectedDate").textContent = dateText(d, { weekday: "long", day: "numeric", month: "long" });
  const parts = [];
  if (s) { parts.push(s.holiday ? "Праздничная смена" : "Смена внесена"); parts.push(`${integer(s.cases)} ${plural(s.cases, "чехол", "чехла", "чехлов")}`); if (meta?.note) parts.push(meta.note); }
  else parts.push(greetingWorkDay(d) ? "Рабочий день" : "Выходной");
  $("calendarWorkday").value = state.extra.workdayOverrides[k] === true ? "work" : state.extra.workdayOverrides[k] === false ? "off" : "auto";
  $("selectedStatus").textContent = parts.join(" · ");
  $("selectedMoney").textContent = s ? money(s.total) : "—";
  $("editSelectedBtn").querySelector("span").textContent = s ? "Изменить смену" : "Внести смену";
}

export function selectCalendarDate(k) { state.selectedDate = k; renderCalendar(); }

export function shiftMonth(delta) {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + delta, 1);
  renderCalendar(); renderStats(); renderInsights();
}

export function goToCurrentMonth() { state.calendarDate = workNow(); state.selectedDate = todayKey(); renderCalendar(); renderStats(); renderInsights(); }

export function openShiftModal(k) {
  state.modalDate = k;
  const s = state.shifts[k], m = state.extra.shiftMeta?.[k] || {};
  $("modalDate").textContent = dateText(fromKey(k), { weekday: "long", day: "numeric", month: "long" });
  $("modalCases").value = s ? String(s.cases ?? "") : "";
  $("modalHoliday").checked = !!s?.holiday;
  $("modalHours").value = m.hours ?? 11; $("modalBonus").value = m.bonus ?? 0; $("modalNote").value = m.note ?? "";
  $("modalHolidayRate").textContent = money(state.settings.holidayPay);
  $("modalDelete").classList.toggle("hidden", !s);
  renderModalTemplates(); updateModal(); openModal("shiftModal");
  setTimeout(() => $("modalCases").focus(), 80);
}

export function modalInputs() {
  return {
    cases: Math.max(0, Math.floor(num($("modalCases").value))), holiday: $("modalHoliday").checked,
    bonus: Math.max(0, num($("modalBonus").value)), hours: Math.max(0, num($("modalHours").value)), note: $("modalNote").value.trim()
  };
}

export function updateModal() {
  const { cases, holiday, bonus, hours } = modalInputs();
  const sum = total(cases, holiday) + bonus;
  $("modalTotal").textContent = money(sum);
  $("modalHourly").textContent = hours ? `≈ ${money(sum / hours)} в час` : "Укажи часы, чтобы увидеть доход в час";
}

export async function saveModal() {
  const k = state.modalDate; if (!k) return;
  const { cases, holiday, bonus, hours, note } = modalInputs();
  const v = makeShift(cases, holiday, bonus), previous = state.shifts[k], previousMeta = state.extra.shiftMeta[k];
  state.shifts[k] = v; state.extra.shiftMeta[k] = { hours, bonus, note }; save();
  if (accountId() && !await cloudSaveShift(k, v)) {
    if (previous) state.shifts[k] = previous; else delete state.shifts[k];
    if (previousMeta) state.extra.shiftMeta[k] = previousMeta; else delete state.extra.shiftMeta[k];
    save(); return;
  }
  cloudSaveExtra();
  if (k === todayKey()) { state.homeDirty = false; syncHomeInputsFromCloud(); }
  state.selectedDate = k; renderAll(); closeModal("shiftModal"); showToast("Смена сохранена ✓");
}

export async function deleteShift(k, { confirmFirst = true } = {}) {
  const s = state.shifts[k]; if (!s) return false;
  if (confirmFirst) {
    const ok = await confirmAction({ title: "Удалить смену?", text: `${dateText(fromKey(k), { day: "numeric", month: "long" })} · ${money(s.total)}. Удалённую смену можно вернуть в разделе «Ещё».` });
    if (!ok) return false;
  }
  const meta = state.extra.shiftMeta?.[k] || null;
  state.extra.undo = { date: k, shift: s, meta };
  delete state.shifts[k]; delete state.extra.shiftMeta[k]; save();
  if (accountId() && !await cloudDeleteShift(k)) { state.shifts[k] = s; if (meta) state.extra.shiftMeta[k] = meta; state.extra.undo = null; save(); return false; }
  cloudSaveExtra();
  if (k === todayKey()) { state.homeDirty = false; syncHomeInputsFromCloud(); }
  renderAll(); return true;
}

export async function deleteModal() {
  const k = state.modalDate; if (!k) return;
  if (await deleteShift(k)) { closeModal("shiftModal"); showToast("Смена удалена · вернуть можно в «Ещё»"); }
}

export async function undoLastDelete() {
  const u = state.extra.undo; if (!u?.shift) return;
  state.shifts[u.date] = u.shift; if (u.meta) state.extra.shiftMeta[u.date] = u.meta; state.extra.undo = null; save();
  if (accountId() && !await cloudSaveShift(u.date, u.shift)) { delete state.shifts[u.date]; delete state.extra.shiftMeta[u.date]; state.extra.undo = u; save(); return; }
  cloudSaveExtra();
  if (u.date === todayKey()) syncHomeInputsFromCloud();
  renderAll(); showToast("Смена восстановлена ✓");
}

export function refreshUndoUI() {
  const u = state.extra.undo, b = $("undoDeleteBtn"); if (!b) return;
  b.classList.toggle("hidden", !u?.shift);
  if (u?.shift) $("undoDeleteMeta").textContent = `${dateText(fromKey(u.date), { day: "numeric", month: "long" })} · ${money(u.shift.total)}`;
}

export function saveCalendarWorkday() {
  const value = $("calendarWorkday").value;
  if (value === 'auto') delete state.extra.workdayOverrides[state.selectedDate];
  else state.extra.workdayOverrides[state.selectedDate] = value === 'work';
  save(); renderAll(); cloudSaveExtra();
}
