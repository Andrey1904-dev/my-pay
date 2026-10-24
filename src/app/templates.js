// Шаблоны смен.
import { $, escapeHtml, integer, money, num, todayKey, uid } from './utils.js';
import { closeModal, confirmAction, openModal, showToast } from './dialogs.js';
import { save, state } from './state.js';
import { cloudSaveExtra } from './cloud.js';
import { renderPaydayStrip } from './payday.js';
import { openShiftModal, updateModal } from './calendar.js';

export function openTemplateModal() { $("templateName").value = ""; $("templateCases").value = ""; $("templateHours").value = "11"; $("templateBonus").value = "0"; $("templateHoliday").checked = false; openModal("templateModal"); setTimeout(() => $("templateName").focus(), 80); }

export async function saveTemplate() {
  const name = $("templateName").value.trim(), cases = Math.max(0, Math.floor(num($("templateCases").value))), hours = Math.max(0, num($("templateHours").value)), bonus = Math.max(0, num($("templateBonus").value)), holiday = $("templateHoliday").checked;
  if (!name) { showToast("Укажи название шаблона"); return; }
  state.extra.templates.push({ id: uid("tpl"), name, cases, hours, bonus, holiday }); save(); cloudSaveExtra();
  closeModal("templateModal"); renderPaydayStrip(); showToast("Шаблон сохранён");
}

export async function deleteTemplate(id) {
  const t = state.extra.templates.find(x => x.id === id); if (!t) return;
  if (!await confirmAction({ title: "Удалить шаблон?", text: `«${t.name}» исчезнет из быстрого ввода.` })) return;
  state.extra.templates = state.extra.templates.filter(x => x.id !== id); save(); cloudSaveExtra(); renderPaydayStrip();
}

export function renderTemplates() {
  const box = $("templatesList"); if (!box) return;
  box.innerHTML = (state.extra.templates || []).map(x => `<button type="button" class="template-chip" data-tpl-use="${escapeHtml(x.id)}" title="Открыть сегодняшнюю смену с этим шаблоном. Долгое нажатие — удалить">${escapeHtml(x.name)}<small>${integer(x.cases)} шт · ${x.hours || 0} ч${x.bonus ? " · +" + money(x.bonus) : ""}${x.holiday ? " · праздник" : ""}</small></button>`).join("");
  box.querySelectorAll("[data-tpl-use]").forEach(b => {
    b.onclick = () => useTemplateToday(b.dataset.tplUse);
    b.oncontextmenu = e => { e.preventDefault(); deleteTemplate(b.dataset.tplUse); };
  });
}

export function renderModalTemplates() {
  const box = $("modalTemplatePills"); if (!box) return;
  box.innerHTML = (state.extra.templates || []).map(x => `<button type="button" class="template-chip" data-modal-tpl="${escapeHtml(x.id)}">${escapeHtml(x.name)}<small>${integer(x.cases)} шт</small></button>`).join("");
  box.querySelectorAll("[data-modal-tpl]").forEach(b => b.onclick = () => applyTemplateToModal(b.dataset.modalTpl));
}

export function applyTemplateToModal(id) {
  const t = state.extra.templates.find(x => x.id === id); if (!t) return;
  $("modalCases").value = t.cases || 0; $("modalHours").value = t.hours || 11; $("modalBonus").value = t.bonus || 0; $("modalHoliday").checked = !!t.holiday; updateModal();
}

export function useTemplateToday(id) { const k = todayKey(); state.selectedDate = k; openShiftModal(k); applyTemplateToModal(id); }
