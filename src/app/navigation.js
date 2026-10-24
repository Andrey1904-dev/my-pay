import { renderGreeting } from './greeting.js';
import { showAuth } from './cloud.js';
// Навигация и обработчики интерфейса.
import { deleteModal, goToCurrentMonth, openShiftModal, renderCalendar, saveCalendarWorkday, saveModal, shiftMonth, undoLastDelete, updateModal } from './calendar.js';
import { clearMonth, renderInsights, renderStats } from './stats.js';
import { state } from './state.js';
import { homeInputs, saveHomeShift, updateHome, updateNextShiftCard } from './dashboard.js';
import { $, num } from './utils.js';
import { closeModal, showToast } from './dialogs.js';
import { openSettings, saveSettings } from './settings.js';
import { exportCsv, exportData, importData } from './backup.js';
import { applyTheme, cycleTheme } from './theme.js';
import { authAction, backAuth, deleteOwnAccount, logout, oauthSignIn, setAuthMode } from './cloud.js';
import { openPaydayModal, savePayday } from './payday.js';
import { openTemplateModal, saveTemplate } from './templates.js';
import { generateTelegramCode, openTelegramModal } from './profile.js';
import { enableNotifications } from './notifications.js';

const screens = ["homeScreen", "calendarScreen", "statsScreen", "moreScreen"];
export function showScreen(id, { history = true } = {}) {
  if (!screens.includes(id)) id = "homeScreen";
  if (history && location.hash !== "#" + id) window.history.pushState(null, "", "#" + id);
  document.querySelectorAll(".nav-item").forEach(x => { const active = x.dataset.screen === id; x.classList.toggle("active", active); if (active) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current"); });
  document.querySelectorAll(".screen").forEach(x => x.classList.toggle("active", x.id === id));
  if (id === "calendarScreen") renderCalendar();
  if (id === "statsScreen") { renderStats(); renderInsights(); }
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

export function markHomeDirty() { state.homeDirty = true; updateHome(); }

export function bumpCases(delta) { $("casesInput").value = String(Math.max(0, homeInputs().cases + delta)); markHomeDirty(); saveHomeShift({ silent: true }); }

export function bindEvents() {
  const restoreScreen = () => showScreen(location.hash.slice(1), { history: false });
  window.addEventListener("popstate", restoreScreen);
  restoreScreen();
  document.querySelectorAll(".nav-item").forEach(b => b.onclick = () => showScreen(b.dataset.screen));
  document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m && m.id !== "confirmModal" && m.id !== "promptModal") closeModal(m.id); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".modal:not(.hidden)").forEach(m => { if (m.id === "confirmModal") $("confirmCancel").click(); else if (m.id === "promptModal") $("promptCancel").click(); else closeModal(m.id); }); });
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => closeModal(b.dataset.close));

  $("casesInput").addEventListener("input", markHomeDirty);
  $("holidayInput").addEventListener("change", () => { markHomeDirty(); saveHomeShift({ silent: true }); });
  $("casesInput").addEventListener("change", () => saveHomeShift({ silent: true }));
  document.querySelectorAll(".step-btn").forEach(b => b.addEventListener("click", () => bumpCases(num(b.dataset.step))));
  document.querySelectorAll(".quick-row button").forEach(b => b.addEventListener("click", () => bumpCases(num(b.dataset.add))));
  $("saveShiftBtn").onclick = () => saveHomeShift();
  $("settingsBtn").onclick = openSettings; $("openSettingsFromMore").onclick = openSettings; $("settingsSave").onclick = saveSettings;

  $("prevMonth").onclick = () => shiftMonth(-1); $("nextMonth").onclick = () => shiftMonth(1); $("monthTitle").onclick = goToCurrentMonth;
  $("statsPrev").onclick = () => shiftMonth(-1); $("statsNext").onclick = () => shiftMonth(1);
  $("calendarWorkday").onchange = saveCalendarWorkday;
  $("editSelectedBtn").onclick = () => openShiftModal(state.selectedDate);
  ["modalCases", "modalHours", "modalBonus"].forEach(id => $(id).addEventListener("input", updateModal));
  $("modalHoliday").addEventListener("change", updateModal);
  $("modalSave").onclick = saveModal; $("modalDelete").onclick = deleteModal;
  $("clearMonthBtn").onclick = clearMonth;

  $("exportBtn").onclick = exportData; $("exportCsvBtn").onclick = exportCsv;
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = e => { const f = e.target.files[0]; if (f) importData(f); e.target.value = ""; };
  $("themeBtn").onclick = cycleTheme; $("undoDeleteBtn").onclick = undoLastDelete; $("logoutBtn").onclick = logout;

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; });
  $("installBtn").onclick = async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showToast(ios ? "Safari: «Поделиться» → «На экран Домой»" : "Меню браузера → «Установить приложение» или «Добавить на главный экран»", 4200);
  };

  $("continueLocal").onclick = () => showAuth(false);
  $("loginBtn").onclick = () => { backAuth(); showAuth(true); };
  $("goLogin").onclick = () => setAuthMode("login"); $("goSignup").onclick = () => setAuthMode("signup"); $("backAuth").onclick = backAuth; $("authAction").onclick = authAction;
  ["authEmail", "authPassword", "authPassword2", "authName"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") authAction(); }));

  $("oauthApple").onclick = () => oauthSignIn("apple"); $("oauthGoogle").onclick = () => oauthSignIn("google");
  $("deleteAccountBtn").onclick = deleteOwnAccount;
  $("paydaySetupBtn").onclick = openPaydayModal; $("paydaySave").onclick = savePayday;
  $("addTemplateBtn").onclick = openTemplateModal; $("templateSave").onclick = saveTemplate;

  $("telegramBotBtn").onclick = openTelegramModal; $("telegramGenerateBtn").onclick = generateTelegramCode;
  $("telegramHelpBtn").onclick = () => window.open("https://github.com/Andrey1904-dev/my-pay/blob/main/telegram_bot_setup.md", "_blank", "noopener");
  $("enableNotificationsBtn").onclick = enableNotifications; $("enableNotificationsMenu").onclick = enableNotifications;

  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if ((state.extra.theme || "system") === "system") applyTheme(); });
  setInterval(() => { if (!state.homeDirty) updateHome(); else { updateNextShiftCard(); renderGreeting(); } }, 60000);
}
