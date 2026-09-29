/* ==========================================================================
   CASE.PLACE SALARY — script.js V1.01
   Учёт смен 2/2, упаковки чехлов и заработка. Работает офлайн (localStorage),
   синхронизируется с Supabase, когда есть аккаунт и сеть.
   ========================================================================== */
"use strict";

// Версия сайта: показывается в шапке и подвале. При выпуске менять здесь, в sw.js (CACHE_NAME и ?v=) и в index.html (?v=).
const APP_VERSION = "1.01";
// Должна совпадать с CACHE_NAME в sw.js, иначе приложение удалит собственный кеш.
const CACHE_VERSION = "my-pay-v" + APP_VERSION;

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
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
    });
  } else {
    console.warn("Supabase SDK не загрузился — работаем в локальном режиме.");
  }
} catch (e) { console.warn("Supabase init failed:", e); }

/* ---------- Модель оплаты и дефолты ---------- */
// Выход 1 900 ₽ + обед 200 ₽ = 2 100 ₽; сделка: 7 ₽ за чехол × 25% = 1,75 ₽.
// Районный коэффициент 1,15 — только на выход и обед: 2 100 × 1,15 = 2 415 ₽. На сделку не начисляется.
// Праздник: (1 900 × 2 + 200) × 1,15 = 4 600 ₽; сделка не удваивается.
const DEFAULTS = { basePay: 2415, holidayPay: 4600, casePrice: 7, percent: 25, scheduleStart: todayKey(), goal: 60000 };
const DEFAULT_CATEGORIES = [
  { id: "food", name: "Еда", emoji: "🍔", limit: 0 }, { id: "transport", name: "Транспорт", emoji: "🚌", limit: 0 }, { id: "home", name: "Жильё", emoji: "🏠", limit: 0 },
  { id: "shopping", name: "Покупки", emoji: "🛍️", limit: 0 }, { id: "health", name: "Здоровье", emoji: "💊", limit: 0 }, { id: "fun", name: "Развлечения", emoji: "🎮", limit: 0 },
  { id: "connect", name: "Связь", emoji: "📱", limit: 0 }, { id: "family", name: "Семья", emoji: "👨‍👩‍👧", limit: 0 }, { id: "other", name: "Другое", emoji: "📦", limit: 0 }
];
const EXTRA_DEFAULTS = {
  transactions: [], accounts: [], categories: DEFAULT_CATEGORIES, recurring: [], debts: [], goals: [],
  payday: { advanceDay: 23, salaryDay: 8 },
  templates: [{ id: "default", name: "Обычная", cases: 0, hours: 11, bonus: 0, holiday: false }],
  shiftMeta: {}, theme: "system", undo: null, celebratedGoals: []
};
const WORK_START_MIN = 8 * 60;   // 08:00
const WORK_END_MIN = 19 * 60;    // 19:00
// Точные старые стандартные тарифы → актуальная формула, без изменения своих ставок.
const LEGACY_SETS = [{ basePay: 2415, casePrice: 8.05, percent: 25 }, { basePay: 2150, casePrice: 7, percent: 20 }, { basePay: 2627.84, casePrice: 1.69, percent: 100 }];
function isLegacySet(b, c, p) { return LEGACY_SETS.some(l => num(b) === l.basePay && num(c) === l.casePrice && num(p) === l.percent); }

