// Авторизация, синхронизация и постоянная очередь операций.
import { $, isDateKey, num, todayKey, uid } from './utils.js';
import { anyModalOpen, confirmAction, promptNumber, showToast } from './dialogs.js';
import { loadTelegramStatus, updateProfileUI } from './profile.js';
import { DEFAULTS, isLegacySet, normalizeExtra, normalizeSettings, save, state, structuredCloneSafe } from './state.js';
import { renderAll, syncHomeInputsFromCloud } from './dashboard.js';
import { correctLegacyShift } from './pay.js';
import { applyTheme } from './theme.js';

export const SUPABASE_URL = "https://dyixwxxpjmyycgigcbtx.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NFxxL8WDGpG-ASXo2LasmQ_wskniL6r";

export const CLOUD_EXTRA_TABLE = "user_app_data";

export let db = null;

try {
  if (window.supabase && typeof window.supabase.createClient === "function") {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
    });
  } else {
    console.warn("Supabase SDK не загрузился — работаем в локальном режиме.");
  }
} catch (e) { console.warn("Supabase init failed:", e); }

export let currentUser = null, currentProfile = null, authMode = "login";

export function showAuth(show) { $("authModal").classList.toggle("hidden", !show); }

export function setStatus(t) { $("authStatus").textContent = t || ""; }

export function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("authWelcome").classList.add("hidden"); $("authForm").classList.remove("hidden");
  $("signupNameWrap").classList.toggle("hidden", !signup); $("confirmPasswordWrap").classList.toggle("hidden", !signup);
  $("authOverline").textContent = signup ? "Регистрация" : "Вход";
  $("authTitle").textContent = signup ? "Создай аккаунт" : "С возвращением";
  $("authSubtitle").textContent = signup ? "Имя, email и пароль — больше ничего не понадобится." : "Введи email и пароль, чтобы открыть приложение.";
  $("authAction").querySelector("span").textContent = signup ? "Создать аккаунт" : "Войти";
  $("authSwitch").innerHTML = signup ? 'Уже есть аккаунт? <button id="switchAuth">Войти</button>' : 'Нет аккаунта? <button id="switchAuth">Зарегистрироваться</button>';
  $("switchAuth").onclick = () => setAuthMode(signup ? "login" : "signup");
  $("authPassword").setAttribute("autocomplete", signup ? "new-password" : "current-password");
  setStatus("");
  setTimeout(() => (signup ? $("authName") : $("authEmail")).focus(), 60);
}

export function backAuth() { $("authForm").classList.add("hidden"); $("authWelcome").classList.remove("hidden"); setStatus(""); }

export function friendlyAuthError(error, signup) {
  const m = (error?.message || "").toLowerCase();
  if (error?.status === 0 || /fetch|network|failed to fetch/.test(m)) return "Нет соединения с сервером. Проверь интернет.";
  if (/email not confirmed/.test(m)) return "Подтверди email по ссылке из письма, затем войди.";
  if (/rate limit|too many/.test(m)) return "Слишком много попыток. Подожди минуту и попробуй снова.";
  if (signup) {
    if (/already registered|already been registered|user already registered/.test(m)) return "Этот email уже зарегистрирован.";
    if (/email provider is disabled|email signups are disabled/.test(m)) return "Регистрация отключена. Включи Authentication → Providers → Email.";
    if (/invalid.*email|email.*invalid/.test(m)) return "Укажи корректный email.";
    if (/password.*(6|characters)|weak password/.test(m)) return "Пароль должен быть минимум 6 символов.";
    return error?.message || "Не удалось создать аккаунт.";
  }
  return "Неверный email или пароль.";
}

