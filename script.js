/* ==========================================================================
   CASE.PLACE SALARY — script.js v16
   Учёт смен 2/2, упаковки чехлов и заработка. Работает офлайн (localStorage),
   синхронизируется с Supabase, когда есть аккаунт и сеть.
   ========================================================================== */
"use strict";

const APP_VERSION = 16;
// Должна совпадать с CACHE_NAME в sw.js, иначе приложение удалит собственный кеш.
const CACHE_VERSION = "my-pay-v16";

// Удаляем кеши прошлых версий, но не трогаем активный service worker.
(async () => {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith("my-pay-v") && k !== CACHE_VERSION).map(k => caches.delete(k)));
    }
  } catch (e) { console.warn("Cache cleanup:", e); }
})();

/* ---------- Supabase (необязателен: без SDK работаем локально) ---------- */
const SUPABASE_URL = "https://dyixwxxpjmyycgigcbtx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NFxxL8WDGpG-ASXo2LasmQ_wskniL6r";
const CLOUD_EXTRA_TABLE = "user_app_data";
let db = null;
try {
  if (window.supabase && typeof window.supabase.createClient === "function") {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  } else {
    console.warn("Supabase SDK не загрузился — работаем в локальном режиме.");
  }
} catch (e) { console.warn("Supabase init failed:", e); }

/* ---------- Модель оплаты и дефолты ---------- */
// 1 900 ₽ дневной тариф + 727,84 ₽ районный коэффициент = 2 627,84 ₽ за смену.
// Сделка по расчётному листку: 44 284,28 ₽ / 26 093 чехла ≈ 1,69 ₽ за чехол.
const DEFAULTS = { basePay: 2627.84, holidayPay: 4050, casePrice: 1.69, percent: 100, scheduleStart: todayKey(), goal: 60000 };
const EXTRA_DEFAULTS = {
  expenses: [], goals: [],
  templates: [{ id: "default", name: "Обычная", cases: 0, hours: 11, bonus: 0, holiday: false }],
  shiftMeta: {}, theme: "system", undo: null, celebratedGoals: []
};
const WORK_START_MIN = 8 * 60;   // 08:00
const WORK_END_MIN = 19 * 60;    // 19:00
const LEGACY = { basePay: 2150, casePrice: 7, percent: 20 }; // старая тройка настроек → мигрируем один раз

