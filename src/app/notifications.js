import { workNow } from './utils.js';
// Локальные браузерные напоминания.
import { $, dateKey, dateText } from './utils.js';
import { showToast } from './dialogs.js';
import { isWork } from './pay.js';

export function refreshNotificationUI() {
  const supported = "Notification" in window, granted = supported && Notification.permission === "granted", denied = supported && Notification.permission === "denied";
  $("notificationMenuStatus").textContent = !supported ? "Не поддерживается в этом браузере" : granted ? "Включены ✓" : denied ? "Запрещены в настройках браузера" : "Напоминания о сменах";
  const tipBtn = $("enableNotificationsBtn");
  if (granted) { $("notificationTipText").textContent = "Уведомления включены. Напоминание о ближайшей смене приходит, пока приложение открыто и браузер разрешает выполнение в фоне. Установка на экран «Домой» не включает фоновые push-уведомления."; tipBtn.textContent = "Уведомления включены ✓"; tipBtn.disabled = true; }
  else if (denied) { $("notificationTipText").textContent = "Уведомления запрещены. Разрешить их можно в настройках сайта в браузере."; tipBtn.disabled = true; }
}

export async function enableNotifications() {
  if (!("Notification" in window)) { showToast("Этот браузер не поддерживает уведомления"); return; }
  if (!window.isSecureContext) { showToast("Для уведомлений нужен HTTPS"); return; }
  const permission = await Notification.requestPermission();
  if (permission === "granted") { scheduleShiftReminder(); showToast("Уведомления включены ✓"); }
  else showToast("Уведомления не разрешены");
  refreshNotificationUI();
}

export function scheduleShiftReminder() {
  // Локальное напоминание: работает, пока приложение может выполнять JS. Фоновый Web Push требует серверной части.
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = workNow();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(7, 30, 0, 0);
    if (!isWork(d)) continue;
    const key = "myPayReminder_" + dateKey(d);
    if (!localStorage.getItem(key) && d - now > 0) {
      setTimeout(() => {
        if (Notification.permission === "granted") { try { new Notification("CASE.PLACE SALARY", { body: `Сегодня рабочая смена — ${dateText(d, { day: "numeric", month: "long" })}. Начало в 08:00.`, icon: "./icon-192.png" }); } catch { /* ignore */ } }
        localStorage.setItem(key, "1");
      }, Math.min(new Date(`${dateKey(d)}T07:30:00+05:00`) - new Date(), 2147483647));
    }
    break;
  }
}