/* ---------- Утилиты ---------- */
function $(id) { return document.getElementById(id); }
function num(v, fallback = 0) { if (v === null || v === undefined || v === "") return fallback; const n = Number(typeof v === "string" ? v.replace(",", ".").trim() : v); return Number.isFinite(n) ? n : fallback; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function money(n) {
  const v = Math.round(num(n) * 100) / 100;
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v) + "\u00a0₽"; // неразрывный пробел — знак ₽ не уезжает на новую строку
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
  if (isLegacySet(out.basePay, out.casePrice, out.percent)) {
    if (out.holidayPay === 4050) out.holidayPay = DEFAULTS.holidayPay;
    out.basePay = DEFAULTS.basePay; out.casePrice = DEFAULTS.casePrice; out.percent = DEFAULTS.percent;
  }
  return out;
}
function normalizeExtra(e) {
  e = e && typeof e === "object" ? e : {};
  const out = { ...structuredCloneSafe(EXTRA_DEFAULTS), ...e };
  // v17: расходы стали операциями (расход / доход / перевод). Старый список expenses переносим один раз.
  out.transactions = Array.isArray(out.transactions) ? out.transactions.filter(t => t && typeof t === "object") : [];
  if (Array.isArray(e.expenses) && e.expenses.length) {
    const known = new Set(out.transactions.map(t => t.id));
    e.expenses.forEach(x => { if (x && x.id && !known.has(x.id)) out.transactions.push({ id: x.id, type: "expense", amount: num(x.amount), category: x.category || "Другое", accountId: null, toAccountId: null, date: isDateKey(x.date) ? x.date : todayKey(), note: x.note || "" }); });
  }
  delete out.expenses;
  out.transactions.forEach(t => { if (!["expense", "income", "transfer"].includes(t.type)) t.type = "expense"; t.amount = Math.max(0, num(t.amount)); if (!isDateKey(t.date)) t.date = todayKey(); });
  out.accounts = Array.isArray(out.accounts) ? out.accounts.filter(a => a && a.id) : [];
  out.categories = Array.isArray(out.categories) && out.categories.length ? out.categories.filter(c => c && c.name) : structuredCloneSafe(DEFAULT_CATEGORIES);
  out.transactions.forEach(t => { if (t.type === "expense" && t.category && !out.categories.find(c => c.name === t.category)) out.categories.push({ id: uid("cat"), name: t.category, emoji: "🏷️", limit: 0 }); });
  out.recurring = Array.isArray(out.recurring) ? out.recurring.filter(r => r && r.id) : [];
  out.debts = Array.isArray(out.debts) ? out.debts.filter(d => d && d.id) : [];
  out.payday = out.payday && typeof out.payday === "object" ? { advanceDay: clamp(Math.round(num(out.payday.advanceDay, 0)), 0, 31), salaryDay: clamp(Math.round(num(out.payday.salaryDay, 0)), 0, 31) } : structuredCloneSafe(EXTRA_DEFAULTS.payday);
  if (out.payday.advanceDay === 25 && out.payday.salaryDay === 10) out.payday = { advanceDay: 23, salaryDay: 8 }; // старые дефолты → реальные даты выплат
  out.goals = Array.isArray(out.goals) ? out.goals.filter(g => g && g.id).map(g => ({ ...g, deposits: Array.isArray(g.deposits) ? g.deposits : [] })) : [];
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
// Исправляем только смены со старой стандартной формулой, сохраняя премию из исходных компонентов.
// Пользовательские ставки не трогаем; повторная обработка уже исправленной смены ничего не меняет.
function correctLegacyShift(s) {
  if (!s || typeof s !== "object") return s;
  const cases = num(s.cases), oldBase = s.holiday ? 4050 : 2415;
  if (cases < 0 || num(s.base) !== oldBase || Math.abs(num(s.piece) - cases * 2.0125) > .0051) return s;
  const bonus = num(s.total) - num(s.base) - num(s.piece);
  if (bonus < -.011) return s;
  const b = s.holiday ? 4600 : 2415, p = cases * 1.75;
  return { ...s, base: b, piece: p, total: b + p + Math.max(0, Math.round(bonus * 100) / 100) };
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
    cleanOAuthUrl();
    if (session?.user) { currentUser = session.user; await afterLogin(); } else showAuth(true);
    db.auth.onAuthStateChange(async (_event, s) => {
      if (s?.user && !currentUser) { currentUser = s.user; await afterLogin(); }
      else if (!s && currentUser) { currentUser = null; currentProfile = null; hideCloudNotice(); showAuth(true); backAuth(); }
    });
  } catch (e) { console.error("initCloudAuth:", e); showAuth(false); showCloudNotice(); }
}
async function oauthSignIn(provider) {
  if (!db) { showToast("Облако недоступно — вход без интернета невозможен"); return; }
  const btn = $(provider === "apple" ? "oauthApple" : "oauthGoogle"); btn.disabled = true;
  try {
    const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, "");
    const { error } = await db.auth.signInWithOAuth({ provider, options: { redirectTo, scopes: provider === "apple" ? "name email" : "email profile", queryParams: provider === "google" ? { access_type: "online", prompt: "select_account" } : undefined } });
    if (error) throw error;
  } catch (e) { console.error("oauth:", e); showToast(provider === "apple" ? "Вход через Apple не удался: " + humanAuthError(e) : "Вход через Google не удался: " + humanAuthError(e), 4200); btn.disabled = false; }
}
function humanAuthError(e) {
  const m = String(e?.message || e || "");
  if (/provider is not enabled|Unsupported provider/i.test(m)) return "провайдер не включён в Supabase";
  if (/network|fetch/i.test(m)) return "нет сети";
  return m || "неизвестная ошибка";
}
function cleanOAuthUrl() {
  try {
    const u = new URL(location.href);
    if (u.searchParams.has("code") || u.searchParams.has("error_description") || u.hash.includes("access_token")) { u.search = ""; u.hash = ""; history.replaceState(null, "", u.toString()); }
  } catch { /* ignore */ }
}
async function deleteOwnAccount() {
  if (!currentUser || !db) { showToast("Сначала войди в аккаунт"); return; }
  const ok = await confirmAction({ title: "Удалить аккаунт навсегда?", text: "Будут стёрты профиль, смены, настройки, финансы и привязка Telegram. Это действие нельзя отменить.", okText: "Удалить всё", danger: true });
  if (!ok) return;
  const sure = await promptNumber({ title: "Подтверждение", text: "Чтобы подтвердить удаление, введи число 1904.", label: "Код подтверждения", value: "", okText: "Удалить аккаунт" });
  if (sure !== 1904) { if (sure !== null) showToast("Код не совпал — ничего не удалено"); return; }
  try {
    const { error } = await db.rpc("delete_own_account");
    if (error) throw error;
  } catch (e) { console.error("deleteOwnAccount:", e); showToast("Не удалось удалить аккаунт: " + humanAuthError(e) + ". Напиши в поддержку.", 5000); return; }
  try { await db.auth.signOut(); } catch { /* сессия уже недействительна */ }
  currentUser = null; currentProfile = null; homeDirty = false;
  state.shifts = {}; state.settings = normalizeSettings({ ...DEFAULTS, scheduleStart: todayKey() }); state.extra = normalizeExtra({});
  localStorage.removeItem("myPayCloudQueue"); save(); renderAll(); showAuth(true); backAuth(); showToast("Аккаунт удалён. Спасибо, что был с нами.", 4200);
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
      // Мигрируем только точные старые стандартные тарифы, не пользовательские настройки.
      const legacy = isLegacySet(sd.base_pay, sd.case_price, sd.piece_percent);
      state.settings = normalizeSettings({
        basePay: sd.base_pay, holidayPay: sd.holiday_pay,
        casePrice: sd.case_price, percent: sd.piece_percent,
        scheduleStart: sd.schedule_start || state.settings.scheduleStart, goal: sd.monthly_goal
      });
      if (legacy) await cloudSaveSettings();
    } else await ensureCloudDefaults();

    const { data: profile, error: pe } = await db.from("profiles").select("id,name").eq("id", currentUser.id).maybeSingle();
    if (pe) { console.error("cloudLoad profile:", pe); return false; }
    currentProfile = profile || null;
    // Вход через Apple/Google: имя приходит в user_metadata — сохраняем в профиль один раз, чтобы Telegram-бот и iOS видели его.
    if (!currentProfile?.name) {
      const meta = currentUser.user_metadata || {}, oauthName = String(meta.full_name || meta.name || [meta.given_name, meta.family_name].filter(Boolean).join(" ") || "").trim();
      if (oauthName) { const { data: created } = await db.from("profiles").upsert({ id: currentUser.id, name: oauthName }, { onConflict: "id" }).select().maybeSingle(); if (created) currentProfile = created; }
    }

    // Облако — источник истины для аккаунта: пустой ответ очищает старые локальные смены,
    // чтобы один аккаунт никогда не видел смены другого на том же устройстве.
    const cloudShifts = {};
    for (const x of rows || []) {
      const key = String(x.work_date).slice(0, 10);
      const cases = num(x.cases), holiday = !!x.is_holiday;
      const shift = correctLegacyShift({ cases, holiday, base: num(x.base_pay), piece: num(x.piece_pay), total: num(x.total_pay) });
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
  return { user_id: currentUser.id, base_pay: num(s.basePay), holiday_pay: num(s.holidayPay, DEFAULTS.holidayPay), case_price: num(s.casePrice), piece_percent: num(s.percent), schedule_start: s.scheduleStart || todayKey(), monthly_goal: num(s.goal) };
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
  $("settingAdvanceDay").value = state.extra.payday?.advanceDay || ""; $("settingSalaryDay").value = state.extra.payday?.salaryDay || "";
  openModal("settingsModal");
}
async function saveSettings() {
  state.settings = normalizeSettings({
    basePay: $("settingBase").value, holidayPay: $("settingHoliday").value, casePrice: $("settingPrice").value,
    percent: $("settingPercent").value, scheduleStart: $("settingStart").value || state.settings.scheduleStart, goal: $("settingGoal").value
  });
  const payday = { advanceDay: clamp(Math.round(num($("settingAdvanceDay").value, 0)), 0, 31), salaryDay: clamp(Math.round(num($("settingSalaryDay").value, 0)), 0, 31) };
  if (JSON.stringify(payday) !== JSON.stringify(state.extra.payday)) { state.extra.payday = payday; cloudSaveExtra(); }
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
function buildBackup() { return { version: parseInt(APP_VERSION, 10), exportedAt: new Date().toISOString(), settings: state.settings, shifts: state.shifts, extra: state.extra }; }
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
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute("content", dark ? "#0a0c0f" : "#eeeeea"));
}
function cycleTheme() {
  const order = ["system", "light", "dark"], i = order.indexOf(state.extra.theme || "system");
  state.extra.theme = order[(i + 1) % order.length];
  save(); applyTheme(); cloudSaveExtra(); showToast(`Тема: ${$("themeStatus").textContent}`);
}

/* ---------- Финансы: расходы, цели, шаблоны ---------- */
/* ---------- Финансы: счета, операции, лимиты, регулярные платежи, долги, копилки ---------- */
const INCOME_CATEGORIES = ["Аванс", "Зарплата", "Подработка", "Подарок", "Другое"];
const GOAL_EMOJI = ["🎯", "📱", "✈️", "🚗", "🏠", "💍", "🎓", "🛋️", "🏖️", "💻", "🎁", "🛡️"];
const ACCOUNT_TYPES = { card: { label: "Карта", icon: "i-card" }, cash: { label: "Наличные", icon: "i-wallet" }, savings: { label: "Накопительный", icon: "i-target" }, credit: { label: "Кредитка", icon: "i-card" } };

