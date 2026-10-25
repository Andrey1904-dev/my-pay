import { cleanDisplayName, greetingName } from './greeting.js';
import { accountId } from './cloud.js';
// Редактирование тарифов и графика.
import { normalizeSettings, save, state } from './state.js';
import { $, clamp, num } from './utils.js';
import { closeModal, openModal, showToast } from './dialogs.js';
import { cloudSaveExtra, cloudSaveSettings } from './cloud.js';
import { renderAll } from './dashboard.js';

export function openSettings() {
  const s = state.settings;
  $("settingDisplayName").value = state.extra.displayName;
  $("settingDisplayName").placeholder = greetingName() || "Например, Андрей";
  $("settingBase").value = s.basePay; $("settingHoliday").value = s.holidayPay; $("settingPrice").value = s.casePrice;
  $("settingPercent").value = s.percent; $("settingStart").value = s.scheduleStart;
  $("settingAdvanceDay").value = state.extra.payday?.advanceDay || ""; $("settingSalaryDay").value = state.extra.payday?.salaryDay || "";
  openModal("settingsModal");
}

export async function saveSettings() {
  state.settings = normalizeSettings({
    basePay: $("settingBase").value, holidayPay: $("settingHoliday").value, casePrice: $("settingPrice").value,
    percent: $("settingPercent").value, scheduleStart: $("settingStart").value || state.settings.scheduleStart
  });
  const payday = { advanceDay: clamp(Math.round(num($("settingAdvanceDay").value, 0)), 0, 31), salaryDay: clamp(Math.round(num($("settingSalaryDay").value, 0)), 0, 31) };
  const name = cleanDisplayName($("settingDisplayName").value);
  const extraChanged = name !== state.extra.displayName || JSON.stringify(payday) !== JSON.stringify(state.extra.payday);
  state.extra.displayName = name; state.extra.payday = payday;
  save(); renderAll(); closeModal("settingsModal");
  const [extraOk, settingsOk] = accountId() ? await Promise.all([
    extraChanged ? cloudSaveExtra() : true, cloudSaveSettings()
  ]) : [true, true];
  showToast(extraOk && settingsOk ? "Настройки обновлены ✓" : "Настройки сохранены на устройстве, но не в облако");
}
