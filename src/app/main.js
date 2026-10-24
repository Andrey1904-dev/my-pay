import { bindGreetingClock, renderGreeting, greetingWorkDay, consecutiveWorkdays, greetingMessage, ordinalFeminine } from './greeting.js';
import { workNow } from './utils.js';
import { oauthSignIn, deleteOwnAccount, loadQueue, queueCloudOp, flushCloudQueue, setAuthMode, backAuth } from './cloud.js';
import { saveTemplate, applyTemplateToModal } from './templates.js';
import { showToast, confirmAction, promptNumber } from './dialogs.js';
import { showScreen } from './navigation.js';
import { cycleTheme } from './theme.js';
import { openSettings, saveSettings } from './settings.js';
import { renderPaydayStrip, paydayInfo, savePayday } from './payday.js';
import { renderStats, renderInsights, clearMonth } from './stats.js';
import { renderCalendar, openShiftModal, saveModal, deleteShift, undoLastDelete, selectCalendarDate, shiftMonth, goToCurrentMonth } from './calendar.js';
import { updateHome, saveHomeShift } from './dashboard.js';
import { restoreBackup, parseBackup, buildBackup, buildCsv } from './backup.js';
import { piece, base, total, makeShift, isWork, monthEntries, monthForecast, analyticsForMonth } from './pay.js';
import { money, moneyShort, integer, plural, dateKey, fromKey, isDateKey, escapeHtml } from './utils.js';
import { DEFAULTS, normalizeSettings, normalizeExtra } from './state.js';
// Точка входа PWA. script.js генерируется сборкой.
import { $ } from './utils.js';
import { APP_VERSION } from './config.js';
import { save, state } from './state.js';
import { correctLegacyShift } from './pay.js';
import { applyTheme } from './theme.js';
import { bindEvents } from './navigation.js';
import { renderAll, syncHomeInputsFromCloud } from './dashboard.js';
import { refreshNotificationUI, scheduleShiftReminder } from './notifications.js';
import { currentUser, db, initCloudAuth } from './cloud.js';

export function init() {
  $("appVersion").textContent = "V" + APP_VERSION;
  $("brandVersion").textContent = "V" + APP_VERSION;
  state.shifts = Object.fromEntries(Object.entries(state.shifts).map(([k, s]) => [k, correctLegacyShift(s)]));
  save();
  applyTheme(); bindEvents();
  syncHomeInputsFromCloud(); renderAll(); refreshNotificationUI();
  if ("Notification" in window && Notification.permission === "granted") scheduleShiftReminder();
  initCloudAuth(); bindGreetingClock();
}

init();

window.MyPay = {
  version: APP_VERSION, state, DEFAULTS,
  renderGreeting, greetingWorkDay, consecutiveWorkdays, greetingMessage, ordinalFeminine,
  workNow, money, moneyShort, integer, plural, dateKey, fromKey, isDateKey, escapeHtml,
  piece, base, total, makeShift, isWork, monthEntries, monthForecast, analyticsForMonth,
  normalizeSettings, normalizeExtra, correctLegacyShift, parseBackup, restoreBackup, buildBackup, buildCsv,
  save, renderAll, updateHome, renderCalendar, renderStats, renderInsights, renderPaydayStrip,
  saveHomeShift, openShiftModal, saveModal, deleteShift, undoLastDelete, clearMonth, selectCalendarDate, shiftMonth, goToCurrentMonth,
  openSettings, saveSettings, cycleTheme, applyTheme, showScreen, showToast, confirmAction, promptNumber,
  saveTemplate, applyTemplateToModal, paydayInfo, savePayday, oauthSignIn, deleteOwnAccount,
  loadQueue, queueCloudOp, flushCloudQueue, setAuthMode, backAuth,
  get currentUser() { return currentUser; }, get homeDirty() { return state.homeDirty; }, get cloudAvailable() { return !!db; }
};
