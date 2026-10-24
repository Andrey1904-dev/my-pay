// Светлая, тёмная и системная темы.
import { save, state } from './state.js';
import { $ } from './utils.js';
import { cloudSaveExtra } from './cloud.js';
import { showToast } from './dialogs.js';

export function applyTheme() {
  const t = state.extra.theme || "system";
  const dark = t === "dark" || (t === "system" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("dark", dark);
  const status = $("themeStatus"); if (status) status.textContent = t === "system" ? "Как в системе" : t === "dark" ? "Тёмная" : "Светлая";
  const themeIcon = $("themeBtn")?.querySelector("use"); if (themeIcon) themeIcon.setAttribute("href", dark ? "#i-sun" : "#i-moon");
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", dark ? "#0a0c0f" : "#eeeeea"));
}

export function cycleTheme() {
  const order = ["system", "light", "dark"], i = order.indexOf(state.extra.theme || "system");
  state.extra.theme = order[(i + 1) % order.length];
  save(); applyTheme(); cloudSaveExtra(); showToast(`Тема: ${$("themeStatus").textContent}`);
}