export async function authAction() {
  if (!db) { setStatus("Облако недоступно: не загрузился модуль Supabase (проверь интернет или блокировщик скриптов). Данные сохраняются на этом устройстве."); return; }
  const email = $("authEmail").value.trim().toLowerCase(), password = $("authPassword").value;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus("Укажи корректный email."); return; }
  if (password.length < 6) { setStatus("Пароль должен быть минимум 6 символов."); return; }
  const btn = $("authAction"), label = btn.querySelector("span"), prev = label.textContent;
  btn.disabled = true; label.textContent = "Секунду…";
  try {
    if (authMode === "login") {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw new Error(friendlyAuthError(error, false));
      currentUser = data.user; await afterLogin(); setStatus("");
    } else {
      const name = $("authName").value.trim(), p2 = $("authPassword2").value;
      if (name.length < 2) throw new Error("Напиши имя.");
      if (password !== p2) throw new Error("Пароли не совпадают.");
      const guest = !localStorage.getItem("myPayDataOwner") ? structuredCloneSafe({ settings: state.settings, shifts: state.shifts, extra: state.extra }) : null;
      const { data, error } = await db.auth.signUp({ email, password, options: { data: { name } } });
      if (error) throw new Error(friendlyAuthError(error, true));
      if (!data.user) throw new Error("Не удалось создать аккаунт.");
      if (!data.session) { setStatus("Аккаунт создан. Подтверди email по ссылке из письма, затем войди."); return; }
      currentUser = data.user;
      if (guest) {
        localStorage.setItem("myPayDataOwner", currentUser.id);
        queueCloudOp({ type: "saveSettings", settings: settingsPayload() });
        queueCloudOp({ type: "saveExtra", extra: guest.extra });
        for (const [date, shift] of Object.entries(guest.shifts)) queueCloudOp({ type: "saveShift", date, shift });
      }
      if (!await cloudSaveProfile(name)) throw new Error("Аккаунт создан, но не удалось сохранить профиль. Проверь SQL-схему и RLS.");
      if (!await ensureCloudDefaults()) throw new Error("Аккаунт создан, но не удалось сохранить настройки. Проверь SQL-схему и RLS.");
      await afterLogin(); showToast("Аккаунт создан. Добро пожаловать ✨");
    }
  } catch (e) { setStatus(e.message || "Что-то пошло не так."); }
  finally { btn.disabled = false; label.textContent = prev === "Секунду…" ? (authMode === "signup" ? "Создать аккаунт" : "Войти") : prev; }
}

export async function loadAuthProviders() {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
    if (!response.ok) return;
    const { external = {} } = await response.json();
    $("oauthApple").classList.toggle("hidden", !external.apple);
    $("oauthGoogle").classList.toggle("hidden", !external.google);
  } catch { /* Email and local mode remain available when discovery fails. */ }
}

export async function initCloudAuth() {
  if (db) loadAuthProviders();
  if (!db) { showAuth(false); showCloudNotice(); updateProfileUI(); return; }
  try {
    const { data: { session } } = await db.auth.getSession();
    cleanOAuthUrl();
    if (session?.user) { currentUser = session.user; await afterLogin(); } else showAuth(false);
    db.auth.onAuthStateChange((_event, s) => {
      if (s?.user && s.user.id !== currentUser?.id) { currentUser = s.user; setTimeout(() => afterLogin(), 0); }
      else if (!s && currentUser) { currentUser = null; currentProfile = null; hideCloudNotice(); showAuth(true); backAuth(); }
    });
  } catch (e) { console.error("initCloudAuth:", e); showAuth(false); showCloudNotice(); }
}

export async function oauthSignIn(provider) {
  if (!db) { showToast("Облако недоступно — вход без интернета невозможен"); return; }
  const btn = $(provider === "apple" ? "oauthApple" : "oauthGoogle"); btn.disabled = true;
  try {
    // Return OAuth users to this exact page (the dashboard lives at the main URL).
    const redirectTo = location.origin + location.pathname;
    const { error } = await db.auth.signInWithOAuth({ provider, options: { redirectTo, scopes: provider === "apple" ? "name email" : "email profile", queryParams: provider === "google" ? { access_type: "online", prompt: "select_account" } : undefined } });
    if (error) throw error;
  } catch (e) { console.error("oauth:", e); showToast(provider === "apple" ? "Вход через Apple не удался: " + humanAuthError(e) : "Вход через Google не удался: " + humanAuthError(e), 4200); btn.disabled = false; }
}

export function humanAuthError(e) {
  const m = String(e?.message || e || "");
  if (/provider is not enabled|Unsupported provider/i.test(m)) return "провайдер не включён в Supabase";
  if (/network|fetch/i.test(m)) return "нет сети";
  return m || "неизвестная ошибка";
}

export function cleanOAuthUrl() {
  try {
    const u = new URL(location.href);
    if (u.searchParams.has("code") || u.searchParams.has("error_description") || u.hash.includes("access_token")) { u.search = ""; u.hash = ""; history.replaceState(null, "", u.toString()); }
  } catch { /* ignore */ }
}