function monthTransactions(d = new Date(), type = null) {
  const p = monthPrefix(d);
  return (state.extra.transactions || []).filter(x => String(x.date || "").startsWith(p) && (!type || x.type === type));
}
function currentMonthExpenses(d = new Date()) { return monthTransactions(d, "expense"); }
function sumAmount(list) { return list.reduce((a, v) => a + num(v.amount), 0); }
function categoryByName(name) { return (state.extra.categories || []).find(c => c.name === name) || null; }
function categoryEmoji(name, type = "expense") { if (type === "income") return "💰"; if (type === "transfer") return "🔁"; return categoryByName(name)?.emoji || "📦"; }
function accountById(id) { return (state.extra.accounts || []).find(a => a.id === id) || null; }
function accountBalance(acc) {
  let b = num(acc.balance);
  for (const t of state.extra.transactions || []) {
    const a = num(t.amount);
    if (t.type === "income" && t.accountId === acc.id) b += a;
    else if (t.type === "expense" && t.accountId === acc.id) b -= a;
    else if (t.type === "transfer") { if (t.accountId === acc.id) b -= a; if (t.toAccountId === acc.id) b += a; }
  }
  return b;
}
function totalBalance() { return (state.extra.accounts || []).reduce((a, acc) => a + accountBalance(acc), 0); }

// Регулярные платежи: следующая дата и статус «оплачен в этом месяце»
function recurringNext(r, today = new Date()) {
  const p = monthPrefix(today), day = clamp(Math.round(num(r.day, 1)), 1, 31);
  const inMonth = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  if (r.lastPaid === p) return inMonth(today.getFullYear(), today.getMonth() + 1);
  return inMonth(today.getFullYear(), today.getMonth());
}
function upcomingRecurring(days = 7, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return (state.extra.recurring || []).map(r => ({ r, next: recurringNext(r, today) })).filter(x => (x.next - start) / 86400000 <= days).sort((a, b) => a.next - b.next);
}
function unpaidRecurringThisMonth(today = new Date()) {
  const p = monthPrefix(today);
  return (state.extra.recurring || []).filter(r => r.lastPaid !== p);
}

// Выплаты: до аванса / зарплаты
const DISTRICT_COEF = 1.15, LUNCH_PAY = 200;
// «Чистый» выход смены без районного коэффициента и обеда: 2 415 / 1,15 − 200 = 1 900 ₽.
function rawShiftPay(e) { return Math.max(0, Math.round((num(e.base) / DISTRICT_COEF - LUNCH_PAY) * 100) / 100); }
function advancePart(entries) { return entries.filter(e => Number(e.k.slice(8, 10)) <= 15).reduce((a, e) => a + rawShiftPay(e), 0); }
function paydayInfo(today = new Date()) {
  const pd = state.extra.payday || {}; const adv = clamp(Math.round(num(pd.advanceDay, 0)), 0, 31), sal = clamp(Math.round(num(pd.salaryDay, 0)), 0, 31);
  if (!adv && !sal) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const candidates = [];
  for (const [type, day] of [["advance", adv], ["salary", sal]]) {
    if (!day) continue;
    for (let k = 0; k < 3; k++) {
      const y = today.getFullYear(), m = today.getMonth() + k;
      const d = new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
      if (d >= start) { candidates.push({ type, date: d }); break; }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.date - b.date);
  const next = candidates[0], days = Math.round((next.date - start) / 86400000);
  // 23-го (аванс): только «чистый» выход за 1–15 число текущего месяца — без обедов и районного коэффициента.
  // 8-го (зарплата): всё остальное за прошлый месяц — выход + обеды + районный за 16–31, обеды и районный за 1–15,
  // сделка за весь месяц и премии. Т.е. весь заработок прошлого месяца минус уже выплаченный аванс.
  let expected = 0;
  if (next.type === "advance") {
    expected = advancePart(monthEntries(next.date));
  } else {
    const prev = new Date(next.date.getFullYear(), next.date.getMonth() - 1, 1);
    const es = monthEntries(prev), total = es.reduce((a, e) => a + num(e.total), 0);
    expected = Math.max(0, total - advancePart(es));
  }
  return { type: next.type, date: next.date, days, expected };
}

function financeNumbers() {
  const d = new Date(), es = monthEntries(d), income = monthSum(es);
  const expenses = sumAmount(monthTransactions(d, "expense")), received = sumAmount(monthTransactions(d, "income"));
  const free = income - expenses, goal = num(state.settings.goal);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), remainingDays = Math.max(1, days - d.getDate() + 1);
  const upcoming = sumAmount(unpaidRecurringThisMonth(d)), forecast = (monthForecast(d) ?? income) - expenses - upcoming;
  const daily = Math.max(0, free - upcoming) / remainingDays, rate = income > 0 ? Math.round(clamp(free / income, 0, 1) * 100) : 0;
  return { income, expenses, received, free, forecast, upcoming, goal, remainingDays, daily, rate, balance: totalBalance() };
}

