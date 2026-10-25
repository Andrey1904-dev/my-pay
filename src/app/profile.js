import { greetingName } from './greeting.js';
// Профиль и привязка Telegram.
import { currentUser, db } from './cloud.js';
import { $ } from './utils.js';
import { openModal, showToast } from './dialogs.js';

export function updateProfileUI() {
  const n = greetingName() || "Мой расчёт";
  $("profileName").textContent = n; $("profileAvatar").textContent = (n[0] || "₽").toUpperCase();
  const provider = currentUser?.app_metadata?.provider; const via = provider === "apple" ? "Apple" : provider === "google" ? "Google" : "";
  $("profileMeta").textContent = currentUser ? `${currentUser.email || ""}${via ? " · вход через " + via : ""} · синхронизация включена` : db ? "Войди в аккаунт, чтобы синхронизировать данные" : "Локальный режим: данные хранятся на этом устройстве";
  $("loginBtn").classList.toggle("hidden", !!currentUser);
  $("logoutBtn").classList.toggle("hidden", !currentUser); $("deleteAccountBtn").classList.toggle("hidden", !currentUser);
}

export async function loadTelegramStatus() {
  if (!db || !currentUser) return null;
  try {
    const { data, error } = await db.from("telegram_links").select("username,first_name,linked_at").eq("user_id", currentUser.id).maybeSingle();
    if (error || !data) { $("telegramMenuStatus").textContent = "Ввод чехлов прямо из чата"; return null; }
    const who = data.username ? "@" + data.username : (data.first_name || "аккаунт");
    $("telegramMenuStatus").textContent = `Привязан: ${who}`;
    return data;
  } catch { return null; }
}

export async function openTelegramModal() {
  if (!currentUser) { showToast("Сначала войди в аккаунт"); return; }
  $("telegramCode").textContent = "—"; $("telegramStatus").classList.add("hidden");
  openModal("telegramModal");
  const link = await loadTelegramStatus();
  if (link) {
    const who = link.username ? "@" + link.username : (link.first_name || "аккаунт Telegram");
    $("telegramStatus").querySelector("span").textContent = `Бот уже привязан: ${who}. Новый код нужен только для смены аккаунта Telegram.`;
    $("telegramStatus").classList.remove("hidden");
  }
}

export async function generateTelegramCode() {
  if (!db) { showToast("Облако недоступно — код привязки получить нельзя"); return; }
  if (!currentUser) { showToast("Сначала войди в аккаунт"); return; }
  const btn = $("telegramGenerateBtn"), label = btn.querySelector("span");
  btn.disabled = true; label.textContent = "Генерирую…";
  try {
    const { data, error } = await db.rpc("create_telegram_link_code");
    if (error) throw error;
    $("telegramCode").textContent = data || "—";
    if (data && navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(`/start ${data}`); showToast("Код готов · команда /start скопирована"); } catch { showToast("Код готов ✓"); } }
    else showToast("Код готов ✓");
  } catch (e) { console.error(e); showToast("Не удалось получить код. Проверь, что выполнен TELEGRAM_SUPABASE.sql"); }
  finally { btn.disabled = false; label.textContent = "Получить код"; }
}
