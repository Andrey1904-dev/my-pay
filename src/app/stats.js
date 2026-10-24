import { monthForecast } from "./pay.js";
import { accountId } from './cloud.js';
// История смен и графики статистики.
import { analyticsForMonth } from './pay.js';
import { $, dateText, fromKey, icon, integer, money, moneyShort, monthPrefix, num, plural } from './utils.js';
import { save, state } from './state.js';
import { deleteShift, goToCurrentMonth, openShiftModal } from './calendar.js';
import { confirmAction, showToast } from './dialogs.js';
import { cloudDeleteShift, cloudSaveExtra, flushCloudQueue } from './cloud.js';
import { renderAll, syncHomeInputsFromCloud } from './dashboard.js';

export function renderStats() {
  const a = analyticsForMonth(), es = a.es;
  const bs = es.reduce((x, v) => x + num(v.base), 0), ps = es.reduce((x, v) => x + num(v.piece), 0);
  $("statsMonth").textContent = dateText(state.calendarDate, { month: "long", year: "numeric" }).replace(" г.", "");
  $("statsMonth").onclick = goToCurrentMonth;
  $("monthTotal").textContent = money(a.sum);
  $("monthShiftsLabel").textContent = `${integer(es.length)} ${plural(es.length, "смена", "смены", "смен")}`;
  $("monthCasesLabel").textContent = `${integer(a.cases)} ${plural(a.cases, "чехол", "чехла", "чехлов")}`;
  $("avgShift").textContent = money(a.avg);
  $("monthPiece").textContent = money(ps); $("monthBase").textContent = money(bs);
  $("avgCases").textContent = integer(es.length ? Math.round(a.cases / es.length) : 0);
  const list = $("historyList");
  if (!es.length) { list.innerHTML = '<div class="empty">Пока нет сохранённых смен за этот месяц.</div>'; return; }
  list.innerHTML = [...es].sort((x, y) => y.k.localeCompare(x.k)).map(v => `
    <div class="history-item">
      <button type="button" class="history-left" data-open-shift="${v.k}" aria-label="Открыть смену">
        <b>${dateText(fromKey(v.k), { weekday: "short", day: "numeric", month: "long" })}</b>
        <small>${integer(v.cases)} ${plural(v.cases, "чехол", "чехла", "чехлов")} · сделка ${money(v.piece)}${v.holiday ? " · праздник" : ""}</small>
      </button>
      <div class="history-right"><b class="num">${money(v.total)}</b><small>${v.holiday ? "Праздничная" : "Обычная"}</small></div>
      <button type="button" class="history-delete" data-delete-shift="${v.k}" aria-label="Удалить смену">${icon("i-trash")}</button>
    </div>`).join("");
  list.querySelectorAll("[data-delete-shift]").forEach(b => b.onclick = async () => { if (await deleteShift(b.dataset.deleteShift)) showToast("Смена удалена · вернуть можно в «Ещё»"); });
  list.querySelectorAll("[data-open-shift]").forEach(b => b.onclick = () => { state.selectedDate = b.dataset.openShift; openShiftModal(b.dataset.openShift); });
}

export function renderInsights() {
  $("monthForecast").textContent = monthForecast(state.calendarDate) === null ? "После первой смены" : money(monthForecast(state.calendarDate));
  const a = analyticsForMonth();
  if (!a.es.length) {
    $("recordShift").textContent = money(0); $("shiftStreak").textContent = "0"; $("recordCases").textContent = "0"; $("bestDay").textContent = "—";
    $("bestShiftBadge").textContent = "Нет данных";
    $("earningsChart").innerHTML = '<div class="chart-empty">Здесь появится график после первой смены</div>';
    return;
  }
  $("recordShift").textContent = money(a.best?.total || 0);
  $("shiftStreak").textContent = String(a.bestStreak);
  $("recordCases").textContent = integer(a.cases);
  $("bestDay").textContent = a.best ? dateText(fromKey(a.best.k), { day: "numeric", month: "short" }) : "—";
  $("bestShiftBadge").textContent = a.best ? `Лучшая ${money(a.best.total)}` : "—";
  const last = a.es.slice(-12), vals = last.map(v => num(v.total)), max = Math.max(...vals, 1), min = Math.min(...vals);
  $("earningsChart").innerHTML = last.map(v => {
    // Масштаб от минимума к максимуму, чтобы разница между сменами была видна, а не тонула в одинаковых столбцах.
    const h = max > min ? Math.round(40 + (num(v.total) - min) / (max - min) * 70) : 90;
    return `<div class="bar-col"><div class="bar-value">${moneyShort(v.total)}</div><div class="bar${a.best && v.k === a.best.k ? " best" : ""}" style="height:${h}px" title="${dateText(fromKey(v.k), { day: "numeric", month: "long" })}: ${money(v.total)}"></div><small>${fromKey(v.k).getDate()}</small></div>`;
  }).join("");
}

export async function clearMonth() {
  const keys = Object.keys(state.shifts).filter(k => k.startsWith(monthPrefix(state.calendarDate)));
  if (!keys.length) { showToast("В этом месяце нечего удалять"); return; }
  const ok = await confirmAction({ title: "Очистить месяц?", text: `Будут удалены все смены за ${dateText(state.calendarDate, { month: "long", year: "numeric" })} — ${keys.length} ${plural(keys.length, "запись", "записи", "записей")}. Это действие нельзя отменить.`, okText: "Удалить всё" });
  if (!ok) return;
  const results = await Promise.all(keys.map(async k => [k, accountId() ? await cloudDeleteShift(k) : true]));
  const failed = results.filter(([, done]) => !done);
  results.filter(([, done]) => done).forEach(([k]) => { delete state.shifts[k]; delete state.extra.shiftMeta[k]; });
  state.extra.undo = null; save(); cloudSaveExtra(); state.homeDirty = false; syncHomeInputsFromCloud(); renderAll(); flushCloudQueue();
  showToast(failed.length ? `Удалено не всё: ${failed.length} ${plural(failed.length, "смена", "смены", "смен")} не удалось удалить` : "Месяц очищен");
}