export async function deleteOwnAccount() {
  if (!currentUser || !db) { showToast("Сначала войди в аккаунт"); return; }
  const ok = await confirmAction({ title: "Удалить аккаунт навсегда?", text: "Будут стёрты профиль, смены, настройки и привязка Telegram. Это действие нельзя отменить.", okText: "Удалить всё", danger: true });
  if (!ok) return;
  const sure = await promptNumber({ title: "Подтверждение", text: "Чтобы подтвердить удаление, введи число 1904.", label: "Код подтверждения", value: "", okText: "Удалить аккаунт" });
  if (sure !== 1904) { if (sure !== null) showToast("Код не совпал — ничего не удалено"); return; }
  try {
    const { error } = await db.rpc("delete_own_account");
    if (error) throw error;
  } catch (e) { console.error("deleteOwnAccount:", e); showToast("Не удалось удалить аккаунт: " + humanAuthError(e) + ". Напиши в поддержку.", 5000); return; }
  try { await db.auth.signOut(); } catch { /* сессия уже недействительна */ }
  currentUser = null; currentProfile = null; state.homeDirty = false;
  state.shifts = {}; state.settings = normalizeSettings({ ...DEFAULTS, scheduleStart: todayKey() }); state.extra = normalizeExtra({});
  localStorage.removeItem("myPayCloudQueue"); localStorage.removeItem("myPayDataOwner"); save(); renderAll(); showAuth(true); backAuth(); showToast("Аккаунт удалён. Спасибо, что был с нами.", 4200);
}

export async function logout() {
  const ok = await confirmAction({ title: "Выйти из аккаунта?", text: "Данные останутся в облаке. На этом устройстве они будут очищены.", okText: "Выйти", danger: false });
  if (!ok) return;
  if (loadQueue().some(op => op.userId === currentUser?.id) && !await flushCloudQueue()) {
    showToast("Сначала дождись синхронизации или сохрани резервную копию — есть неотправленные изменения", 5000); return;
  }
  try { if (db) { const { error } = await db.auth.signOut(); if (error) throw error; } }
  catch (e) { console.warn("signOut:", e); showToast("Не удалось выйти: проверь соединение"); return; }
  currentUser = null; currentProfile = null; state.homeDirty = false;
  const keepTheme = state.extra.theme || "system";
  state.shifts = {}; state.settings = normalizeSettings({ ...DEFAULTS, scheduleStart: todayKey() }); state.extra = normalizeExtra({ theme: keepTheme });
  localStorage.removeItem("myPayCloudQueue"); localStorage.removeItem("myPayDataOwner");
  save(); renderAll(); showAuth(true); backAuth(); showToast("Ты вышел из аккаунта");
}

export function showCloudNotice(text) {
  const n = $("cloudNotice"); if (!n) return;
  n.classList.remove("hidden");
  n.querySelector("span").textContent = text || "Облако недоступно — приложение работает в локальном режиме. Синхронизация включится, когда появится связь с Supabase.";
}

export function hideCloudNotice() { $("cloudNotice")?.classList.add("hidden"); }

export let afterLoginInFlight = null;

export async function afterLogin() {
  if (afterLoginInFlight) return afterLoginInFlight;
  afterLoginInFlight = (async () => {
    const owner = localStorage.getItem("myPayDataOwner");
    if (owner && owner !== currentUser.id) {
      // Do not upload the previous account's cached data or pending operations.
      state.settings = normalizeSettings(DEFAULTS); state.shifts = {};
      state.extra = normalizeExtra({ theme: state.extra.theme }); state.homeDirty = false;
      saveQueue([]); save();
    }
    localStorage.setItem("myPayDataOwner", currentUser.id);
    const synced = await cloudLoad();
    if (!synced) {
      if (!navigator.onLine || !db || loadQueue().some(op => op.userId === currentUser.id)) {
        showAuth(false); showCloudNotice("Нет сети — работаем офлайн. Изменения синхронизируются автоматически, когда связь появится."); renderAll();
        showToast("Изменения сохранены на устройстве и ждут синхронизации"); startCloudRefresh(); return true;
      }
      showAuth(true); setStatus("Не удалось синхронизировать данные. Проверь интернет и попробуй войти снова."); return false;
    }
    showAuth(false); hideCloudNotice(); renderAll(); startCloudRefresh(); loadTelegramStatus();
    return true;
  })();
  try { return await afterLoginInFlight; } finally { afterLoginInFlight = null; }
}

export let cloudRefreshTimer = null, cloudListenersBound = false;

