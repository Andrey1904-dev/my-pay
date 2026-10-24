// Диалоги и сообщения пользователю.
import { $ } from './utils.js';

export function showToast(text, ms = 2400) {
  const t = $("toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove("show"), ms);
}

export function openModal(id) { $(id).classList.remove("hidden"); }

export function closeModal(id) { $(id).classList.add("hidden"); }

export function anyModalOpen() { return !!document.querySelector(".modal:not(.hidden)"); }

export function confirmAction({ title = "Подтверди действие", text = "", okText = "Удалить", cancelText = "Отмена", danger = true } = {}) {
  return new Promise(resolve => {
    $("confirmTitle").textContent = title; $("confirmText").textContent = text;
    const ok = $("confirmOk"), cancel = $("confirmCancel");
    ok.querySelector("span").textContent = okText; cancel.querySelector("span").textContent = cancelText;
    ok.className = `btn btn-lg ${danger ? "btn-danger" : "btn-primary"}`;
    const done = v => { ok.onclick = cancel.onclick = null; closeModal("confirmModal"); $("confirmModal").onclick = null; resolve(v); };
    ok.onclick = () => done(true); cancel.onclick = () => done(false);
    $("confirmModal").onclick = e => { if (e.target === $("confirmModal")) done(false); };
    openModal("confirmModal"); setTimeout(() => cancel.focus(), 50);
  });
}

export function promptNumber({ title = "Сумма", text = "", label = "Сумма, ₽", value = "", okText = "Готово" } = {}) {
  return new Promise(resolve => {
    $("promptTitle").textContent = title; $("promptText").textContent = text; $("promptLabel").textContent = label;
    const input = $("promptInput"), ok = $("promptOk"), cancel = $("promptCancel");
    input.value = value === null || value === undefined ? "" : String(value);
    ok.querySelector("span").textContent = okText;
    const done = v => { ok.onclick = cancel.onclick = input.onkeydown = null; $("promptModal").onclick = null; closeModal("promptModal"); resolve(v); };
    ok.onclick = () => { const v = Number(String(input.value).replace(",", ".")); done(Number.isFinite(v) ? v : null); };
    cancel.onclick = () => done(null);
    input.onkeydown = e => { if (e.key === "Enter") ok.click(); };
    $("promptModal").onclick = e => { if (e.target === $("promptModal")) done(null); };
    openModal("promptModal"); setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}