// Рекомендации «советника» — правила без ИИ, зато честные и объяснимые.
function buildInsights() {
  const out = [], d = new Date(), n = financeNumbers(), today = todayKey();
  const push = (tone, text) => out.push({ tone, text });
  const due = upcomingRecurring(7, d);
  if (due.length) {
    const sum = sumAmount(due.map(x => x.r));
    const first = due[0], firstDays = Math.round((first.next - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    const when = firstDays === 0 ? "сегодня" : firstDays === 1 ? "завтра" : firstDays < 0 ? `просрочен на ${-firstDays} ${plural(-firstDays, "день", "дня", "дней")}` : `через ${firstDays} ${plural(firstDays, "день", "дня", "дней")}`;
    if (sum > Math.max(0, n.free)) push("warn", `Ближайшие платежи на ${money(sum)} (${escapeHtml(first.r.name)} ${when}) — свободных денег ${money(Math.max(0, n.free))}, не хватает ${money(sum - Math.max(0, n.free))}.`);
    else push("info", `${escapeHtml(first.r.name)} ${money(first.r.amount)} — ${when}. После всех платежей недели останется ${money(n.free - sum)}.`);
  }
  const spentBy = {}; monthTransactions(d, "expense").forEach(t => spentBy[t.category] = (spentBy[t.category] || 0) + num(t.amount));
  for (const c of state.extra.categories || []) {
    const limit = num(c.limit); if (!limit) continue;
    const spent = spentBy[c.name] || 0, pct = spent / limit;
    if (pct >= 1) push("warn", `Лимит «${escapeHtml(c.name)}» превышен на ${money(spent - limit)} — в этом месяце лучше притормозить.`);
    else if (pct >= .8) push("info", `Лимит «${escapeHtml(c.name)}» почти исчерпан: ${Math.round(pct * 100)}% (${money(limit - spent)} в запасе).`);
  }
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1), dayN = d.getDate();
  const prevSame = sumAmount(monthTransactions(prev, "expense").filter(t => Number(t.date.slice(8, 10)) <= dayN));
  if (prevSame > 0 && n.expenses > prevSame * 1.15) push("warn", `Тратишь на ${Math.round((n.expenses / prevSame - 1) * 100)}% больше, чем в прошлом месяце к этому дню (${money(n.expenses)} против ${money(prevSame)}).`);
  else if (prevSame > 0 && n.expenses < prevSame * .85) push("good", `Расходы ниже прошлого месяца на ${Math.round((1 - n.expenses / prevSame) * 100)}% — так держать 👍`);
  const top = Object.entries(spentBy).sort((a, b) => b[1] - a[1])[0];
  if (top && n.expenses > 0 && top[1] / n.expenses >= .45 && Object.keys(spentBy).length > 1) push("info", `${Math.round(top[1] / n.expenses * 100)}% расходов месяца — «${escapeHtml(top[0])}». Если хочется экономить, начинать стоит здесь.`);
  for (const g of state.extra.goals || []) {
    const left = num(g.amount) - num(g.saved); if (left <= 0 || !isDateKey(g.deadline)) continue;
    const months = Math.max(1, Math.ceil((fromKey(g.deadline) - d) / (30.4 * 86400000)));
    if (fromKey(g.deadline) < d) { push("warn", `Срок цели «${escapeHtml(g.name)}» прошёл, не хватает ${money(left)}. Передвинь дату или пополни копилку.`); continue; }
    push("info", `Чтобы успеть с «${escapeHtml(g.name)}» к ${dateText(fromKey(g.deadline), { day: "numeric", month: "long" })}, откладывай ≈ ${money(left / months)} в месяц.`);
  }
  for (const dbt of state.extra.debts || []) {
    const left = num(dbt.amount) - num(dbt.paid); if (left <= 0 || !isDateKey(dbt.due) || dbt.due >= today) continue;
    const days = Math.round((fromKey(today) - fromKey(dbt.due)) / 86400000);
    push("warn", dbt.direction === "owed" ? `${escapeHtml(dbt.person)} задерживает ${money(left)} уже ${days} ${plural(days, "день", "дня", "дней")} — самое время напомнить.` : `Долг ${escapeHtml(dbt.person)} на ${money(left)} просрочен на ${days} ${plural(days, "день", "дня", "дней")}.`);
  }
  const pay = paydayInfo(d);
  if (pay && !due.length) push("info", `${pay.type === "advance" ? "Аванс" : "Зарплата"} через ${pay.days} ${plural(pay.days, "день", "дня", "дней")}${pay.expected ? ` (≈ ${money(pay.expected)})` : ""}. До этого можно тратить ≈ ${money(Math.max(0, n.free) / Math.max(1, pay.days))} в день.`);
  if (n.income > 0 && n.rate >= 30 && n.expenses > 0) push("good", `Остаётся ${n.rate}% заработка — отличный темп. Отложи часть в копилку, пока не потратилось.`);
  if (!out.length) push("info", n.income > 0 ? "Пока всё ровно: расходы под контролем, платежей на неделе нет. Добавь лимиты и цели — подскажу больше." : "Внеси смены и расходы — начну подсказывать, где деньги утекают и сколько можно отложить.");
  const order = { warn: 0, info: 1, good: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 4);
}

function renderFinance() {
  if (!$("financeIncome")) return;
  const n = financeNumbers();
  $("financeIncome").textContent = money(n.income); $("financeExpenses").textContent = money(n.expenses);
  $("financeReceived").textContent = money(n.received); $("financeForecast").textContent = money(n.forecast);
  $("freeBalance").textContent = money(n.free);
  $("dailyBudget").textContent = n.income <= 0 && n.expenses <= 0 ? "Внеси смены и расходы — посчитаем, сколько остаётся" : n.free > 0 ? `≈ ${money(n.daily)} в день до конца месяца${n.upcoming ? " с учётом платежей" : ""}` : "Расходы уже выше заработка за месяц";
  $("savingsRate").textContent = n.rate + "%"; $("savingsRing").style.setProperty("--p", n.rate);
  renderPayday(); renderAccounts(); renderInsights2(); renderLimits(); renderRecurring(); renderDebts(); renderGoals(); renderTransactions(); renderTemplates(); checkGoalCelebration();
}
function renderPayday() {
  const strip = $("paydayStrip"); if (!strip) return;
  const p = paydayInfo();
  strip.hidden = false;
  if (!p) { $("paydayTitle").textContent = "Когда аванс и зарплата?"; $("paydayMeta").textContent = "Укажи даты — покажу обратный отсчёт"; return; }
  const label = p.type === "advance" ? "аванса" : "зарплаты";
  $("paydayTitle").textContent = p.days === 0 ? `Сегодня день ${label} 🎉` : `До ${label} ${p.days} ${plural(p.days, "день", "дня", "дней")}`;
  $("paydayMeta").textContent = `${dateText(p.date, { day: "numeric", month: "long" })}${p.expected ? ` · ожидаемо ≈ ${money(p.expected)}` : ""}`;
}
function renderAccounts() {
  const row = $("accountsRow"); if (!row) return;
  const accs = state.extra.accounts || [];
  if (!accs.length) { row.innerHTML = '<button type="button" class="account-card account-empty" id="accountsEmptyBtn"><b>Добавь счета</b><small>Карта, наличные, накопительный — балансы будут считаться сами</small></button>'; $("accountsEmptyBtn").onclick = () => openAccountModal(); return; }
  const total = totalBalance();
  row.innerHTML = `<div class="account-card account-total"><small>Всего на счетах</small><b class="num">${money(total)}</b><span>${accs.length} ${plural(accs.length, "счёт", "счёта", "счетов")}</span></div>` +
    accs.map(a => { const t = ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.card, b = accountBalance(a); return `<button type="button" class="account-card ${b < 0 ? "is-negative" : ""}" data-acc="${escapeHtml(a.id)}"><span class="account-icon">${icon(t.icon)}</span><small>${escapeHtml(a.name)}</small><b class="num">${money(b)}</b><span>${t.label}</span></button>`; }).join("");
  row.querySelectorAll("[data-acc]").forEach(b => b.onclick = () => openAccountModal(b.dataset.acc));
}
function renderInsights2() {
  const box = $("insightsList"); if (!box) return;
  const icons = { warn: "⚠️", info: "💡", good: "✅" };
  box.innerHTML = buildInsights().map(i => `<div class="insight insight-${i.tone}"><span>${icons[i.tone]}</span><p>${i.text}</p></div>`).join("");
}
function renderLimits() {
  const box = $("limitsList"); if (!box) return;
  const spentBy = {}; monthTransactions(new Date(), "expense").forEach(t => spentBy[t.category] = (spentBy[t.category] || 0) + num(t.amount));
  const cats = (state.extra.categories || []).filter(c => num(c.limit) > 0 || spentBy[c.name]);
  Object.keys(spentBy).forEach(name => { if (!cats.find(c => c.name === name)) cats.push({ id: "tmp_" + name, name, emoji: "📦", limit: 0 }); });
  if (!cats.length) { box.innerHTML = '<div class="empty">Расходов пока нет. Добавь первую трату или задай лимиты по категориям.</div>'; return; }
  const max = Math.max(...cats.map(c => Math.max(spentBy[c.name] || 0, num(c.limit))), 1);
  box.innerHTML = cats.sort((a, b) => (spentBy[b.name] || 0) - (spentBy[a.name] || 0)).map(c => {
    const spent = spentBy[c.name] || 0, limit = num(c.limit), pct = limit ? Math.min(100, Math.round(spent / limit * 100)) : Math.round(spent / max * 100);
    const state_ = limit && spent >= limit ? "is-over" : limit && spent / limit >= .8 ? "is-warn" : "";
    return `<div class="limit-row ${state_}"><div class="limit-head"><span>${c.emoji || "📦"} ${escapeHtml(c.name)}</span><b class="num">${money(spent)}${limit ? ` <em>/ ${money(limit)}</em>` : ""}</b></div><div class="track"><i style="width:${pct}%"></i></div>${limit ? `<small>${spent >= limit ? "Превышен на " + money(spent - limit) : "Осталось " + money(limit - spent)}</small>` : ""}</div>`;
  }).join("");
}
function renderRecurring() {
  const box = $("recurringList"); if (!box) return;
  const list = (state.extra.recurring || []).map(r => ({ r, next: recurringNext(r) })).sort((a, b) => a.next - b.next);
  if (!list.length) { box.innerHTML = '<div class="empty">Аренда, кредит, связь, подписки — добавь, и я напомню заранее и учту в остатке.</div>'; return; }
  const p = monthPrefix(new Date()), start = fromKey(todayKey());
  box.innerHTML = list.map(({ r, next }) => {
    const days = Math.round((next - start) / 86400000), paid = r.lastPaid === p;
    const when = paid ? "оплачено в этом месяце" : days < 0 ? `просрочен на ${-days} ${plural(-days, "день", "дня", "дней")}` : days === 0 ? "сегодня" : days === 1 ? "завтра" : `через ${days} ${plural(days, "день", "дня", "дней")} · ${dateText(next, { day: "numeric", month: "short" })}`;
    return `<div class="rec-row ${paid ? "is-paid" : days <= 3 ? "is-soon" : ""}"><button type="button" class="rec-main" data-rec-edit="${escapeHtml(r.id)}"><b>${categoryEmoji(r.category)} ${escapeHtml(r.name)}</b><small>${when}</small></button><strong class="num">${money(r.amount)}</strong>${paid ? `<span class="rec-done">${icon("i-check")}</span>` : `<button type="button" class="btn btn-soft btn-sm" data-rec-pay="${escapeHtml(r.id)}">Оплатил</button>`}</div>`;
  }).join("");
  box.querySelectorAll("[data-rec-pay]").forEach(b => b.onclick = () => payRecurring(b.dataset.recPay));
  box.querySelectorAll("[data-rec-edit]").forEach(b => b.onclick = () => openRecurringModal(b.dataset.recEdit));
}
function renderDebts() {
  const box = $("debtsList"), totals = $("debtTotals"); if (!box) return;
  const debts = (state.extra.debts || []).filter(x => num(x.amount) - num(x.paid) > 0.001);
  const iOwe = sumAmount(debts.filter(x => x.direction !== "owed").map(x => ({ amount: num(x.amount) - num(x.paid) })));
  const owed = sumAmount(debts.filter(x => x.direction === "owed").map(x => ({ amount: num(x.amount) - num(x.paid) })));
  totals.innerHTML = debts.length ? `<div class="debt-total"><small>Я должен</small><b class="num">${money(iOwe)}</b></div><div class="debt-total"><small>Мне должны</small><b class="num">${money(owed)}</b></div><div class="debt-total"><small>Баланс</small><b class="num ${owed - iOwe >= 0 ? "pos" : "neg"}">${owed - iOwe >= 0 ? "+" : "−"}${money(Math.abs(owed - iOwe))}</b></div>` : "";
  if (!debts.length) { box.innerHTML = '<div class="empty">Одолжил другу или взял до зарплаты — запиши, чтобы ничего не потерялось.</div>'; return; }
  const today = todayKey();
  box.innerHTML = debts.sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999"))).map(x => {
    const left = num(x.amount) - num(x.paid), pct = Math.round(num(x.paid) / Math.max(1, num(x.amount)) * 100), overdue = isDateKey(x.due) && x.due < today;
    return `<div class="debt-row ${x.direction === "owed" ? "is-owed" : "is-mine"} ${overdue ? "is-overdue" : ""}"><button type="button" class="debt-main" data-debt-edit="${escapeHtml(x.id)}"><b>${x.direction === "owed" ? "→ " : "← "}${escapeHtml(x.person)}</b><small>${x.direction === "owed" ? "должен тебе" : "ты должен"} · ${isDateKey(x.due) ? (overdue ? "просрочено с " : "до ") + dateText(fromKey(x.due), { day: "numeric", month: "short" }) : "без срока"}${x.note ? " · " + escapeHtml(x.note) : ""}</small><div class="track"><i style="width:${pct}%"></i></div></button><div class="debt-side"><strong class="num">${money(left)}</strong><button type="button" class="btn btn-soft btn-sm" data-debt-pay="${escapeHtml(x.id)}">${x.direction === "owed" ? "Вернули" : "Вернул"}</button></div></div>`;
  }).join("");
  box.querySelectorAll("[data-debt-pay]").forEach(b => b.onclick = () => addDebtPayment(b.dataset.debtPay));
  box.querySelectorAll("[data-debt-edit]").forEach(b => b.onclick = () => openDebtModal(b.dataset.debtEdit));
}
function goalForecast(g) {
  const left = num(g.amount) - num(g.saved); if (left <= 0) return { done: true };
  const deposits = (g.deposits || []).filter(x => isDateKey(x.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (deposits.length < 2) return { done: false };
  const spanDays = Math.max(7, (fromKey(deposits.at(-1).date) - fromKey(deposits[0].date)) / 86400000 + 1);
  const perDay = sumAmount(deposits) / spanDays; if (perDay <= 0) return { done: false };
  const eta = new Date(); eta.setDate(eta.getDate() + Math.ceil(left / perDay));
  return { done: false, eta, perMonth: perDay * 30.4 };
}
function renderGoals() {
  const box = $("goalsList"); if (!box) return;
  const goals = state.extra.goals || [];
  if (!goals.length) { box.innerHTML = '<div class="empty">Копилок пока нет. Создай первую — покажу прогресс, срок и сколько откладывать.</div>'; return; }
  box.innerHTML = goals.map(g => {
    const amount = Math.max(1, num(g.amount, 1)), saved = Math.max(0, num(g.saved)), pct = Math.min(100, Math.round(saved / amount * 100)), f = goalForecast(g);
    let meta = pct >= 100 ? "Цель достигнута 🎉" : "осталось " + money(Math.max(0, amount - saved));
    let hint = "";
    if (pct < 100 && isDateKey(g.deadline)) {
      const months = Math.max(1, Math.ceil((fromKey(g.deadline) - new Date()) / (30.4 * 86400000)));
      hint = fromKey(g.deadline) < new Date() ? "срок прошёл" : `к ${dateText(fromKey(g.deadline), { day: "numeric", month: "short" })} · ≈ ${money((amount - saved) / months)} в мес.`;
    } else if (pct < 100 && f.eta) hint = `при таком темпе — к ${dateText(f.eta, { day: "numeric", month: "short" })}`;
    return `<div class="goal-item" data-goal="${escapeHtml(g.id)}">
      <div class="goal-top"><span class="goal-emoji">${g.emoji || "🎯"}</span><b>${escapeHtml(g.name)}</b><span class="num">${money(saved)} / ${money(amount)}</span></div>
      <div class="track"><i class="${pct >= 100 ? "is-done" : ""}" style="width:${pct}%"></i></div>
      <div class="goal-meta"><span>${pct}%${hint ? " · " + hint : ""}</span><span>${meta}</span></div>
      <div class="goal-actions"><button type="button" class="btn btn-soft btn-sm" data-goal-add="${escapeHtml(g.id)}">${icon("i-plus")}Пополнить</button><button type="button" class="btn btn-ghost btn-sm" data-goal-hist="${escapeHtml(g.id)}">${(g.deposits || []).length} ${plural((g.deposits || []).length, "взнос", "взноса", "взносов")}</button><button type="button" class="btn btn-soft btn-sm danger" data-goal-del="${escapeHtml(g.id)}">${icon("i-trash")}</button></div>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-goal-add]").forEach(b => b.onclick = () => topUpGoal(b.dataset.goalAdd));
  box.querySelectorAll("[data-goal-del]").forEach(b => b.onclick = () => deleteGoal(b.dataset.goalDel));
  box.querySelectorAll("[data-goal-hist]").forEach(b => b.onclick = () => showGoalHistory(b.dataset.goalHist));
}
let txFilter = "all", txLimit = 12;
function renderTransactions() {
  const list = $("expenseList"), more = $("txMoreBtn"); if (!list) return;
  const all = (state.extra.transactions || []).filter(t => txFilter === "all" || t.type === txFilter).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  if (!all.length) { list.innerHTML = '<div class="empty">Операций пока нет. Нажми «Расход» или «Доход» вверху экрана.</div>'; more.classList.add("hidden"); return; }
  let lastMonth = "";
  list.innerHTML = all.slice(0, txLimit).map(t => {
    const m = String(t.date).slice(0, 7), head = m !== lastMonth ? `<div class="tx-month">${dateText(fromKey(t.date), { month: "long", year: "numeric" }).replace(" г.", "")}</div>` : ""; lastMonth = m;
    const acc = accountById(t.accountId), to = accountById(t.toAccountId);
    const title = t.type === "transfer" ? `${acc ? escapeHtml(acc.name) : "?"} → ${to ? escapeHtml(to.name) : "?"}` : escapeHtml(t.category || (t.type === "income" ? "Доход" : "Расход"));
    const sub = [dateText(fromKey(t.date), { day: "numeric", month: "short" }), t.type !== "transfer" && acc ? escapeHtml(acc.name) : "", t.note ? escapeHtml(t.note) : ""].filter(Boolean).join(" · ");
    const sign = t.type === "income" ? "+" : t.type === "expense" ? "−" : "";
    return `${head}<div class="expense-row tx-${t.type}"><span class="tx-emoji">${categoryEmoji(t.category, t.type)}</span><div><b>${title}</b><small>${sub}</small></div><strong class="num">${sign}${money(t.amount)}</strong><button type="button" class="expense-delete" data-tx-del="${escapeHtml(t.id)}" aria-label="Удалить операцию">${icon("i-x")}</button></div>`;
  }).join("");
  more.classList.toggle("hidden", all.length <= txLimit);
  list.querySelectorAll("[data-tx-del]").forEach(b => b.onclick = () => deleteTransaction(b.dataset.txDel));
}

/* --- модалки финансов --- */
let txType = "expense";
function fillSelect(sel, items, value) { sel.innerHTML = items.map(i => `<option value="${escapeHtml(i.value)}">${escapeHtml(i.label)}</option>`).join(""); if (value !== undefined) sel.value = value; }
function accountOptions(withNone = true) { const list = (state.extra.accounts || []).map(a => ({ value: a.id, label: a.name })); return withNone ? [{ value: "", label: "Без счёта" }, ...list] : list; }
function setTxType(type) {
  txType = type;
  document.querySelectorAll("#txTypeSeg button").forEach(b => { const on = b.dataset.type === type; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
  const cats = type === "income" ? INCOME_CATEGORIES.map(c => ({ value: c, label: c })) : (state.extra.categories || []).map(c => ({ value: c.name, label: `${c.emoji || ""} ${c.name}`.trim() }));
  fillSelect($("expenseCategory"), cats);
  $("txCategoryWrap").classList.toggle("hidden", type === "transfer");
  $("txToAccountWrap").classList.toggle("hidden", type !== "transfer");
  fillSelect($("txAccount"), accountOptions(type !== "transfer")); fillSelect($("txToAccount"), accountOptions(false));
  const accs = state.extra.accounts || [];
  if (type === "transfer" && accs.length > 1) $("txToAccount").value = accs[1].id;
  $("expenseTitle").textContent = type === "expense" ? "Новая трата" : type === "income" ? "Новый доход" : "Перевод между счетами";
  $("expenseSave").querySelector("span").textContent = type === "expense" ? "Добавить расход" : type === "income" ? "Добавить доход" : "Перевести";
}
function openExpenseModal(type = "expense") {
  $("expenseAmount").value = ""; $("expenseDate").value = todayKey(); $("expenseNote").value = "";
  setTxType(type); openModal("expenseModal"); setTimeout(() => $("expenseAmount").focus(), 80);
}
async function saveExpense() {
  const amount = Math.max(0, num($("expenseAmount").value)), date = isDateKey($("expenseDate").value) ? $("expenseDate").value : todayKey(), note = $("expenseNote").value.trim();
  if (!amount) { showToast("Укажи сумму"); return; }
  const tx = { id: uid("tx"), type: txType, amount, category: txType === "transfer" ? "" : $("expenseCategory").value, accountId: $("txAccount").value || null, toAccountId: txType === "transfer" ? $("txToAccount").value || null : null, date, note };
  if (txType === "transfer" && (!tx.accountId || !tx.toAccountId || tx.accountId === tx.toAccountId)) { showToast("Выбери два разных счёта"); return; }
  state.extra.transactions.push(tx); save(); cloudSaveExtra();
  closeModal("expenseModal"); renderFinance(); showToast(txType === "expense" ? "Расход добавлен" : txType === "income" ? "Доход добавлен" : "Перевод записан");
}
async function deleteExpense(id) { return deleteTransaction(id); }
async function deleteTransaction(id) {
  state.extra.transactions = state.extra.transactions.filter(x => x.id !== id); save(); cloudSaveExtra(); renderFinance(); showToast("Операция удалена");
}

let editingAccount = null;
function openAccountModal(id = null) {
  const a = id ? accountById(id) : null; editingAccount = a ? a.id : null;
  $("accountTitle").textContent = a ? "Счёт" : "Новый счёт";
  $("accountName").value = a ? a.name : ""; $("accountType").value = a ? a.type : "card";
  $("accountBalance").value = a ? String(Math.round(accountBalance(a) * 100) / 100) : "";
  $("accountDelete").classList.toggle("hidden", !a);
  openModal("accountModal"); setTimeout(() => $("accountName").focus(), 80);
}
async function saveAccount() {
  const name = $("accountName").value.trim(), type = $("accountType").value, wanted = num($("accountBalance").value);
  if (!name) { showToast("Назови счёт"); return; }
  if (editingAccount) {
    const a = accountById(editingAccount); if (!a) return;
    const current = accountBalance(a); a.name = name; a.type = type; a.balance = num(a.balance) + (wanted - current); // корректируем стартовый остаток так, чтобы текущий стал введённым
  } else state.extra.accounts.push({ id: uid("acc"), name, type, balance: wanted });
  save(); cloudSaveExtra(); closeModal("accountModal"); renderFinance(); showToast("Счёт сохранён");
}
async function deleteAccount() {
  const a = accountById(editingAccount); if (!a) return;
  if (!await confirmAction({ title: "Удалить счёт?", text: `«${a.name}» будет удалён. Операции останутся, но перестанут относиться к счёту.` })) return;
  state.extra.accounts = state.extra.accounts.filter(x => x.id !== a.id);
  state.extra.transactions.forEach(t => { if (t.accountId === a.id) t.accountId = null; if (t.toAccountId === a.id) t.toAccountId = null; });
  save(); cloudSaveExtra(); closeModal("accountModal"); renderFinance();
}

function openLimitsModal() {
  const box = $("limitsEditor");
  box.innerHTML = (state.extra.categories || []).map(c => `<div class="limit-edit" data-cat="${escapeHtml(c.id)}"><span>${c.emoji || "📦"} ${escapeHtml(c.name)}</span><input type="number" min="0" step="500" inputmode="decimal" placeholder="без лимита" value="${num(c.limit) ? num(c.limit) : ""}"><button type="button" class="icon-btn icon-btn-sm" data-cat-del="${escapeHtml(c.id)}" aria-label="Удалить категорию">${icon("i-x")}</button></div>`).join("");
  box.querySelectorAll("[data-cat-del]").forEach(b => b.onclick = async () => {
    const c = state.extra.categories.find(x => x.id === b.dataset.catDel); if (!c) return;
    const used = (state.extra.transactions || []).some(t => t.type === "expense" && t.category === c.name);
    if (used) { showToast("Категория используется в операциях — сначала удали их"); return; }
    state.extra.categories = state.extra.categories.filter(x => x.id !== c.id); save(); cloudSaveExtra(); openLimitsModal();
  });
  $("newCategoryName").value = ""; openModal("limitsModal");
}
function addCategory() {
  const name = $("newCategoryName").value.trim(); if (!name) return;
  if (categoryByName(name)) { showToast("Такая категория уже есть"); return; }
  state.extra.categories.push({ id: uid("cat"), name, emoji: "🏷️", limit: 0 }); save(); cloudSaveExtra(); openLimitsModal();
}
async function saveLimits() {
  document.querySelectorAll("#limitsEditor .limit-edit").forEach(row => { const c = state.extra.categories.find(x => x.id === row.dataset.cat); if (c) c.limit = Math.max(0, num(row.querySelector("input").value)); });
  save(); cloudSaveExtra(); closeModal("limitsModal"); renderFinance(); showToast("Лимиты сохранены");
}

let editingRecurring = null;
function openRecurringModal(id = null) {
  const r = id ? (state.extra.recurring || []).find(x => x.id === id) : null; editingRecurring = r ? r.id : null;
  $("recurringTitle").textContent = r ? "Платёж" : "Новый платёж";
  $("recName").value = r ? r.name : ""; $("recAmount").value = r ? r.amount : ""; $("recDay").value = r ? r.day : new Date().getDate();
  fillSelect($("recCategory"), (state.extra.categories || []).map(c => ({ value: c.name, label: `${c.emoji || ""} ${c.name}`.trim() })), r ? r.category : "Жильё");
  fillSelect($("recAccount"), accountOptions(true), r ? r.accountId || "" : "");
  $("recurringDelete").classList.toggle("hidden", !r);
  openModal("recurringModal"); setTimeout(() => $("recName").focus(), 80);
}
async function saveRecurring() {
  const name = $("recName").value.trim(), amount = Math.max(0, num($("recAmount").value)), day = clamp(Math.round(num($("recDay").value, 1)), 1, 31);
  if (!name || !amount) { showToast("Укажи название и сумму"); return; }
  const data = { name, amount, day, category: $("recCategory").value, accountId: $("recAccount").value || null };
  const r = editingRecurring ? state.extra.recurring.find(x => x.id === editingRecurring) : null;
  if (r) Object.assign(r, data); else state.extra.recurring.push({ id: uid("rec"), lastPaid: null, ...data });
  save(); cloudSaveExtra(); closeModal("recurringModal"); renderFinance(); showToast("Платёж сохранён");
}
async function deleteRecurring() {
  const r = state.extra.recurring.find(x => x.id === editingRecurring); if (!r) return;
  if (!await confirmAction({ title: "Удалить платёж?", text: `«${r.name}» больше не будет напоминать о себе.` })) return;
  state.extra.recurring = state.extra.recurring.filter(x => x.id !== r.id); save(); cloudSaveExtra(); closeModal("recurringModal"); renderFinance();
}
async function payRecurring(id) {
  const r = (state.extra.recurring || []).find(x => x.id === id); if (!r) return;
  state.extra.transactions.push({ id: uid("tx"), type: "expense", amount: num(r.amount), category: r.category || "Другое", accountId: r.accountId || null, toAccountId: null, date: todayKey(), note: r.name });
  r.lastPaid = monthPrefix(new Date()); save(); cloudSaveExtra(); renderFinance(); showToast(`${r.name}: ${money(r.amount)} записано в расходы`);
}

let editingDebt = null, debtDir = "i_owe";
function setDebtDir(dir) { debtDir = dir; document.querySelectorAll("#debtDirSeg button").forEach(b => { const on = b.dataset.dir === dir; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); }); }
function openDebtModal(id = null) {
  const x = id ? (state.extra.debts || []).find(d => d.id === id) : null; editingDebt = x ? x.id : null;
  $("debtTitle").textContent = x ? "Долг" : "Новый долг";
  setDebtDir(x ? x.direction : "i_owe");
  $("debtPerson").value = x ? x.person : ""; $("debtAmount").value = x ? x.amount : ""; $("debtDue").value = x && isDateKey(x.due) ? x.due : ""; $("debtNote").value = x ? x.note || "" : "";
  $("debtDelete").classList.toggle("hidden", !x);
  openModal("debtModal"); setTimeout(() => $("debtPerson").focus(), 80);
}
async function saveDebt() {
  const person = $("debtPerson").value.trim(), amount = Math.max(0, num($("debtAmount").value)), due = isDateKey($("debtDue").value) ? $("debtDue").value : null, note = $("debtNote").value.trim();
  if (!person || !amount) { showToast("Укажи имя и сумму"); return; }
  const x = editingDebt ? state.extra.debts.find(d => d.id === editingDebt) : null;
  if (x) Object.assign(x, { person, amount, due, note, direction: debtDir }); else state.extra.debts.push({ id: uid("debt"), person, amount, paid: 0, due, note, direction: debtDir, createdAt: todayKey() });
  save(); cloudSaveExtra(); closeModal("debtModal"); renderFinance(); showToast("Долг сохранён");
}
async function deleteDebt() {
  const x = state.extra.debts.find(d => d.id === editingDebt); if (!x) return;
  if (!await confirmAction({ title: "Удалить долг?", text: `Запись «${x.person} · ${money(x.amount)}» будет удалена.` })) return;
  state.extra.debts = state.extra.debts.filter(d => d.id !== x.id); save(); cloudSaveExtra(); closeModal("debtModal"); renderFinance();
}
async function addDebtPayment(id) {
  const x = (state.extra.debts || []).find(d => d.id === id); if (!x) return;
  const left = num(x.amount) - num(x.paid);
  const v = await promptNumber({ title: x.direction === "owed" ? "Сколько вернули?" : "Сколько вернул?", text: `${x.person}: осталось ${money(left)}.`, label: "Сумма, ₽", value: Math.round(left), okText: "Записать" });
  if (v === null || v <= 0) return;
  x.paid = Math.min(num(x.amount), num(x.paid) + v); save(); cloudSaveExtra(); renderFinance();
  if (num(x.amount) - num(x.paid) <= 0.001) { showToast("Долг закрыт ✓"); confetti(); }
}

let goalEmoji = GOAL_EMOJI[0];
function renderGoalEmojiRow() {
  const row = $("goalEmojiRow"); if (!row) return;
  row.innerHTML = GOAL_EMOJI.map(e => `<button type="button" class="emoji-pick ${e === goalEmoji ? "active" : ""}" data-emoji="${e}" role="radio" aria-checked="${e === goalEmoji}">${e}</button>`).join("");
  row.querySelectorAll("[data-emoji]").forEach(b => b.onclick = () => { goalEmoji = b.dataset.emoji; renderGoalEmojiRow(); });
}
function openGoalModal() { goalEmoji = GOAL_EMOJI[0]; renderGoalEmojiRow(); $("goalName").value = ""; $("goalAmount").value = ""; $("goalSaved").value = "0"; $("goalDeadline").value = ""; openModal("goalModal"); setTimeout(() => $("goalName").focus(), 80); }
async function saveGoal() {
  const name = $("goalName").value.trim(), amount = Math.max(0, num($("goalAmount").value)), saved = Math.max(0, num($("goalSaved").value)), deadline = isDateKey($("goalDeadline").value) ? $("goalDeadline").value : null;
  if (!name || !amount) { showToast("Укажи название и сумму цели"); return; }
  state.extra.goals.push({ id: uid("goal"), name, amount, saved, emoji: goalEmoji, deadline, deposits: saved > 0 ? [{ id: uid("dep"), amount: saved, date: todayKey(), note: "стартовый взнос" }] : [] }); save(); cloudSaveExtra();
  closeModal("goalModal"); renderFinance(); showToast("Копилка создана 🎯");
}
async function topUpGoal(id) {
  const g = state.extra.goals.find(x => x.id === id); if (!g) return;
  const v = await promptNumber({ title: `${g.emoji || "🎯"} Пополнить «${g.name}»`, text: `Отложено ${money(g.saved)} из ${money(g.amount)}.`, label: "Сколько добавить, ₽", value: 1000, okText: "Пополнить" });
  if (v === null || v <= 0) return;
  g.saved = Math.max(0, num(g.saved)) + v; g.deposits = g.deposits || []; g.deposits.push({ id: uid("dep"), amount: v, date: todayKey(), note: "" });
  save(); cloudSaveExtra(); renderFinance(); showToast(`+${money(v)} в копилку`);
}
async function quickGoalDeposit() {
  const goals = state.extra.goals || [];
  if (!goals.length) { openGoalModal(); return; }
  const open = goals.filter(g => num(g.saved) < num(g.amount));
  topUpGoal((open[0] || goals[0]).id);
}
function showGoalHistory(id) {
  const g = state.extra.goals.find(x => x.id === id); if (!g) return;
  const deps = (g.deposits || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const text = deps.length ? deps.slice(0, 8).map(d => `${dateText(fromKey(d.date), { day: "numeric", month: "short" })} — ${money(d.amount)}${d.note ? " · " + d.note : ""}`).join("\n") : "Взносов пока нет.";
  confirmAction({ title: `${g.emoji || "🎯"} ${g.name}`, text, okText: "Пополнить", cancelText: "Закрыть", danger: false }).then(ok => { if (ok) topUpGoal(id); });
}
async function deleteGoal(id) {
  const g = state.extra.goals.find(x => x.id === id); if (!g) return;
  if (!await confirmAction({ title: "Удалить копилку?", text: `«${g.name}» будет удалена без возможности восстановления.` })) return;
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
function openPaydayModal() { const p = state.extra.payday || {}; $("paydayAdvance").value = p.advanceDay || ""; $("paydaySalary").value = p.salaryDay || ""; openModal("paydayModal"); }
async function savePayday() {
  state.extra.payday = { advanceDay: clamp(Math.round(num($("paydayAdvance").value, 0)), 0, 31), salaryDay: clamp(Math.round(num($("paydaySalary").value, 0)), 0, 31) };
  save(); cloudSaveExtra(); closeModal("paydayModal"); renderFinance(); showToast("Даты выплат сохранены");
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
  const n = currentProfile?.name?.trim() || currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || (currentUser ? currentUser.email : "") || "Мой расчёт";
  $("profileName").textContent = n; $("profileAvatar").textContent = (n[0] || "₽").toUpperCase();
  const provider = currentUser?.app_metadata?.provider; const via = provider === "apple" ? "Apple" : provider === "google" ? "Google" : "";
  $("profileMeta").textContent = currentUser ? `${currentUser.email || ""}${via ? " · вход через " + via : ""} · синхронизация включена` : db ? "Войди в аккаунт, чтобы синхронизировать данные" : "Локальный режим: данные хранятся на этом устройстве";
  $("logoutBtn").classList.toggle("hidden", !currentUser); $("deleteAccountBtn").classList.toggle("hidden", !currentUser);
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

  $("addTxTop").onclick = () => openExpenseModal("expense"); $("expenseSave").onclick = saveExpense;
  document.querySelectorAll("[data-tx-type]").forEach(b => b.onclick = () => openExpenseModal(b.dataset.txType));
  document.querySelectorAll("#txTypeSeg button").forEach(b => b.onclick = () => setTxType(b.dataset.type));
  document.querySelectorAll("#txFilter button").forEach(b => b.onclick = () => { txFilter = b.dataset.filter; txLimit = 12; document.querySelectorAll("#txFilter button").forEach(x => { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-selected", on); }); renderTransactions(); });
  $("txMoreBtn").onclick = () => { txLimit += 20; renderTransactions(); };
  $("qaGoalDeposit").onclick = quickGoalDeposit;
  $("addAccountBtn").onclick = () => openAccountModal(); $("accountSave").onclick = saveAccount; $("accountDelete").onclick = deleteAccount;
  $("limitsBtn").onclick = openLimitsModal; $("limitsSave").onclick = saveLimits; $("addCategoryBtn").onclick = addCategory;
  $("newCategoryName").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } });
  $("addRecurringBtn").onclick = () => openRecurringModal(); $("recurringSave").onclick = saveRecurring; $("recurringDelete").onclick = deleteRecurring;
  $("addDebtBtn").onclick = () => openDebtModal(); $("debtSave").onclick = saveDebt; $("debtDelete").onclick = deleteDebt;
  document.querySelectorAll("#debtDirSeg button").forEach(b => b.onclick = () => setDebtDir(b.dataset.dir));
  $("paydaySetupBtn").onclick = openPaydayModal; $("paydaySave").onclick = savePayday;
  $("addGoalBtn").onclick = openGoalModal; $("goalSave").onclick = saveGoal;
  $("oauthApple").onclick = () => oauthSignIn("apple"); $("oauthGoogle").onclick = () => oauthSignIn("google");
  $("deleteAccountBtn").onclick = deleteOwnAccount;
  $("addTemplateBtn").onclick = openTemplateModal; $("templateSave").onclick = saveTemplate;

  $("telegramBotBtn").onclick = openTelegramModal; $("telegramGenerateBtn").onclick = generateTelegramCode;
  $("telegramHelpBtn").onclick = () => window.open("https://github.com/Andrey1904-dev/my-pay/blob/main/telegram_bot_setup.md", "_blank", "noopener");
  $("enableNotificationsBtn").onclick = enableNotifications; $("enableNotificationsMenu").onclick = enableNotifications;

  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if ((state.extra.theme || "system") === "system") applyTheme(); });
  setInterval(() => { updateNextShiftCard(); if (!homeDirty) updateHome(); }, 60000);
}

/* ---------- Старт ---------- */
function init() {
  $("appVersion").textContent = "V" + APP_VERSION;
  $("brandVersion").textContent = "V" + APP_VERSION;
  state.shifts = Object.fromEntries(Object.entries(state.shifts).map(([k, s]) => [k, correctLegacyShift(s)]));
  save();
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
  normalizeSettings, normalizeExtra, correctLegacyShift, parseBackup, buildBackup, buildCsv,
  save, renderAll, updateHome, renderCalendar, renderStats, renderInsights, renderFinance,
  saveHomeShift, openShiftModal, saveModal, deleteShift, undoLastDelete, clearMonth, selectCalendarDate, shiftMonth, goToCurrentMonth,
  openSettings, saveSettings, cycleTheme, applyTheme, showScreen, showToast, confirmAction, promptNumber,
  saveExpense, deleteExpense, deleteTransaction, saveGoal, topUpGoal, deleteGoal, saveTemplate, applyTemplateToModal,
  oauthSignIn, deleteOwnAccount, openExpenseModal, setTxType, saveAccount, openAccountModal, deleteAccount, accountBalance, totalBalance, saveLimits, openLimitsModal, addCategory,
  saveRecurring, openRecurringModal, payRecurring, recurringNext, saveDebt, openDebtModal, addDebtPayment, buildInsights, paydayInfo, savePayday, goalForecast,
  loadQueue, queueCloudOp, flushCloudQueue, setAuthMode, backAuth,
  get currentUser() { return currentUser; }, get homeDirty() { return homeDirty; }, get cloudAvailable() { return !!db; }
};