export function startCloudRefresh() {
  if (cloudRefreshTimer) clearInterval(cloudRefreshTimer);
  cloudRefreshTimer = setInterval(() => {
    if (!currentUser || document.hidden || anyModalOpen() || state.homeDirty) return;
    cloudLoad();
  }, 30000);
  if (cloudListenersBound) return; // слушатели регистрируем один раз, иначе при повторном входе они дублируются
  cloudListenersBound = true;
  document.addEventListener("visibilitychange", () => { if (!document.hidden && currentUser && !anyModalOpen()) cloudLoad(); });
  window.addEventListener("online", () => { if (currentUser) cloudLoad(); });
}

export let localRevision = 0;

export let cloudLoadInFlight = null;

export async function cloudLoad() {
  if (!currentUser || !db) return false;
  if (cloudLoadInFlight) return cloudLoadInFlight;
  const userId = currentUser.id;
  cloudLoadInFlight = (async () => {
    try {
      // Replay durable snapshots before fetching. A failed write must never be
      // overwritten by a stale server response, including after a page reload.
      await flushCloudQueue();
      if (currentUser?.id !== userId || loadQueue().some(op => op.userId === userId)) return false;
      const revision = localRevision;
      const [settingsResult, shiftsResult, profileResult, extraResult] = await Promise.all([
        db.from("settings").select("*").eq("user_id", userId).maybeSingle(),
        db.from("shifts").select("*").eq("user_id", userId).order("work_date", { ascending: true }),
        db.from("profiles").select("id,name").eq("id", userId).maybeSingle(),
        db.from(CLOUD_EXTRA_TABLE).select("payload").eq("user_id", userId).maybeSingle()
      ]);
      if (currentUser?.id !== userId || loadQueue().some(op => op.userId === userId)) return false;
      if (revision !== localRevision) return false;
      for (const result of [settingsResult, shiftsResult, profileResult, extraResult]) {
        if (result.error) throw result.error;
      }
      const sd = settingsResult.data;
      if (sd) {
        state.settings = normalizeSettings({
          basePay: sd.base_pay, holidayPay: sd.holiday_pay,
          casePrice: sd.case_price, percent: sd.piece_percent,
          scheduleStart: sd.schedule_start || state.settings.scheduleStart
        });
      }
      currentProfile = profileResult.data || null;
      state.shifts = Object.fromEntries((shiftsResult.data || []).filter(x => isDateKey(x.work_date)).map(x => [x.work_date,
        correctLegacyShift({ cases: num(x.cases), holiday: !!x.is_holiday, base: num(x.base_pay), piece: num(x.piece_pay), total: num(x.total_pay) })]));
      state.extra = normalizeExtra(extraResult.data?.payload || { theme: state.extra.theme });
      save(); applyTheme(); syncHomeInputsFromCloud(); hideCloudNotice(); renderAll();
      if (!sd || isLegacySet(sd.base_pay, sd.case_price, sd.piece_percent)) await cloudSaveSettings();
      if (!currentProfile?.name) {
        const meta = currentUser.user_metadata || {};
        const name = String(meta.full_name || meta.name || [meta.given_name, meta.family_name].filter(Boolean).join(" ") || "").trim();
        if (name) await cloudSaveProfile(name);
      }
      return true;
    } catch (e) { console.error("cloudLoad:", e); showCloudNotice("Не удалось синхронизировать данные. Локальные изменения сохранены; проверь соединение и схему Supabase."); return false; }
  })();
  try { return await cloudLoadInFlight; } finally { cloudLoadInFlight = null; }
}

export function settingsPayload() {
  const s = state.settings;
  return { user_id: accountId(), base_pay: num(s.basePay), holiday_pay: num(s.holidayPay, DEFAULTS.holidayPay), case_price: num(s.casePrice), piece_percent: num(s.percent), schedule_start: s.scheduleStart || todayKey() };
}

export async function ensureCloudDefaults() {
  if (!currentUser || !db) return false;
  const { error } = await db.from("settings").upsert(settingsPayload(), { onConflict: "user_id" });
  return !error;
}

export function accountId() { return currentUser?.id || localStorage.getItem("myPayDataOwner"); }

export async function cloudSaveSettings() {
  if (!accountId()) return false;
  queueCloudOp({ type: "saveSettings", settings: settingsPayload() });
  return flushCloudQueue();
}

