// Импорт и экспорт резервных копий и CSV.
import { APP_VERSION } from './config.js';
import { normalizeExtra, normalizeSettings, save, state } from './state.js';
import { isDateKey, num, todayKey } from './utils.js';
import { showToast } from './dialogs.js';
import { makeShift } from './pay.js';
import { applyTheme } from './theme.js';
import { renderAll, syncHomeInputsFromCloud } from './dashboard.js';
import { queueCloudOp, settingsPayload, flushCloudQueue, accountId } from './cloud.js';

export function downloadFile(name, content, type) {
  const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildBackup() { return { version: parseInt(APP_VERSION, 10), exportedAt: new Date().toISOString(), settings: state.settings, shifts: state.shifts, extra: state.extra }; }

export function exportData() { downloadFile(`case-place-salary-${todayKey()}.json`, JSON.stringify(buildBackup(), null, 2), "application/json"); showToast("Резервная копия скачана ✓"); }

export function parseBackup(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== "object" || !d.settings || !d.shifts || typeof d.shifts !== "object") throw new Error("invalid backup");
  const settings = normalizeSettings(d.settings);
  const shifts = {};
  for (const [date, raw] of Object.entries(d.shifts)) {
    if (!isDateKey(date) || !raw || typeof raw !== "object") continue;
    const shift = { cases: Math.max(0, Math.floor(num(raw.cases))), holiday: !!raw.holiday, bonus: Math.max(0, num(raw.bonus)) };
    if ([raw.base, raw.piece, raw.total].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0) && raw.total + .01 >= raw.base + raw.piece) {
      Object.assign(shift, { base: raw.base, piece: raw.piece, total: raw.total });
    }
    shifts[date] = shift;
  }
  return { settings, shifts, extra: d.extra && typeof d.extra === "object" ? normalizeExtra(d.extra) : null };
}

// Import merges shift dates. Stored historical pay is preserved instead of
// recalculating an old shift at the current tariff.
export async function restoreBackup(parsed) {
  state.settings = parsed.settings;
  if (parsed.extra) state.extra = parsed.extra;
  for (const [date, shift] of Object.entries(parsed.shifts)) {
    const meta = state.extra.shiftMeta[date] || {};
    const value = shift.total !== undefined ? {
      cases: shift.cases, holiday: shift.holiday, base: shift.base, piece: shift.piece, total: shift.total
    } : makeShift(shift.cases, shift.holiday, meta.bonus ?? shift.bonus ?? 0);
    state.shifts[date] = value;
    state.extra.shiftMeta[date] = { ...meta, bonus: Math.max(0, value.total - value.base - value.piece) };
  }
  save(); applyTheme(); state.homeDirty = false; syncHomeInputsFromCloud(); renderAll();
  if (!accountId()) return true;
  // Persist the complete import before the first network request. A failed
  // settings upload must not strand the imported shifts outside the queue.
  queueCloudOp({ type: "saveSettings", settings: settingsPayload() });
  queueCloudOp({ type: "saveExtra", extra: state.extra });
  for (const [date, shift] of Object.entries(state.shifts)) queueCloudOp({ type: "saveShift", date, shift });
  return flushCloudQueue();
}

export function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const synced = await restoreBackup(parseBackup(String(reader.result)));
      showToast(synced ? "Данные восстановлены ✓" : "Данные восстановлены на устройстве и ждут синхронизации");
    } catch (err) { console.error("importData:", err); showToast("Не удалось прочитать файл резервной копии"); }
  };
  reader.onerror = () => showToast("Не удалось прочитать файл резервной копии");
  reader.readAsText(file);
}

export function buildCsv() {
  const rows = [["Дата", "Чехлы", "Праздник", "Ставка", "Сделка", "Премия", "Итого", "Часы", "Доход/час", "Комментарий"]];
  Object.entries(state.shifts).sort(([a], [b]) => a.localeCompare(b)).forEach(([k, v]) => {
    const m = state.extra.shiftMeta?.[k] || {}, h = num(m.hours);
    rows.push([k, v.cases, v.holiday ? "Да" : "Нет", v.base, v.piece, num(m.bonus), v.total, h, h ? Math.round(num(v.total) / h * 100) / 100 : "", m.note || ""]);
  });
  return "\uFEFF" + rows.map(r => r.map(x => '"' + String(x ?? "").replace(/"/g, '""') + '"').join(";")).join("\n");
}

export function exportCsv() { downloadFile(`case-place-salary-${todayKey()}.csv`, buildCsv(), "text/csv;charset=utf-8"); showToast("CSV скачан ✓"); }