/* ---------- Утилиты ---------- */
function $(id) { return document.getElementById(id); }
function num(v, fallback = 0) { if (v === null || v === undefined || v === "") return fallback; const n = Number(typeof v === "string" ? v.replace(",", ".").trim() : v); return Number.isFinite(n) ? n : fallback; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function money(n) {
  const v = Math.round(num(n) * 100) / 100;
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v) + " ₽";
}
function moneyShort(n) { n = num(n); return n >= 1000 ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n / 1000) + "к" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n); }
function integer(n) { return new Intl.NumberFormat("ru-RU").format(num(n)); }
function pad2(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { d = new Date(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayKey() { return dateKey(new Date()); }
function fromKey(k) { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, m - 1, d); }
function isDateKey(k) { return /^\d{4}-\d{2}-\d{2}$/.test(String(k)) && !Number.isNaN(fromKey(k).getTime()); }
function monthPrefix(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-`; }
function dateText(d, opt) { return new Intl.DateTimeFormat("ru-RU", opt || { day: "numeric", month: "long" }).format(d); }
function plural(n, one, few, many) { n = Math.abs(n) % 100; const x = n % 10; return n > 10 && n < 20 ? many : x > 1 && x < 5 ? few : x === 1 ? one : many; }
function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function uid(prefix = "id") { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function icon(name) { return `<svg aria-hidden="true"><use href="#${name}"/></svg>`; }
function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }

/* ---------- Состояние и хранилище ---------- */
function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : structuredCloneSafe(fallback); }
  catch { return structuredCloneSafe(fallback); }
}
function structuredCloneSafe(v) { return JSON.parse(JSON.stringify(v)); }
function normalizeSettings(s) {
  s = s && typeof s === "object" ? s : {};
  const out = {
    basePay: Math.max(0, num(s.basePay, DEFAULTS.basePay)),
    holidayPay: Math.max(0, num(s.holidayPay, DEFAULTS.holidayPay)),
    casePrice: Math.max(0, num(s.casePrice, DEFAULTS.casePrice)),
    percent: clamp(num(s.percent, DEFAULTS.percent), 0, 100),
    scheduleStart: isDateKey(s.scheduleStart) ? s.scheduleStart : todayKey(),
    goal: Math.max(0, num(s.goal, DEFAULTS.goal))
  };
  if (out.basePay === LEGACY.basePay && out.casePrice === LEGACY.casePrice && out.percent === LEGACY.percent) {
    out.basePay = DEFAULTS.basePay; out.casePrice = DEFAULTS.casePrice; out.percent = DEFAULTS.percent;
  }
  return out;
}
function normalizeExtra(e) {
  e = e && typeof e === "object" ? e : {};
  const out = { ...structuredCloneSafe(EXTRA_DEFAULTS), ...e };
  out.expenses = Array.isArray(out.expenses) ? out.expenses : [];
  out.goals = Array.isArray(out.goals) ? out.goals : [];
  out.templates = Array.isArray(out.templates) && out.templates.length ? out.templates : structuredCloneSafe(EXTRA_DEFAULTS.templates);
  out.shiftMeta = out.shiftMeta && typeof out.shiftMeta === "object" ? out.shiftMeta : {};
  out.celebratedGoals = Array.isArray(out.celebratedGoals) ? out.celebratedGoals : [];
  out.theme = ["system", "light", "dark"].includes(out.theme) ? out.theme : "system";
  return out;
}
const state = {
  settings: normalizeSettings(load("myPaySettings", DEFAULTS)),
  shifts: load("myPayShifts", {}),
  extra: normalizeExtra(load("myPayExtra", EXTRA_DEFAULTS)),
  calendarDate: new Date(),
  selectedDate: todayKey(),
  modalDate: null
};
if (!state.shifts || typeof state.shifts !== "object" || Array.isArray(state.shifts)) state.shifts = {};
function save() {
  localStorage.setItem("myPaySettings", JSON.stringify(state.settings));
  localStorage.setItem("myPayShifts", JSON.stringify(state.shifts));
  localStorage.setItem("myPayExtra", JSON.stringify(state.extra));
}

let currentUser = null, currentProfile = null, authMode = "login";
let homeDirty = false;      // пользователь правит поле на главной — не перетирать его данными из облака
let extraDirty = false;     // локальные расходы/цели не ушли в облако — не перетирать их при следующей загрузке

/* ---------- Расчёт ---------- */
function piece(cases) { return Math.max(0, num(cases)) * num(state.settings.casePrice) * num(state.settings.percent) / 100; }
function base(holiday) { return holiday ? num(state.settings.holidayPay) : num(state.settings.basePay); }
function total(cases, holiday) { return base(holiday) + piece(cases); }
function makeShift(cases, holiday, bonus = 0) {
  cases = Math.max(0, Math.floor(num(cases))); holiday = !!holiday; bonus = Math.max(0, num(bonus));
  return { cases, holiday, base: base(holiday), piece: piece(cases), total: total(cases, holiday) + bonus };
}
function isWork(d) {
  const start = fromKey(state.settings.scheduleStart);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((t - start) / 86400000);
  return ((diff % 4) + 4) % 4 < 2;
}
function monthEntries(d = state.calendarDate) {
  const prefix = monthPrefix(d);
  return Object.entries(state.shifts).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ k, ...v }));
}
function monthSum(entries) { return entries.reduce((a, v) => a + num(v.total), 0); }
// Прогноз по графику: заработано + средняя смена × оставшиеся рабочие дни месяца (включая сегодняшний, если он ещё не внесён).
function monthForecast(d = new Date()) {
  const es = monthEntries(d);
  if (!es.length) return null;
  const sum = monthSum(es);
  const today = new Date();
  if (!sameMonth(d, today)) return Math.round(sum);
  const avg = sum / es.length;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  let remaining = 0;
  for (let n = today.getDate(); n <= days; n++) {
    const x = new Date(d.getFullYear(), d.getMonth(), n);
    if (isWork(x) && !state.shifts[dateKey(x)]) remaining++;
  }
  return Math.round(sum + avg * remaining);
}
function analyticsForMonth(d = state.calendarDate) {
  const es = monthEntries(d).sort((a, b) => a.k.localeCompare(b.k));
  const sum = monthSum(es);
  const goal = num(state.settings.goal);
  const best = es.reduce((a, v) => !a || num(v.total) > num(a.total) ? v : a, null);
  const remaining = Math.max(0, goal - sum);
  const avg = es.length ? sum / es.length : 0;
  const shiftsNeeded = remaining > 0 && avg > 0 ? Math.ceil(remaining / avg) : 0;
  let streak = 0, bestStreak = 0, prev = null;
  for (const v of es) {
    const x = fromKey(v.k);
    streak = prev && Math.round((x - prev) / 86400000) <= 3 ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak); prev = x;
  }
  return { es, sum, goal, best, remaining, avg, shiftsNeeded, bestStreak, cases: es.reduce((a, v) => a + num(v.cases), 0) };
}

/* ---------- Тост, диалоги ---------- */
function showToast(text, ms = 2400) {
  const t = $("toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => t.classList.remove("show"), ms);
}
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }
function anyModalOpen() { return !!document.querySelector(".modal:not(.hidden)"); }
// Свои диалоги вместо системных confirm()/prompt(): в PWA они выглядят чужеродно и не стилизуются.
function confirmAction({ title = "Подтверди действие", text = "", okText = "Удалить", cancelText = "Отмена", danger = true } = {}) {
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
function promptNumber({ title = "Сумма", text = "", label = "Сумма, ₽", value = "", okText = "Готово" } = {}) {
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

/* ---------- Авторизация ---------- */
function showAuth(show) { $("authModal").classList.toggle("hidden", !show); }
function setStatus(t) { $("authStatus").textContent = t || ""; }
function setAuthMode(mode) {
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
function backAuth() { $("authForm").classList.add("hidden"); $("authWelcome").classList.remove("hidden"); setStatus(""); }
function friendlyAuthError(error, signup) {
  const m = (error?.message || "").toLowerCase();
  if (error?.status === 0 || /fetch|network|failed to fetch/.test(m)) return "Нет соединения с сервером. Проверь интернет.";
  if (/email not confirmed/.test(m)) return "Подтверждение email включено. Отключи Confirm email в настройках Supabase.";
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
async function authAction() {
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
      const { data, error } = await db.auth.signUp({ email, password, options: { data: { name } } });
      if (error) throw new Error(friendlyAuthError(error, true));
      if (!data.user) throw new Error("Не удалось создать аккаунт.");
      if (!data.session) { setStatus("Аккаунт создан. Подтверди email по ссылке из письма, затем войди."); return; }
      currentUser = data.user;
      if (!await cloudSaveProfile(name)) throw new Error("Аккаунт создан, но не удалось сохранить профиль. Проверь SQL-схему и RLS.");
      if (!await ensureCloudDefaults()) throw new Error("Аккаунт создан, но не удалось сохранить настройки. Проверь SQL-схему и RLS.");
      await afterLogin(); showToast("Аккаунт создан. Добро пожаловать ✨");
    }
  } catch (e) { setStatus(e.message || "Что-то пошло не так."); }
  finally { btn.disabled = false; label.textContent = prev === "Секунду…" ? (authMode === "signup" ? "Создать аккаунт" : "Войти") : prev; }
}
async function initCloudAuth() {
  if (!db) { showAuth(false); showCloudNotice(); updateProfileUI(); return; }
  try {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) { currentUser = session.user; await afterLogin(); } else showAuth(true);
    db.auth.onAuthStateChange(async (_event, s) => {
      if (s?.user && !currentUser) { currentUser = s.user; await afterLogin(); }
      else if (!s && currentUser) { currentUser = null; currentProfile = null; hideCloudNotice(); showAuth(true); backAuth(); }
    });
  } catch (e) { console.error("initCloudAuth:", e); showAuth(false); showCloudNotice(); }
}
async function logout() {
  const ok = await confirmAction({ title: "Выйти из аккаунта?", text: "Данные останутся в облаке. На этом устройстве они будут очищены.", okText: "Выйти", danger: false });
  if (!ok) return;
  try { if (db) await db.auth.signOut(); } catch (e) { console.warn("signOut:", e); }
  currentUser = null; currentProfile = null; homeDirty = false;
  const keepTheme = state.extra.theme || "system";
  state.shifts = {}; state.settings = normalizeSettings({ ...DEFAULTS, scheduleStart: todayKey() }); state.extra = normalizeExtra({ theme: keepTheme });
  localStorage.removeItem("myPayCloudQueue");
  save(); renderAll(); showAuth(true); backAuth(); showToast("Ты вышел из аккаунта");
}
function showCloudNotice(text) {
  const n = $("cloudNotice"); if (!n) return;
  n.classList.remove("hidden");
  n.querySelector("span").textContent = text || "Облако недоступно — приложение работает в локальном режиме. Синхронизация включится, когда появится связь с Supabase.";
}
function hideCloudNotice() { $("cloudNotice")?.classList.add("hidden"); }

/* ---------- Облако: загрузка и сохранение ---------- */
let afterLoginInFlight = null;
async function afterLogin() {
  if (afterLoginInFlight) return afterLoginInFlight;
  afterLoginInFlight = (async () => {
    const synced = await cloudLoad();
    if (!synced) {
      if (!navigator.onLine || !db) {
        showAuth(false); showCloudNotice("Нет сети — работаем офлайн. Изменения синхронизируются автоматически, когда связь появится."); renderAll();
        showToast("Офлайн-режим: данные сохраняются на устройстве"); return true;
      }
      showAuth(true); setStatus("Не удалось синхронизировать данные. Проверь интернет и попробуй войти снова."); return false;
    }
    showAuth(false); hideCloudNotice(); renderAll(); flushCloudQueue(); startCloudRefresh(); loadTelegramStatus();
    return true;
  })();
  try { return await afterLoginInFlight; } finally { afterLoginInFlight = null; }
}
let cloudRefreshTimer = null, cloudListenersBound = false;
function startCloudRefresh() {
  if (cloudRefreshTimer) clearInterval(cloudRefreshTimer);
  cloudRefreshTimer = setInterval(() => {
    if (!currentUser || document.hidden || anyModalOpen() || homeDirty) return;
    cloudLoad();
  }, 30000);
  if (cloudListenersBound) return; // слушатели регистрируем один раз, иначе при повторном входе они дублируются
  cloudListenersBound = true;
  document.addEventListener("visibilitychange", () => { if (!document.hidden && currentUser && !anyModalOpen()) cloudLoad(); });
  window.addEventListener("online", () => { if (currentUser) { flushCloudQueue(); cloudLoad(); } });
}
async function cloudLoad() {
  if (!currentUser || !db) return false;
  try {
    const { data: sd, error: se } = await db.from("settings").select("*").eq("user_id", currentUser.id).maybeSingle();
    if (se) { console.error("cloudLoad settings:", se); return false; }
    const { data: rows, error: re } = await db.from("shifts").select("*").eq("user_id", currentUser.id).order("work_date", { ascending: true });
    if (re) { console.error("cloudLoad shifts:", re); return false; }
    if (sd) {
      // Легаси-миграция только по точной старой тройке 2150 / 7 / 20 — иначе затрём настройки пользователя.
      const legacy = num(sd.base_pay) === LEGACY.basePay && num(sd.case_price) === LEGACY.casePrice && num(sd.piece_percent) === LEGACY.percent;
      state.settings = normalizeSettings({
        basePay: legacy ? DEFAULTS.basePay : sd.base_pay, holidayPay: sd.holiday_pay,
        casePrice: legacy ? DEFAULTS.casePrice : sd.case_price, percent: legacy ? DEFAULTS.percent : sd.piece_percent,
        scheduleStart: sd.schedule_start || state.settings.scheduleStart, goal: sd.monthly_goal
      });
      if (legacy) await cloudSaveSettings();
    } else await ensureCloudDefaults();

    const { data: profile, error: pe } = await db.from("profiles").select("id,name").eq("id", currentUser.id).maybeSingle();
    if (pe) { console.error("cloudLoad profile:", pe); return false; }
    currentProfile = profile || null;

    // Облако — источник истины для аккаунта: пустой ответ очищает старые локальные смены,
    // чтобы один аккаунт никогда не видел смены другого на том же устройстве.
    const cloudShifts = {};
    for (const x of rows || []) {
      const key = String(x.work_date).slice(0, 10);
      const cases = num(x.cases), holiday = !!x.is_holiday;
      // total_pay в облаке включает премию из модалки; сохраняем его, чтобы не терять доплаты.
      const shift = makeShift(cases, holiday);
      const cloudTotal = num(x.total_pay);
      if (cloudTotal > 0) shift.total = cloudTotal;
      cloudShifts[key] = shift;
    }
    state.shifts = cloudShifts;
    await cloudLoadExtra();
    save(); syncHomeInputsFromCloud(); renderAll();
    return true;
  } catch (e) { console.error("cloudLoad:", e); return false; }
}
function settingsPayload() {
  const s = state.settings;
  return { user_id: currentUser.id, base_pay: num(s.basePay), holiday_pay: num(s.holidayPay, 4050), case_price: num(s.casePrice), piece_percent: num(s.percent), schedule_start: s.scheduleStart || todayKey(), monthly_goal: num(s.goal) };
}
async function ensureCloudDefaults() {
  if (!currentUser || !db) return false;
  const { error } = await db.from("settings").upsert(settingsPayload(), { onConflict: "user_id" });
  return !error;
}
async function cloudSaveSettings() {
  if (!currentUser || !db) return false;
  const { error } = await db.from("settings").upsert(settingsPayload(), { onConflict: "user_id" });
  if (error) { console.error("cloudSaveSettings:", error); return false; }
  return true;
}
async function cloudSaveProfile(name) {
  if (!currentUser || !db) return false;
  const { data, error } = await db.from("profiles").upsert({ id: currentUser.id, name: name.trim() }, { onConflict: "id" }).select().single();
  if (!error) currentProfile = data;
  return !error;
}
function shiftPayload(date, shift) {
  return { user_id: currentUser.id, work_date: date, cases: num(shift.cases), is_holiday: !!shift.holiday, base_pay: num(shift.base), piece_pay: num(shift.piece), total_pay: num(shift.total) };
}
function isNetworkError(error) { return !navigator.onLine || /fetch|network|load failed/i.test(error?.message || ""); }
async function cloudSaveShift(date, shift) {
  if (!currentUser || !db || !date || !shift) return false;
  const { error } = await db.from("shifts").upsert(shiftPayload(date, shift), { onConflict: "user_id,work_date" });
  if (error) {
    console.error("cloudSaveShift:", date, error);
    if (isNetworkError(error)) { queueCloudOp({ type: "saveShift", date, shift }); return true; }
    showToast("Не удалось сохранить смену в облако");
    return false;
  }
  removeQueuedOp("saveShift", date); return true;
}
async function cloudDeleteShift(date) {
  if (!currentUser || !db) return false;
  const { error } = await db.from("shifts").delete().eq("user_id", currentUser.id).eq("work_date", date);
  if (error) {
    if (isNetworkError(error)) { queueCloudOp({ type: "deleteShift", date }); return true; }
    showToast("Не удалось удалить смену из облака"); return false;
  }
  removeQueuedOp("deleteShift", date); return true;
}
async function cloudLoadExtra() {
  if (!currentUser || !db) return false;
  try {
    if (extraDirty) { // сначала доталкиваем локальные правки, иначе облако их перетрёт
      if (await cloudSaveExtra()) extraDirty = false; else return false;
    }
    const { data, error } = await db.from(CLOUD_EXTRA_TABLE).select("payload").eq("user_id", currentUser.id).maybeSingle();
    if (error) { console.info("Доп. облачные данные недоступны:", error.message); return false; }
    state.extra = normalizeExtra(data?.payload && typeof data.payload === "object" ? data.payload : { theme: state.extra.theme });
    applyTheme();
    return true;
  } catch { return false; }
}
async function cloudSaveExtra() {
  save();
  if (!currentUser || !db) return false;
  if (!navigator.onLine) { extraDirty = true; queueCloudOp({ type: "saveExtra" }); return false; }
  try {
    const { error } = await db.from(CLOUD_EXTRA_TABLE).upsert({ user_id: currentUser.id, payload: state.extra, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) { console.info("Доп. данные сохранены только локально:", error.message); extraDirty = true; return false; }
    extraDirty = false; removeQueuedOp("saveExtra"); return true;
  } catch { extraDirty = true; return false; }
}

/* ---------- Офлайн-очередь ---------- */
function loadQueue() { try { const q = JSON.parse(localStorage.getItem("myPayCloudQueue") || "[]"); return Array.isArray(q) ? q : []; } catch { return []; } }
function saveQueue(q) { localStorage.setItem("myPayCloudQueue", JSON.stringify(q)); }
function queueCloudOp(op) {
  const q = loadQueue().filter(x => !(x.type === op.type && x.date === op.date));
  q.push({ ...op, queuedAt: Date.now() }); saveQueue(q);
  showToast("Офлайн: сохраню в облако при подключении");
}
function removeQueuedOp(type, date) { saveQueue(loadQueue().filter(x => !(x.type === type && x.date === date))); }
async function flushCloudQueue() {
  if (!db || !navigator.onLine || !currentUser) return;
  const q = loadQueue(); if (!q.length) return;
  const left = [];
  for (const op of q) {
    try {
      if (op.type === "saveShift") {
        const { error } = await db.from("shifts").upsert(shiftPayload(op.date, op.shift), { onConflict: "user_id,work_date" }); if (error) throw error;
      } else if (op.type === "deleteShift") {
        const { error } = await db.from("shifts").delete().eq("user_id", currentUser.id).eq("work_date", op.date); if (error) throw error;
      } else if (op.type === "saveExtra") {
        const { error } = await db.from(CLOUD_EXTRA_TABLE).upsert({ user_id: currentUser.id, payload: state.extra, updated_at: new Date().toISOString() }, { onConflict: "user_id" }); if (error) throw error;
        extraDirty = false;
      }
    } catch { left.push(op); }
  }
  saveQueue(left);
  if (!left.length) showToast("Офлайн-изменения синхронизированы ✓");
}

/* ---------- Главный экран ---------- */
function renderAll() { updateProfileUI(); updateHome(); renderCalendar(); renderStats(); renderInsights(); renderFinance(); refreshUndoUI(); }
function homeInputs() {
  return { cases: Math.max(0, Math.floor(num($("casesInput").value))), holiday: $("holidayInput").checked };
}
function syncHomeInputsFromCloud() {
  if (homeDirty || document.activeElement === $("casesInput")) return;
  const today = state.shifts[todayKey()];
  $("casesInput").value = today ? String(today.cases || 0) : "";
  $("holidayInput").checked = !!today?.holiday;
}
function updateHome() {
  const { cases, holiday } = homeInputs();
  const p = piece(cases), b = base(holiday);
  $("shiftTotal").textContent = money(b + p);
  $("homeBase").textContent = money(b);
  $("homePiece").textContent = money(p);
  $("holidayChip").classList.toggle("hidden", !holiday);
  $("perCase").textContent = money(num(state.settings.casePrice) * num(state.settings.percent) / 100);
  $("perThousand").textContent = money(piece(1000));
  $("holidayRateLabel").textContent = money(state.settings.holidayPay);
  const now = new Date();
  $("todayLabel").textContent = dateText(now, { weekday: "long", day: "numeric", month: "long" });
  const badge = $("todayBadge"), work = isWork(now);
  badge.textContent = work ? "Работа" : "Выходной"; badge.classList.toggle("is-work", work);
  const saved = state.shifts[todayKey()];
  $("saveNote").textContent = homeDirty ? "Есть несохранённые изменения" : saved ? `Смена за сегодня сохранена: ${money(saved.total)}` : "";
  updateNextShiftCard();
  updateHomeDashboard();
}
function updateHomeDashboard() {
  const es = monthEntries(new Date()), sum = monthSum(es), cases = es.reduce((a, v) => a + num(v.cases), 0);
  const goal = num(state.settings.goal), pct = goal ? Math.min(100, Math.round(sum / goal * 100)) : 0;
  $("homeMonthTotal").textContent = money(sum);
  $("homeMonthShifts").textContent = integer(es.length);
  $("homeMonthCases").textContent = integer(cases);
  $("homeAvgShift").textContent = money(es.length ? sum / es.length : 0);
  $("homeGoalPercent").textContent = pct + "%";
  const bar = $("homeGoalBar"); bar.style.width = pct + "%"; bar.classList.toggle("is-done", pct >= 100);
}
function updateNextShiftCard() {
  const card = $("nextShiftCard"), kicker = $("nextShiftKicker"), progress = $("shiftProgress");
  const now = new Date(), minutes = now.getHours() * 60 + now.getMinutes();
  if (isWork(now) && minutes >= WORK_START_MIN && minutes < WORK_END_MIN) {
    const left = WORK_END_MIN - minutes, h = Math.floor(left / 60), m = left % 60;
    card.classList.add("current-shift"); kicker.textContent = "Смена идёт";
    $("nextShiftDate").textContent = `До конца ${h} ч ${pad2(m)} мин`;
    $("nextShiftMeta").textContent = "Рабочее время 08:00–19:00";
    progress.classList.remove("hidden");
    $("shiftProgressBar").style.width = Math.round((minutes - WORK_START_MIN) / (WORK_END_MIN - WORK_START_MIN) * 100) + "%";
    return;
  }
  card.classList.remove("current-shift"); progress.classList.add("hidden"); kicker.textContent = "Ближайшая смена";
  if (isWork(now) && minutes < WORK_START_MIN) { $("nextShiftDate").textContent = "Сегодня"; $("nextShiftMeta").textContent = "Начало в 08:00"; return; }
  const d = new Date(now); d.setDate(d.getDate() + 1);
  for (let i = 0; i < 366; i++) {
    if (isWork(d)) {
      const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
      $("nextShiftDate").textContent = diff === 1 ? "Завтра" : dateText(d, { weekday: "long", day: "numeric", month: "long" });
      $("nextShiftMeta").textContent = diff === 1 ? "Начало в 08:00" : `Через ${diff} ${plural(diff, "день", "дня", "дней")} · в 08:00`;
      return;
    }
    d.setDate(d.getDate() + 1);
  }
}
async function saveHomeShift() {
  // Главная всегда сохраняет сегодняшний день (а не дату, выбранную в календаре).
  const { cases, holiday } = homeInputs();
  const k = todayKey(), previous = state.shifts[k];
  const meta = state.extra.shiftMeta?.[k];
  const v = makeShift(cases, holiday, meta?.bonus || 0);
  state.shifts[k] = v; save();
  if (currentUser && !await cloudSaveShift(k, v)) {
    if (previous) state.shifts[k] = previous; else delete state.shifts[k];
    save(); return;
  }
  homeDirty = false; renderAll(); showToast("Смена сохранена ✓");
}

/* ---------- Календарь ---------- */
function renderCalendar() {
  const d = state.calendarDate;
  $("monthTitle").textContent = dateText(d, { month: "long", year: "numeric" }).replace(" г.", "");
  const first = new Date(d.getFullYear(), d.getMonth(), 1), offset = (first.getDay() + 6) % 7;
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), box = $("calendarDays");
  const today = todayKey(), frag = document.createDocumentFragment();
  for (let i = 0; i < offset; i++) { const e = document.createElement("div"); e.className = "day empty"; frag.appendChild(e); }
  for (let n = 1; n <= days; n++) {
    const x = new Date(d.getFullYear(), d.getMonth(), n), k = dateKey(x), s = state.shifts[k], b = document.createElement("button");
    b.type = "button"; b.className = "day"; b.setAttribute("role", "gridcell");
    if (isWork(x)) b.classList.add("work");
    if (s) { b.classList.add("saved"); if (s.holiday) b.classList.add("holiday"); }
    if (k === today) b.classList.add("today");
    if (k === state.selectedDate) { b.classList.add("selected"); b.setAttribute("aria-selected", "true"); }
    b.textContent = n;
    b.setAttribute("aria-label", `${dateText(x, { day: "numeric", month: "long" })}${s ? ", смена " + money(s.total) : isWork(x) ? ", рабочий день" : ", выходной"}`);
    if (s) { const i = document.createElement("i"); i.className = "tiny"; b.appendChild(i); }
    b.onclick = () => { if (state.selectedDate === k) openShiftModal(k); else selectCalendarDate(k); };
    frag.appendChild(b);
  }
  box.replaceChildren(frag);
  renderSelectedCard();
}
function renderSelectedCard() {
  const k = state.selectedDate, d = fromKey(k), s = state.shifts[k], meta = state.extra.shiftMeta?.[k];
  $("selectedDate").textContent = dateText(d, { weekday: "long", day: "numeric", month: "long" });
  const parts = [];
  if (s) { parts.push(s.holiday ? "Праздничная смена" : "Смена внесена"); parts.push(`${integer(s.cases)} ${plural(s.cases, "чехол", "чехла", "чехлов")}`); if (meta?.note) parts.push(meta.note); }
  else parts.push(isWork(d) ? "Рабочий день по графику" : "Выходной по графику");
  $("selectedStatus").textContent = parts.join(" · ");
  $("selectedMoney").textContent = s ? money(s.total) : "—";
  $("editSelectedBtn").querySelector("span").textContent = s ? "Изменить смену" : "Внести смену";
}
function selectCalendarDate(k) { state.selectedDate = k; renderCalendar(); }
function shiftMonth(delta) {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + delta, 1);
  renderCalendar(); renderStats(); renderInsights();
}
function goToCurrentMonth() { state.calendarDate = new Date(); state.selectedDate = todayKey(); renderCalendar(); renderStats(); renderInsights(); }

/* ---------- Модалка смены ---------- */
function openShiftModal(k) {
  state.modalDate = k;
  const s = state.shifts[k], m = state.extra.shiftMeta?.[k] || {};
  $("modalDate").textContent = dateText(fromKey(k), { weekday: "long", day: "numeric", month: "long" });
  $("modalCases").value = s ? String(s.cases ?? "") : "";
  $("modalHoliday").checked = !!s?.holiday;
  $("modalHours").value = m.hours ?? 11; $("modalBonus").value = m.bonus ?? 0; $("modalNote").value = m.note ?? "";
  $("modalHolidayRate").textContent = money(state.settings.holidayPay);
  $("modalDelete").classList.toggle("hidden", !s);
  renderModalTemplates(); updateModal(); openModal("shiftModal");
  setTimeout(() => $("modalCases").focus(), 80);
}
function modalInputs() {
  return {
    cases: Math.max(0, Math.floor(num($("modalCases").value))), holiday: $("modalHoliday").checked,
    bonus: Math.max(0, num($("modalBonus").value)), hours: Math.max(0, num($("modalHours").value)), note: $("modalNote").value.trim()
  };
}
function updateModal() {
  const { cases, holiday, bonus, hours } = modalInputs();
  const sum = total(cases, holiday) + bonus;
  $("modalTotal").textContent = money(sum);
  $("modalHourly").textContent = hours ? `≈ ${money(sum / hours)} в час` : "Укажи часы, чтобы увидеть доход в час";
}
async function saveModal() {
  const k = state.modalDate; if (!k) return;
  const { cases, holiday, bonus, hours, note } = modalInputs();
  const v = makeShift(cases, holiday, bonus), previous = state.shifts[k], previousMeta = state.extra.shiftMeta[k];
  state.shifts[k] = v; state.extra.shiftMeta[k] = { hours, bonus, note }; save();
  if (currentUser && !await cloudSaveShift(k, v)) {
    if (previous) state.shifts[k] = previous; else delete state.shifts[k];
    if (previousMeta) state.extra.shiftMeta[k] = previousMeta; else delete state.extra.shiftMeta[k];
    save(); return;
  }
  cloudSaveExtra();
  if (k === todayKey()) { homeDirty = false; syncHomeInputsFromCloud(); }
  state.selectedDate = k; renderAll(); closeModal("shiftModal"); showToast("Смена сохранена ✓");
}
async function deleteShift(k, { confirmFirst = true } = {}) {
  const s = state.shifts[k]; if (!s) return false;
  if (confirmFirst) {
    const ok = await confirmAction({ title: "Удалить смену?", text: `${dateText(fromKey(k), { day: "numeric", month: "long" })} · ${money(s.total)}. Удалённую смену можно вернуть в разделе «Ещё».` });
    if (!ok) return false;
  }
  const meta = state.extra.shiftMeta?.[k] || null;
  state.extra.undo = { date: k, shift: s, meta };
  delete state.shifts[k]; delete state.extra.shiftMeta[k]; save();
  if (currentUser && !await cloudDeleteShift(k)) { state.shifts[k] = s; if (meta) state.extra.shiftMeta[k] = meta; state.extra.undo = null; save(); return false; }
  cloudSaveExtra();
  if (k === todayKey()) { homeDirty = false; syncHomeInputsFromCloud(); }
  renderAll(); return true;
}
async function deleteModal() {
  const k = state.modalDate; if (!k) return;
  if (await deleteShift(k)) { closeModal("shiftModal"); showToast("Смена удалена · вернуть можно в «Ещё»"); }
}
async function undoLastDelete() {
  const u = state.extra.undo; if (!u?.shift) return;
  state.shifts[u.date] = u.shift; if (u.meta) state.extra.shiftMeta[u.date] = u.meta; state.extra.undo = null; save();
  if (currentUser && !await cloudSaveShift(u.date, u.shift)) { delete state.shifts[u.date]; delete state.extra.shiftMeta[u.date]; state.extra.undo = u; save(); return; }
  cloudSaveExtra();
  if (u.date === todayKey()) syncHomeInputsFromCloud();
  renderAll(); showToast("Смена восстановлена ✓");
}
function refreshUndoUI() {
  const u = state.extra.undo, b = $("undoDeleteBtn"); if (!b) return;
  b.classList.toggle("hidden", !u?.shift);
  if (u?.shift) $("undoDeleteMeta").textContent = `${dateText(fromKey(u.date), { day: "numeric", month: "long" })} · ${money(u.shift.total)}`;
}

/* ---------- Статистика ---------- */
function renderStats() {
  const a = analyticsForMonth(), es = a.es;
  const bs = es.reduce((x, v) => x + num(v.base), 0), ps = es.reduce((x, v) => x + num(v.piece), 0);
  const pct = a.goal ? Math.min(100, Math.round(a.sum / a.goal * 100)) : 0;
  $("statsMonth").textContent = dateText(state.calendarDate, { month: "long", year: "numeric" }).replace(" г.", "");
  $("statsMonth").onclick = goToCurrentMonth;
  $("monthTotal").textContent = money(a.sum);
  $("monthShiftsLabel").textContent = `${integer(es.length)} ${plural(es.length, "смена", "смены", "смен")}`;
  $("monthCasesLabel").textContent = `${integer(a.cases)} ${plural(a.cases, "чехол", "чехла", "чехлов")}`;
  $("avgShift").textContent = money(a.avg);
  $("monthPiece").textContent = money(ps); $("monthBase").textContent = money(bs);
  $("avgCases").textContent = integer(es.length ? Math.round(a.cases / es.length) : 0);
  $("goalPercent").textContent = pct + "%";
  const bar = $("goalBar"); bar.style.width = pct + "%"; bar.classList.toggle("is-done", pct >= 100);
  $("goalCurrent").textContent = money(a.sum);
  const forecast = sameMonth(state.calendarDate, new Date()) ? monthForecast() : null;
  $("goalText").textContent = `Цель ${money(a.goal)}` + (forecast ? ` · прогноз ${money(forecast)}` : "");
  const list = $("historyList");
  if (!es.length) { list.innerHTML = '<div class="empty">Пока нет сохранённых смен за этот месяц.</div>'; return; }
  list.innerHTML = [...es].sort((x, y) => y.k.localeCompare(x.k)).map(v => `
    <div class="history-item">
      <button type="button" class="history-left" data-open-shift="${v.k}" aria-label="Открыть смену">
        <b>${dateText(fromKey(v.k), { weekday: "short", day: "numeric", month: "long" })}</b>
        <small>${integer(v.cases)} ${plural(v.cases, "чехол", "чехла", "чехлов")} · сделка ${money(v.piece)}${v.holiday ? " · праздник" : ""}</small>
      </button>
      <div class="history-right"><b class="num">${money(v.total)}</b><small>${v.holiday ? "Праздничная" : "Обычная"}</small></div>
      <button type="button" class="history-delete" data-delete-shift="${v.k}" aria-label="Удалить смену">${icon("i-trash")}</button>
    </div>`).join("");
  list.querySelectorAll("[data-delete-shift]").forEach(b => b.onclick = async () => { if (await deleteShift(b.dataset.deleteShift)) showToast("Смена удалена · вернуть можно в «Ещё»"); });
  list.querySelectorAll("[data-open-shift]").forEach(b => b.onclick = () => { state.selectedDate = b.dataset.openShift; openShiftModal(b.dataset.openShift); });
}
function renderInsights() {
  const a = analyticsForMonth();
  if (!a.es.length) {
    $("smartGoalTitle").textContent = "Внеси первую смену";
    $("smartGoalMeta").textContent = a.goal ? `Цель ${money(a.goal)} — начнём считать темп` : "Установи цель в настройках";
    $("recordShift").textContent = money(0); $("shiftStreak").textContent = "0"; $("recordCases").textContent = "0"; $("bestDay").textContent = "—";
    $("bestShiftBadge").textContent = "Нет данных";
    $("earningsChart").innerHTML = '<div class="chart-empty">Здесь появится график после первой смены</div>';
    return;
  }
  const forecast = sameMonth(state.calendarDate, new Date()) ? monthForecast() : null;
  if (a.goal && a.remaining <= 0) { $("smartGoalTitle").textContent = "Цель выполнена 🎉"; $("smartGoalMeta").textContent = `${money(a.sum)} из ${money(a.goal)}`; }
  else if (a.goal && a.avg > 0) { $("smartGoalTitle").textContent = `Ещё ${money(a.remaining)}`; $("smartGoalMeta").textContent = `≈ ${a.shiftsNeeded} ${plural(a.shiftsNeeded, "смена", "смены", "смен")} до цели` + (forecast ? ` · прогноз ${money(forecast)}` : ""); }
  else { $("smartGoalTitle").textContent = a.goal ? `Цель ${money(a.goal)}` : "Цель не задана"; $("smartGoalMeta").textContent = `Заработано ${money(a.sum)}`; }
  $("recordShift").textContent = money(a.best?.total || 0);
  $("shiftStreak").textContent = String(a.bestStreak);
  $("recordCases").textContent = integer(a.cases);
  $("bestDay").textContent = a.best ? dateText(fromKey(a.best.k), { day: "numeric", month: "short" }) : "—";
  $("bestShiftBadge").textContent = a.best ? `Лучшая ${money(a.best.total)}` : "—";
  const last = a.es.slice(-12), vals = last.map(v => num(v.total)), max = Math.max(...vals, 1), min = Math.min(...vals);
  $("earningsChart").innerHTML = last.map(v => {
    // Масштаб от минимума к максимуму, чтобы разница между сменами была видна, а не тонула в одинаковых столбцах.
    const h = max > min ? Math.round(40 + (num(v.total) - min) / (max - min) * 70) : 90;
    return `<div class="bar-col"><div class="bar-value">${moneyShort(v.total)}</div><div class="bar${a.best && v.k === a.best.k ? " best" : ""}" style="height:${h}px" title="${dateText(fromKey(v.k), { day: "numeric", month: "long" })}: ${money(v.total)}"></div><small>${fromKey(v.k).getDate()}</small></div>`;
  }).join("");
}
async function clearMonth() {
  const keys = Object.keys(state.shifts).filter(k => k.startsWith(monthPrefix(state.calendarDate)));
  if (!keys.length) { showToast("В этом месяце нечего удалять"); return; }
  const ok = await confirmAction({ title: "Очистить месяц?", text: `Будут удалены все смены за ${dateText(state.calendarDate, { month: "long", year: "numeric" })} — ${keys.length} ${plural(keys.length, "запись", "записи", "записей")}. Это действие нельзя отменить.`, okText: "Удалить всё" });
  if (!ok) return;
  const results = await Promise.all(keys.map(async k => [k, currentUser ? await cloudDeleteShift(k) : true]));
  const failed = results.filter(([, done]) => !done);
  results.filter(([, done]) => done).forEach(([k]) => { delete state.shifts[k]; delete state.extra.shiftMeta[k]; });
  state.extra.undo = null; save(); cloudSaveExtra(); homeDirty = false; syncHomeInputsFromCloud(); renderAll(); flushCloudQueue();
  showToast(failed.length ? `Удалено не всё: ${failed.length} ${plural(failed.length, "смена", "смены", "смен")} не удалось удалить` : "Месяц очищен");
}

/* ---------- Настройки ---------- */
function openSettings() {
  const s = state.settings;
  $("settingBase").value = s.basePay; $("settingHoliday").value = s.holidayPay; $("settingPrice").value = s.casePrice;
  $("settingPercent").value = s.percent; $("settingStart").value = s.scheduleStart; $("settingGoal").value = s.goal;
  openModal("settingsModal");
}
async function saveSettings() {
  state.settings = normalizeSettings({
    basePay: $("settingBase").value, holidayPay: $("settingHoliday").value, casePrice: $("settingPrice").value,
    percent: $("settingPercent").value, scheduleStart: $("settingStart").value || state.settings.scheduleStart, goal: $("settingGoal").value
  });
  save();
  const ok = currentUser ? await cloudSaveSettings() : true;
  renderAll(); closeModal("settingsModal");
  showToast(ok ? "Настройки обновлены ✓" : "Настройки сохранены на устройстве, но не в облако");
}

/* ---------- Резервные копии, CSV ---------- */
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function buildBackup() { return { version: APP_VERSION, exportedAt: new Date().toISOString(), settings: state.settings, shifts: state.shifts, extra: state.extra }; }
function exportData() { downloadFile(`case-place-salary-${todayKey()}.json`, JSON.stringify(buildBackup(), null, 2), "application/json"); showToast("Резервная копия скачана ✓"); }
function parseBackup(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== "object" || !d.settings || !d.shifts || typeof d.shifts !== "object") throw new Error("invalid backup");
  const settings = normalizeSettings(d.settings);
  const shifts = {};
  for (const [date, raw] of Object.entries(d.shifts)) {
    if (!isDateKey(date) || !raw || typeof raw !== "object") continue;
    shifts[date] = { cases: Math.max(0, Math.floor(num(raw.cases))), holiday: !!raw.holiday, bonus: Math.max(0, num(raw.bonus)) };
  }
  return { settings, shifts, extra: d.extra && typeof d.extra === "object" ? normalizeExtra(d.extra) : null };
}
function importData(file) {
  const r = new FileReader();
  r.onload = async () => {
    try {
      const parsed = parseBackup(String(r.result));
      state.settings = parsed.settings;
      if (parsed.extra) state.extra = parsed.extra;
      state.shifts = {};
      for (const [date, s] of Object.entries(parsed.shifts)) {
        const bonus = num(state.extra.shiftMeta?.[date]?.bonus) || s.bonus || 0;
        state.shifts[date] = makeShift(s.cases, s.holiday, bonus); // пересчитываем по актуальным настройкам
      }
      save(); applyTheme(); homeDirty = false; syncHomeInputsFromCloud(); renderAll();
      if (!currentUser || !db) { showToast("Данные восстановлены ✓"); return; }
      if (!await cloudSaveSettings()) { showToast("Данные восстановлены на устройстве, но настройки не синхронизированы"); return; }
      await cloudSaveExtra();
      const entries = Object.entries(state.shifts);
      for (const [date, shift] of entries) if (!await cloudSaveShift(date, shift)) { showToast("Данные восстановлены, но часть смен не синхронизирована"); return; }
      const { data: verify, error } = await db.from("shifts").select("work_date").eq("user_id", currentUser.id);
      const cloudDates = new Set((verify || []).map(x => String(x.work_date).slice(0, 10)));
      const missing = entries.filter(([d]) => !cloudDates.has(d)); // проверяем только импортированные даты
      if (error || missing.length) { console.error("sync verify", error, missing); showToast(`Данные восстановлены, но ${missing.length} ${plural(missing.length, "смена", "смены", "смен")} не синхронизированы`); return; }
      showToast("Данные восстановлены и синхронизированы ✓");
    } catch (err) { console.error("importData:", err); showToast("Не удалось прочитать файл резервной копии"); }
  };
  r.readAsText(file);
}
function buildCsv() {
  const rows = [["Дата", "Чехлы", "Праздник", "Ставка", "Сделка", "Премия", "Итого", "Часы", "Доход/час", "Комментарий"]];
  Object.entries(state.shifts).sort(([a], [b]) => a.localeCompare(b)).forEach(([k, v]) => {
    const m = state.extra.shiftMeta?.[k] || {}, h = num(m.hours);
    rows.push([k, v.cases, v.holiday ? "Да" : "Нет", v.base, v.piece, num(m.bonus), v.total, h, h ? Math.round(num(v.total) / h * 100) / 100 : "", m.note || ""]);
  });
  return "\uFEFF" + rows.map(r => r.map(x => '"' + String(x ?? "").replace(/"/g, '""') + '"').join(";")).join("\n");
}
function exportCsv() { downloadFile(`case-place-salary-${todayKey()}.csv`, buildCsv(), "text/csv;charset=utf-8"); showToast("CSV скачан ✓"); }

/* ---------- Тема ---------- */
function applyTheme() {
  const t = state.extra.theme || "system";
  const dark = t === "dark" || (t === "system" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.body.classList.toggle("dark", dark);
  const status = $("themeStatus"); if (status) status.textContent = t === "system" ? "Как в системе" : t === "dark" ? "Тёмная" : "Светлая";
  const themeIcon = $("themeBtn")?.querySelector("use"); if (themeIcon) themeIcon.setAttribute("href", dark ? "#i-sun" : "#i-moon");
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", dark ? "#0f1114" : "#f4f4f2"));
}
function cycleTheme() {
  const order = ["system", "light", "dark"], i = order.indexOf(state.extra.theme || "system");
  state.extra.theme = order[(i + 1) % order.length];
  save(); applyTheme(); cloudSaveExtra(); showToast(`Тема: ${$("themeStatus").textContent}`);
}

/* ---------- Финансы: расходы, цели, шаблоны ---------- */
function currentMonthExpenses(d = new Date()) { const p = monthPrefix(d); return (state.extra.expenses || []).filter(x => String(x.date || "").startsWith(p)); }
function financeNumbers() {
  const d = new Date(), es = monthEntries(d), income = monthSum(es);
  const expenses = currentMonthExpenses(d).reduce((a, v) => a + num(v.amount), 0);
  const free = income - expenses, forecast = monthForecast(d) ?? income, goal = num(state.settings.goal);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), remainingDays = Math.max(1, days - d.getDate() + 1);
  const daily = Math.max(0, free) / remainingDays, rate = income > 0 ? Math.round(clamp(free / income, 0, 1) * 100) : 0;
  return { income, expenses, free, forecast, goal, remainingDays, daily, rate };
}
function renderFinance() {
  if (!$("financeIncome")) return;
  const n = financeNumbers();
  $("financeIncome").textContent = money(n.income); $("financeExpenses").textContent = money(n.expenses);
  $("freeBalance").textContent = money(n.free); $("financeForecast").textContent = money(n.forecast);
  $("financeGoalLeft").textContent = money(Math.max(0, n.goal - n.income));
  $("dailyBudget").textContent = n.income <= 0 && n.expenses <= 0 ? "Внеси смены и расходы — посчитаем, сколько остаётся" : n.free > 0 ? `≈ ${money(n.daily)} в день до конца месяца` : "Расходы уже выше дохода за месяц";
  $("savingsRate").textContent = n.rate + "%"; $("savingsRing").style.setProperty("--p", n.rate);
  renderGoals(); renderExpenses(); renderTemplates(); checkGoalCelebration();
}
function renderGoals() {
  const box = $("goalsList"); if (!box) return;
  const goals = state.extra.goals || [];
  if (!goals.length) { box.innerHTML = '<div class="empty">Целей пока нет. Добавь первую — приложение посчитает прогресс и остаток.</div>'; return; }
  box.innerHTML = goals.map(g => {
    const amount = Math.max(1, num(g.amount, 1)), saved = Math.max(0, num(g.saved)), pct = Math.min(100, Math.round(saved / amount * 100));
    return `<div class="goal-item" data-goal="${escapeHtml(g.id)}">
      <div class="goal-top"><b>${escapeHtml(g.name)}</b><span class="num">${money(saved)} / ${money(amount)}</span></div>
      <div class="track"><i class="${pct >= 100 ? "is-done" : ""}" style="width:${pct}%"></i></div>
      <div class="goal-meta"><span>${pct}%</span><span>${pct >= 100 ? "Цель достигнута" : "осталось " + money(Math.max(0, amount - saved))}</span></div>
      <div class="goal-actions"><button type="button" class="btn btn-soft btn-sm" data-goal-add="${escapeHtml(g.id)}">${icon("i-plus")}Пополнить</button><button type="button" class="btn btn-soft btn-sm danger" data-goal-del="${escapeHtml(g.id)}">${icon("i-trash")}Удалить</button></div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-goal-add]").forEach(b => b.onclick = () => topUpGoal(b.dataset.goalAdd));
  box.querySelectorAll("[data-goal-del]").forEach(b => b.onclick = () => deleteGoal(b.dataset.goalDel));
}
function openGoalModal() { $("goalName").value = ""; $("goalAmount").value = ""; $("goalSaved").value = "0"; openModal("goalModal"); setTimeout(() => $("goalName").focus(), 80); }
async function saveGoal() {
  const name = $("goalName").value.trim(), amount = Math.max(0, num($("goalAmount").value)), saved = Math.max(0, num($("goalSaved").value));
  if (!name || !amount) { showToast("Укажи название и сумму цели"); return; }
  state.extra.goals.push({ id: uid("goal"), name, amount, saved }); save(); cloudSaveExtra();
  closeModal("goalModal"); renderFinance(); showToast("Цель добавлена 🎯");
}
async function topUpGoal(id) {
  const g = state.extra.goals.find(x => x.id === id); if (!g) return;
  const v = await promptNumber({ title: "Пополнить цель", text: `«${g.name}»: отложено ${money(g.saved)} из ${money(g.amount)}.`, label: "Сколько добавить, ₽", value: 1000, okText: "Пополнить" });
  if (v === null || v <= 0) return;
  g.saved = Math.max(0, num(g.saved)) + v; save(); cloudSaveExtra(); renderFinance();
}
async function deleteGoal(id) {
  const g = state.extra.goals.find(x => x.id === id); if (!g) return;
  if (!await confirmAction({ title: "Удалить цель?", text: `«${g.name}» будет удалена без возможности восстановления.` })) return;
  state.extra.goals = state.extra.goals.filter(x => x.id !== id); save(); cloudSaveExtra(); renderFinance();
}
function checkGoalCelebration() {
  for (const g of state.extra.goals || []) {
    if (num(g.saved) >= num(g.amount) && num(g.amount) > 0 && !state.extra.celebratedGoals.includes(g.id)) {
      state.extra.celebratedGoals.push(g.id); save(); cloudSaveExtra(); confetti(); showToast(`Цель «${g.name}» выполнена! 🎉`); break;
    }
  }
}
function confetti() {
  const box = $("confettiLayer"); if (!box) return;
  const colors = ["#ff5a1f", "#16181d", "#1f9d55", "#ffb38a", "#ffd166"];
  for (let i = 0; i < 70; i++) {
    const el = document.createElement("i"); el.className = "confetti-piece";
    el.style.left = Math.random() * 100 + "vw"; el.style.color = colors[i % colors.length];
    el.style.setProperty("--x", (Math.random() * 180 - 90) + "px"); el.style.animationDelay = Math.random() * .5 + "s";
    box.appendChild(el); setTimeout(() => el.remove(), 2600);
  }
}
function openExpenseModal() { $("expenseAmount").value = ""; $("expenseDate").value = todayKey(); $("expenseNote").value = ""; openModal("expenseModal"); setTimeout(() => $("expenseAmount").focus(), 80); }
async function saveExpense() {
  const amount = Math.max(0, num($("expenseAmount").value)), category = $("expenseCategory").value, date = isDateKey($("expenseDate").value) ? $("expenseDate").value : todayKey(), note = $("expenseNote").value.trim();
  if (!amount) { showToast("Укажи сумму расхода"); return; }
  state.extra.expenses.push({ id: uid("exp"), amount, category, date, note }); save(); cloudSaveExtra();
  closeModal("expenseModal"); renderFinance(); showToast("Расход добавлен");
}
async function deleteExpense(id) {
  state.extra.expenses = state.extra.expenses.filter(x => x.id !== id); save(); cloudSaveExtra(); renderFinance(); showToast("Расход удалён");
}
function renderExpenses() {
  const list = $("expenseList"), bars = $("expenseBars"); if (!list || !bars) return;
  const es = currentMonthExpenses(new Date()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!es.length) { bars.innerHTML = ""; list.innerHTML = '<div class="empty">Расходов за этот месяц пока нет.</div>'; return; }
  const cats = {}; es.forEach(x => cats[x.category] = (cats[x.category] || 0) + num(x.amount));
  const max = Math.max(...Object.values(cats), 1);
  bars.innerHTML = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="expense-bar-row"><div class="expense-bar-head"><span>${escapeHtml(c)}</span><b class="num">${money(v)}</b></div><div class="track"><i style="width:${Math.round(v / max * 100)}%"></i></div></div>`).join("");
  list.innerHTML = es.slice(0, 15).map(x => `<div class="expense-row"><div><b>${escapeHtml(x.category)}</b><small>${dateText(fromKey(x.date), { day: "numeric", month: "short" })}${x.note ? " · " + escapeHtml(x.note) : ""}</small></div><strong class="num">−${money(x.amount)}</strong><button type="button" class="expense-delete" data-exp-del="${escapeHtml(x.id)}" aria-label="Удалить расход">${icon("i-x")}</button></div>`).join("");
  list.querySelectorAll("[data-exp-del]").forEach(b => b.onclick = () => deleteExpense(b.dataset.expDel));
}
function openTemplateModal() { $("templateName").value = ""; $("templateCases").value = ""; $("templateHours").value = "11"; $("templateBonus").value = "0"; $("templateHoliday").checked = false; openModal("templateModal"); setTimeout(() => $("templateName").focus(), 80); }
async function saveTemplate() {
  const name = $("templateName").value.trim(), cases = Math.max(0, Math.floor(num($("templateCases").value))), hours = Math.max(0, num($("templateHours").value)), bonus = Math.max(0, num($("templateBonus").value)), holiday = $("templateHoliday").checked;
  if (!name) { showToast("Укажи название шаблона"); return; }
  state.extra.templates.push({ id: uid("tpl"), name, cases, hours, bonus, holiday }); save(); cloudSaveExtra();
  closeModal("templateModal"); renderFinance(); showToast("Шаблон сохранён");
}
async function deleteTemplate(id) {
  const t = state.extra.templates.find(x => x.id === id); if (!t) return;
  if (!await confirmAction({ title: "Удалить шаблон?", text: `«${t.name}» исчезнет из быстрого ввода.` })) return;
  state.extra.templates = state.extra.templates.filter(x => x.id !== id); save(); cloudSaveExtra(); renderFinance();
}
function renderTemplates() {
  const box = $("templatesList"); if (!box) return;
  box.innerHTML = (state.extra.templates || []).map(x => `<button type="button" class="template-chip" data-tpl-use="${escapeHtml(x.id)}" title="Открыть сегодняшнюю смену с этим шаблоном. Долгое нажатие — удалить">${escapeHtml(x.name)}<small>${integer(x.cases)} шт · ${x.hours || 0} ч${x.bonus ? " · +" + money(x.bonus) : ""}${x.holiday ? " · праздник" : ""}</small></button>`).join("");
  box.querySelectorAll("[data-tpl-use]").forEach(b => {
    b.onclick = () => useTemplateToday(b.dataset.tplUse);
    b.oncontextmenu = e => { e.preventDefault(); deleteTemplate(b.dataset.tplUse); };
  });
}
function renderModalTemplates() {
  const box = $("modalTemplatePills"); if (!box) return;
  box.innerHTML = (state.extra.templates || []).map(x => `<button type="button" class="template-chip" data-modal-tpl="${escapeHtml(x.id)}">${escapeHtml(x.name)}<small>${integer(x.cases)} шт</small></button>`).join("");
  box.querySelectorAll("[data-modal-tpl]").forEach(b => b.onclick = () => applyTemplateToModal(b.dataset.modalTpl));
}
function applyTemplateToModal(id) {
  const t = state.extra.templates.find(x => x.id === id); if (!t) return;
  $("modalCases").value = t.cases || 0; $("modalHours").value = t.hours || 11; $("modalBonus").value = t.bonus || 0; $("modalHoliday").checked = !!t.holiday; updateModal();
}
function useTemplateToday(id) { const k = todayKey(); state.selectedDate = k; openShiftModal(k); applyTemplateToModal(id); }

/* ---------- Профиль, Telegram, уведомления ---------- */
function updateProfileUI() {
  const n = currentProfile?.name?.trim() || currentUser?.user_metadata?.name || (currentUser ? currentUser.email : "") || "Мой расчёт";
  $("profileName").textContent = n; $("profileAvatar").textContent = (n[0] || "₽").toUpperCase();
  $("profileMeta").textContent = currentUser ? `${currentUser.email || ""} · синхронизация включена` : db ? "Войди в аккаунт, чтобы синхронизировать данные" : "Локальный режим: данные хранятся на этом устройстве";
  $("logoutBtn").classList.toggle("hidden", !currentUser);
}
async function loadTelegramStatus() {
  if (!db || !currentUser) return null;
  try {
    const { data, error } = await db.from("telegram_links").select("username,first_name,linked_at").eq("user_id", currentUser.id).maybeSingle();
    if (error || !data) { $("telegramMenuStatus").textContent = "Ввод чехлов прямо из чата"; return null; }
    const who = data.username ? "@" + data.username : (data.first_name || "аккаунт");
    $("telegramMenuStatus").textContent = `Привязан: ${who}`;
    return data;
  } catch { return null; }
}
async function openTelegramModal() {
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
async function generateTelegramCode() {
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
function refreshNotificationUI() {
  const supported = "Notification" in window, granted = supported && Notification.permission === "granted", denied = supported && Notification.permission === "denied";
  $("notificationMenuStatus").textContent = !supported ? "Не поддерживается в этом браузере" : granted ? "Включены ✓" : denied ? "Запрещены в настройках браузера" : "Напоминания о сменах";
  const tipBtn = $("enableNotificationsBtn");
  if (granted) { $("notificationTipText").textContent = "Уведомления включены. Напоминание о ближайшей смене приходит, пока приложение открыто или установлено на экран «Домой»."; tipBtn.textContent = "Уведомления включены ✓"; tipBtn.disabled = true; }
  else if (denied) { $("notificationTipText").textContent = "Уведомления запрещены. Разрешить их можно в настройках сайта в браузере."; tipBtn.disabled = true; }
}
async function enableNotifications() {
  if (!("Notification" in window)) { showToast("Этот браузер не поддерживает уведомления"); return; }
  if (!window.isSecureContext) { showToast("Для уведомлений нужен HTTPS"); return; }
  const permission = await Notification.requestPermission();
  if (permission === "granted") { scheduleShiftReminder(); showToast("Уведомления включены ✓"); }
  else showToast("Уведомления не разрешены");
  refreshNotificationUI();
}
function scheduleShiftReminder() {
  // Локальное напоминание: работает, пока приложение может выполнять JS. Фоновый Web Push требует серверной части.
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(7, 30, 0, 0);
    if (!isWork(d)) continue;
    const key = "myPayReminder_" + dateKey(d);
    if (!localStorage.getItem(key) && d - now > 0) {
      setTimeout(() => {
        if (Notification.permission === "granted") { try { new Notification("CASE.PLACE SALARY", { body: `Сегодня рабочая смена — ${dateText(d, { day: "numeric", month: "long" })}. Начало в 08:00.`, icon: "./icon-192.png" }); } catch { /* ignore */ } }
        localStorage.setItem(key, "1");
      }, Math.min(d - now, 2147483647));
    }
    break;
  }
}

/* ---------- Навигация и события ---------- */
function showScreen(id) {
  document.querySelectorAll(".nav-item").forEach(x => { const active = x.dataset.screen === id; x.classList.toggle("active", active); if (active) x.setAttribute("aria-current", "page"); else x.removeAttribute("aria-current"); });
  document.querySelectorAll(".screen").forEach(x => x.classList.toggle("active", x.id === id));
  if (id === "calendarScreen") renderCalendar();
  if (id === "statsScreen") { renderStats(); renderInsights(); }
  if (id === "financeScreen") renderFinance();
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}
function markHomeDirty() { homeDirty = true; updateHome(); }
function bumpCases(delta) { $("casesInput").value = String(Math.max(0, homeInputs().cases + delta)); markHomeDirty(); }
function bindEvents() {
  document.querySelectorAll(".nav-item").forEach(b => b.onclick = () => showScreen(b.dataset.screen));
  document.querySelectorAll(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m && m.id !== "confirmModal" && m.id !== "promptModal") closeModal(m.id); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".modal:not(.hidden)").forEach(m => { if (m.id === "confirmModal") $("confirmCancel").click(); else if (m.id === "promptModal") $("promptCancel").click(); else closeModal(m.id); }); });
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => closeModal(b.dataset.close));

  $("casesInput").addEventListener("input", markHomeDirty);
  $("holidayInput").addEventListener("change", markHomeDirty);
  document.querySelectorAll(".step-btn").forEach(b => b.addEventListener("click", () => bumpCases(num(b.dataset.step))));
  document.querySelectorAll(".quick-row button").forEach(b => b.addEventListener("click", () => bumpCases(num(b.dataset.add))));
  $("saveShiftBtn").onclick = saveHomeShift;
  $("settingsBtn").onclick = openSettings; $("openSettingsFromMore").onclick = openSettings; $("settingsSave").onclick = saveSettings;

  $("prevMonth").onclick = () => shiftMonth(-1); $("nextMonth").onclick = () => shiftMonth(1); $("monthTitle").onclick = goToCurrentMonth;
  $("statsPrev").onclick = () => shiftMonth(-1); $("statsNext").onclick = () => shiftMonth(1);
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

  $("goLogin").onclick = () => setAuthMode("login"); $("goSignup").onclick = () => setAuthMode("signup"); $("backAuth").onclick = backAuth; $("authAction").onclick = authAction;
  ["authEmail", "authPassword", "authPassword2", "authName"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") authAction(); }));

  $("addExpenseBtn").onclick = openExpenseModal; $("addExpenseTop").onclick = openExpenseModal; $("expenseSave").onclick = saveExpense;
  $("addGoalBtn").onclick = openGoalModal; $("goalSave").onclick = saveGoal;
  $("addTemplateBtn").onclick = openTemplateModal; $("templateSave").onclick = saveTemplate;

  $("telegramBotBtn").onclick = openTelegramModal; $("telegramGenerateBtn").onclick = generateTelegramCode;
  $("telegramHelpBtn").onclick = () => window.open("https://github.com/Andrey1904-dev/my-pay/blob/main/telegram_bot_setup.md", "_blank", "noopener");
  $("enableNotificationsBtn").onclick = enableNotifications; $("enableNotificationsMenu").onclick = enableNotifications;

  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if ((state.extra.theme || "system") === "system") applyTheme(); });
  setInterval(() => { updateNextShiftCard(); if (!homeDirty) updateHome(); }, 60000);
}

/* ---------- Старт ---------- */
function init() {
  $("appVersion").textContent = "v" + APP_VERSION;
  applyTheme(); bindEvents();
  syncHomeInputsFromCloud(); renderAll(); refreshNotificationUI();
  if ("Notification" in window && Notification.permission === "granted") scheduleShiftReminder();
  initCloudAuth();
}
init();

// Публичный API для тестов и отладки в консоли.
window.MyPay = {
  version: APP_VERSION, state, DEFAULTS,
  money, moneyShort, integer, plural, dateKey, fromKey, isDateKey, escapeHtml,
  piece, base, total, makeShift, isWork, monthEntries, monthForecast, analyticsForMonth, financeNumbers,
  normalizeSettings, normalizeExtra, parseBackup, buildBackup, buildCsv,
  save, renderAll, updateHome, renderCalendar, renderStats, renderInsights, renderFinance,
  saveHomeShift, openShiftModal, saveModal, deleteShift, undoLastDelete, clearMonth, selectCalendarDate, shiftMonth, goToCurrentMonth,
  openSettings, saveSettings, cycleTheme, applyTheme, showScreen, showToast, confirmAction, promptNumber,
  saveExpense, deleteExpense, saveGoal, topUpGoal, deleteGoal, saveTemplate, applyTemplateToModal,
  loadQueue, queueCloudOp, flushCloudQueue, setAuthMode, backAuth,
  get currentUser() { return currentUser; }, get homeDirty() { return homeDirty; }, get cloudAvailable() { return !!db; }
};