export async function cloudSaveProfile(name) {
  if (!currentUser || !db) return false;
  const { data, error } = await db.from("profiles").upsert({ id: currentUser.id, name: name.trim() }, { onConflict: "id" }).select().single();
  if (!error) currentProfile = data;
  return !error;
}

export function shiftPayload(date, shift) {
  return { user_id: currentUser.id, work_date: date, cases: num(shift.cases), is_holiday: !!shift.holiday, base_pay: num(shift.base), piece_pay: num(shift.piece), total_pay: num(shift.total) };
}

export async function cloudSaveShift(date, shift) {
  if (!accountId() || !isDateKey(date) || !shift) return false;
  queueCloudOp({ type: "saveShift", date, shift });
  await flushCloudQueue();
  return true; // Accepted locally; failures remain durable in the queue.
}

export async function cloudDeleteShift(date) {
  if (!accountId() || !isDateKey(date)) return false;
  queueCloudOp({ type: "deleteShift", date });
  await flushCloudQueue();
  return true;
}

export async function cloudSaveExtra() {
  save();
  if (!accountId()) return false;
  queueCloudOp({ type: "saveExtra", extra: state.extra });
  return flushCloudQueue();
}

export function loadQueue() { try { const q = JSON.parse(localStorage.getItem("myPayCloudQueue") || "[]"); return Array.isArray(q) ? q.filter(x => x && typeof x === "object") : []; } catch { return []; } }

export function saveQueue(q) { localStorage.setItem("myPayCloudQueue", JSON.stringify(q)); }

export function queueCloudOp(op) {
  localRevision++;
  const isShift = type => type === "saveShift" || type === "deleteShift";
  const userId = currentUser?.id || localStorage.getItem("myPayDataOwner") || null;
  const q = loadQueue().filter(x => !(x.userId === userId && x.date === op.date && (x.type === op.type || (isShift(x.type) && isShift(op.type)))));
  q.push(structuredCloneSafe({ ...op, userId, id: uid("op"), queuedAt: Date.now() })); saveQueue(q);
  if (!navigator.onLine) showToast("Офлайн: сохраню в облако при подключении");
}

export let queueFlushInFlight = null;

export async function flushCloudQueue() {
  if (queueFlushInFlight) return queueFlushInFlight;
  if (!db || !navigator.onLine || !currentUser) return false;
  const userId = currentUser.id;
  // Migrate pre-audit queues once, binding them to their stored account owner.
  const owner = localStorage.getItem("myPayDataOwner");
  saveQueue(loadQueue().map(op => op.userId !== undefined ? op : {
    ...op, userId: owner || userId, id: uid("op"),
    ...(op.type === "saveExtra" ? { extra: structuredCloneSafe(state.extra) } : {})
  }));
  queueFlushInFlight = (async () => {
    while (currentUser?.id === userId && navigator.onLine) {
      const op = loadQueue().find(x => x.userId === userId);
      if (!op) return true;
      try {
        let result;
        if (op.type === "saveShift") {
          result = await db.from("shifts").upsert({ ...shiftPayload(op.date, op.shift), user_id: userId }, { onConflict: "user_id,work_date" });
        } else if (op.type === "deleteShift") {
          result = await db.from("shifts").delete().eq("user_id", userId).eq("work_date", op.date);
        } else if (op.type === "saveExtra") {
          result = await db.from(CLOUD_EXTRA_TABLE).upsert({ user_id: userId, payload: op.extra, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
        } else if (op.type === "saveSettings") {
          result = await db.from("settings").upsert({ ...op.settings, user_id: userId }, { onConflict: "user_id" });
        } else throw new Error("Неизвестная операция очереди");
        if (result.error) throw result.error;
        // A newer edit may have replaced this operation while its request ran.
        saveQueue(loadQueue().filter(x => x.id !== op.id));
      } catch (e) {
        console.warn("Cloud queue:", e);
        showCloudNotice("Есть несинхронизированные изменения. Они сохранены на устройстве и будут отправлены повторно.");
        return false;
      }
    }
    return false;
  })();
  try { return await queueFlushInFlight; } finally { queueFlushInFlight = null; }
}

// The CDN SDK may be unavailable on an offline launch. Retry after reconnecting
// so durable edits can be uploaded without requiring a manual page reload.
window.addEventListener("online", () => {
  if (db) return;
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2";
  script.onload = () => {
    if (db || !window.supabase?.createClient) return;
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
    });
    initCloudAuth();
  };
  document.head.appendChild(script);
});
