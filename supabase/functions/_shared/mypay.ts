// Общая логика CASE.PLACE SALARY для Edge Functions (Deno) и тестов (Node 22 со стрипом типов).
// Здесь нет ничего платформенного: только модель зарплаты, график 2/2, форматирование,
// тонкий клиент PostgREST и клиент Telegram Bot API с внедряемым fetch.

export const TZ = "Asia/Yekaterinburg";
export const WORK_START_MIN = 8 * 60; // 08:00
export const WORK_END_MIN = 19 * 60; // 19:00
export const MAX_CASES = 20000;

export interface Settings {
  base_pay: number;
  holiday_pay: number;
  case_price: number;
  piece_percent: number;
  schedule_start: string | null;
  monthly_goal: number;
}

export const DEFAULT_SETTINGS: Settings = {
  base_pay: 2415,
  holiday_pay: 4600,
  case_price: 7,
  piece_percent: 25,
  schedule_start: null,
  monthly_goal: 60000,
};

export interface ShiftRow {
  user_id: string;
  work_date: string;
  cases: number;
  is_holiday: boolean;
  base_pay: number;
  piece_pay: number;
  total_pay: number;
}

// ---------- числа и деньги ----------

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function money(n: number): string {
  const v = round2(num(n));
  const f = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
  return `${f}\u00a0₽`; // неразрывный пробел: «₽» не уезжает на новую строку
}

export function integer(n: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(num(n)));
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Короткая сумма для тесных мест: 4 486,84 ₽ → «4,5к ₽». */
export function moneyShort(n: number): string {
  const v = num(n);
  if (Math.abs(v) >= 1000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(v / 1000)}к\u00a0₽`;
  return money(v);
}

/** Текстовый прогресс-бар: ▰▰▰▱▱▱▱▱▱▱ */
export function bar(fraction: number, width = 10): string {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const filled = Math.round(f * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export const APP_URL = "https://andrey1904-dev.github.io/my-pay/";

// ---------- модель зарплаты ----------

export function normalizeSettings(raw: Partial<Record<keyof Settings, unknown>> | null | undefined): Settings {
  const s = raw || {};
  const pick = (k: keyof Settings, min: number) => {
    const v = num(s[k], NaN);
    return Number.isFinite(v) && v >= min ? v : (DEFAULT_SETTINGS[k] as number);
  };
  const schedule = typeof s.schedule_start === "string" && isDateKey(s.schedule_start) ? s.schedule_start : null;
  const corrected = num(s.base_pay) === 2415 && num(s.case_price) === 8.05 && num(s.piece_percent) === 25;
  return {
    base_pay: pick("base_pay", 0),
    holiday_pay: corrected && num(s.holiday_pay) === 4050 ? 4600 : pick("holiday_pay", 0),
    case_price: corrected ? 7 : pick("case_price", 0),
    piece_percent: pick("piece_percent", 0),
    schedule_start: schedule,
    monthly_goal: pick("monthly_goal", 0),
  };
}

/** Narrow correction of the old standard tariff; preserve bonuses and custom rates. */
export function correctLegacyShift(s: ShiftRow): ShiftRow {
  const oldBase = s.is_holiday ? 4050 : 2415;
  if (s.cases < 0 || num(s.base_pay) !== oldBase || Math.abs(num(s.piece_pay) - s.cases * 2.0125) > .0051) return s;
  const bonus = num(s.total_pay) - num(s.base_pay) - num(s.piece_pay);
  if (bonus < -.011) return s;
  const base = s.is_holiday ? 4600 : 2415, piece = piecePay(s.cases, DEFAULT_SETTINGS);
  return { ...s, base_pay: base, piece_pay: piece, total_pay: round2(base + piece + Math.max(0, round2(bonus))) };
}

export function piecePay(cases: number, s: Settings): number {
  return round2(Math.max(0, num(cases)) * s.case_price * s.piece_percent / 100);
}

export function basePay(isHoliday: boolean, s: Settings): number {
  return round2(isHoliday ? s.holiday_pay : s.base_pay);
}

export function totalPay(cases: number, isHoliday: boolean, s: Settings): number {
  return round2(basePay(isHoliday, s) + piecePay(cases, s));
}

export function buildShift(userId: string, workDate: string, cases: number, isHoliday: boolean, s: Settings): ShiftRow {
  const c = Math.max(0, Math.min(MAX_CASES, Math.round(num(cases))));
  return {
    user_id: userId,
    work_date: workDate,
    cases: c,
    is_holiday: !!isHoliday,
    base_pay: basePay(isHoliday, s),
    piece_pay: piecePay(c, s),
    total_pay: totalPay(c, isHoliday, s),
  };
}

// ---------- даты в часовом поясе цеха ----------

export function isDateKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** YYYY-MM-DD для момента `now` в зоне TZ. */
export function dateKeyInTz(now: Date, tz = TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Минуты с начала суток для момента `now` в зоне TZ. */
export function minutesInTz(now: Date, tz = TZ): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || "0", 10);
  return get("hour") * 60 + get("minute");
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function monthRange(key: string): { from: string; to: string; daysInMonth: number } {
  const [y, m] = key.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key.slice(0, 7)}-01`, to: `${key.slice(0, 7)}-${String(daysInMonth).padStart(2, "0")}`, daysInMonth };
}

/** График 2/2: два рабочих дня, два выходных, отсчёт от schedule_start. */
export function isWorkDay(key: string, s: Settings): boolean | null {
  if (!s.schedule_start) return null;
  const diff = daysBetween(s.schedule_start, key);
  const idx = ((diff % 4) + 4) % 4;
  return idx === 0 || idx === 1;
}

export function formatDateRu(key: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  const [y, m, d] = key.split("-").map(Number);
  const text = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", ...opts }).format(new Date(Date.UTC(y, m - 1, d)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function monthNameRu(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const text = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1))).replace(" г.", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Текст «до конца смены …» для текущего момента. */
export function shiftTimeText(minutes: number): string {
  if (minutes < WORK_START_MIN) {
    const left = WORK_START_MIN - minutes;
    return `⏱ Смена начнётся через ${hoursMinutes(left)} (в 08:00)`;
  }
  if (minutes >= WORK_END_MIN) return "🏁 Смена завершена — отличная работа";
  const left = WORK_END_MIN - minutes;
  return `⏱ До конца смены ${hoursMinutes(left)} (до 19:00)`;
}

export function hoursMinutes(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

export function motivation(casesToday: number): string {
  if (casesToday <= 0) return "Начнём? Первые сто — самые важные 💪";
  if (casesToday < 300) return "Разгон пошёл — держи ритм 💪";
  if (casesToday < 800) return "Хороший темп, продолжай 👍";
  if (casesToday < 1200) return "Уверенная смена 🔥";
  if (casesToday < 1800) return "Мощно! Это выше среднего 🚀";
  return "Ударная смена — так держать ⚡";
}

// ---------- прогноз месяца ----------

export interface MonthSummary {
  shifts: number;
  cases: number;
  total: number;
  avg: number;
  best: ShiftRow | null;
  forecast: number | null;
  remainingWorkDays: number;
  goalPercent: number;
}

export function summarizeMonth(rows: ShiftRow[], todayKey: string, s: Settings): MonthSummary {
  const shifts = rows.length;
  const cases = rows.reduce((a, r) => a + num(r.cases), 0);
  const total = round2(rows.reduce((a, r) => a + num(r.total_pay), 0));
  const avg = shifts ? round2(total / shifts) : 0;
  const best = rows.reduce<ShiftRow | null>((b, r) => (!b || num(r.total_pay) > num(b.total_pay) ? r : b), null);
  const { to } = monthRange(todayKey);
  let remainingWorkDays = 0;
  const saved = new Set(rows.map((r) => r.work_date));
  for (let k = addDays(todayKey, 1); k <= to; k = addDays(k, 1)) {
    const w = isWorkDay(k, s);
    if (w === null ? false : w) remainingWorkDays++;
  }
  if (!saved.has(todayKey) && isWorkDay(todayKey, s)) remainingWorkDays++;
  const forecast = shifts ? round2(total + remainingWorkDays * avg) : null;
  const goalPercent = s.monthly_goal > 0 ? Math.round(total / s.monthly_goal * 100) : 0;
  return { shifts, cases, total, avg, best, forecast, remainingWorkDays, goalPercent };
}

// ---------- разбор ввода ----------

export type ParsedInput =
  | { kind: "add"; cases: number; date: string | null }
  | { kind: "set"; cases: number; date: string | null }
  | { kind: "expense"; amount: number; note: string }
  | { kind: "income"; amount: number; note: string }
  | { kind: "command"; name: string; arg: string }
  | { kind: "unknown" };

const BUTTON_COMMANDS: Record<string, string> = {
  "сегодня": "today",
  "месяц": "month",
  "прогноз": "forecast",
  "календарь": "calendar",
  "расходы": "spent",
  "расход": "spent",
  "финансы": "spent",
  "отменить": "undo",
  "помощь": "help",
  "меню": "menu",
  "еще": "settings",
  "настройки": "settings",
  "последняя": "last",
  "праздник": "holiday",
};

const EXPENSE_WORDS = /^(расход|расходы|трата|потратил[а-я]*|купил[а-я]*|минус|заплатил[а-я]*|оплатил[а-я]*)$/;
const INCOME_WORDS = /^(доход|получил[а-я]*|пришло|пришли|зарплата|зп|аванс|премия|плюс)$/;
const NOTE_STOP = /^(на|за|в|по|у|с|со|для|и|руб|рублей|р|₽)$/;

/** Дата из слова: «вчера», «позавчера», «27.09», «27.09.2026». */
function parseDateToken(token: string, today: string): string | null {
  if (token === "вчера") return addDays(today, -1);
  if (token === "позавчера") return addDays(today, -2);
  const m = token.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  let y = m[3] ? parseInt(m[3], 10) : parseInt(today.slice(0, 4), 10);
  if (m[3] && m[3].length === 2) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCDate() !== d) return null;
  return key;
}

export function parseInput(textRaw: string, today: string = dateKeyInTz(new Date())): ParsedInput {
  const text = String(textRaw || "").trim();
  if (!text) return { kind: "unknown" };
  if (text.startsWith("/")) {
    const m = text.match(/^\/([a-zA-Z_]+)(?:@\w+)?\s*(.*)$/s);
    if (!m) return { kind: "unknown" };
    return { kind: "command", name: m[1].toLowerCase(), arg: m[2].trim() };
  }
  const lower = text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  // Кнопки клавиатуры могут начинаться с эмодзи: «📦 Сегодня».
  const button = lower.replace(/^[^a-zа-я0-9+\-\/]+/u, "").trim();
  if (BUTTON_COMMANDS[button]) return { kind: "command", name: BUTTON_COMMANDS[button], arg: "" };

  // \b в JS не понимает кириллицу, поэтому чистим по токенам: «чехлы 350», «упаковал 1200 чехлов», «350 плюс 500».
  const NOISE = /^(чехл[а-я]*|шт[а-я]*|упаковал[а-я]*|сделал[а-я]*|итого|сегодня|за)$/;
  const tokens = lower
    .replace(/(\d)\s*(чехл[а-я]*|шт[а-я]*)/g, "$1 ")
    .replace(/\s*плюс\s*/g, " + ")
    .replace(/(\d)\s*\+\s*(\d)/g, "$1+$2")
    .replace(/^\+\s+/, "+")
    .split(" ")
    .filter((w) => w && !NOISE.test(w));

  // Дата смены: «вчера 900», «27.09 900», «900 за вчера».
  let date: string | null = null;
  const rest: string[] = [];
  for (const t of tokens) {
    const parsedDate: string | null = date === null ? parseDateToken(t, today) : null;
    if (parsedDate) date = parsedDate;
    else rest.push(t);
  }

  const cleaned = rest.join(" ").trim();
  const add = cleaned.startsWith("+");
  const body = add ? cleaned.slice(1).trim() : cleaned;
  if (/^\d+(?:\s*\+\s*\d+)*$/.test(body)) {
    const cases = body.split("+").reduce((a, p) => a + parseInt(p.trim(), 10), 0);
    if (!Number.isFinite(cases) || cases <= 0 || cases > MAX_CASES) return { kind: "unknown" };
    return add ? { kind: "add", cases, date } : { kind: "set", cases, date };
  }
  if (date) return { kind: "unknown" };

  // Расход или доход: «350 обед», «-350 такси», «потратил 1200 на продукты», «доход 5000 премия».
  const words = cleaned.split(" ").filter(Boolean);
  let mode: "expense" | "income" | null = null;
  let explicit = false; // слово-маркер («расход», «доход») — тогда заметка не обязательна
  let amount: number | null = null;
  const note: string[] = [];
  for (const w of words) {
    const m = w.match(/^([+\-−]?)(\d+(?:[.,]\d{1,2})?)$/);
    if (m && amount === null) {
      amount = parseFloat(m[2].replace(",", "."));
      if (m[1] === "-" || m[1] === "−") mode = mode ?? "expense";
      if (m[1] === "+") mode = mode ?? "income";
      continue;
    }
    if (EXPENSE_WORDS.test(w)) { mode = mode ?? "expense"; explicit = true; continue; }
    if (INCOME_WORDS.test(w)) { mode = mode ?? "income"; explicit = true; if (/^(зарплата|зп|аванс|премия)$/.test(w)) note.push(w); continue; }
    if (NOTE_STOP.test(w)) continue;
    if (/^[+\-−]?\d/.test(w)) return { kind: "unknown" }; // второе число — непонятно, что имелось в виду
    note.push(w);
  }
  if (amount === null || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return { kind: "unknown" };
  if (!note.length && !explicit) return { kind: "unknown" }; // «-100» без пояснения — скорее опечатка, чем расход
  const noteText = note.join(" ");
  return { kind: mode ?? "expense", amount: Math.round(amount * 100) / 100, note: noteText.charAt(0).toUpperCase() + noteText.slice(1) };
}

// ---------- финансы (общий JSON с сайтом: user_app_data.payload) ----------

export interface TxRow {
  id: string;
  type: "expense" | "income" | "transfer";
  amount: number;
  category: string;
  accountId: string | null;
  toAccountId: string | null;
  date: string;
  note: string;
  source?: string;
}
export interface CategoryRow { id: string; name: string; emoji: string; limit: number }
export interface AccountRow { id: string; name: string; type: string; balance: number }
export interface ExtraPayload {
  transactions?: TxRow[];
  categories?: CategoryRow[];
  accounts?: AccountRow[];
  [key: string]: unknown;
}

export const DEFAULT_CATEGORIES: CategoryRow[] = [
  { id: "food", name: "Еда", emoji: "🍔", limit: 0 }, { id: "transport", name: "Транспорт", emoji: "🚌", limit: 0 }, { id: "home", name: "Жильё", emoji: "🏠", limit: 0 },
  { id: "shopping", name: "Покупки", emoji: "🛍️", limit: 0 }, { id: "health", name: "Здоровье", emoji: "💊", limit: 0 }, { id: "fun", name: "Развлечения", emoji: "🎮", limit: 0 },
  { id: "connect", name: "Связь", emoji: "📱", limit: 0 }, { id: "family", name: "Семья", emoji: "👨‍👩‍👧", limit: 0 }, { id: "other", name: "Другое", emoji: "📦", limit: 0 },
];

const CATEGORY_HINTS: [RegExp, string][] = [
  [/электричк|такси|автобус|метро|трамва|троллейбус|маршрутк|бензин|заправк|проезд|парковк|каршер|поезд|самокат|транспорт/, "Транспорт"],
  [/аренд|квартир|жкх|коммунал|ипотек|ремонт|свет|электрич|газ|вода|квартплат|жиль/, "Жильё"],
  [/аптек|лекарств|врач|стоматолог|зуб|больниц|клиник|таблетк|витамин|анализ|здоров/, "Здоровье"],
  [/кино|игр|бар|пиво|концерт|подписк|стим|steam|netflix|боулинг|клуб|развлеч|кальян|бильярд|театр/, "Развлечения"],
  [/связь|телефон|интернет|мтс|билайн|мегафон|теле2|tele2|сим|тариф|мобил/, "Связь"],
  [/сем[ья]|дет[иея]|ребен|ребён|жен[аеу]|муж|мам[аеу]|пап[аеу]|школ|садик|детск/, "Семья"],
  [/обед|еда|завтрак|ужин|кофе|кафе|столов|перекус|продукт|шаурм|пицц|бургер|доставк|ресторан|чай|хлеб|молок|пятероч|магнит|лент[аеу]|ашан|вкусвилл|перекрест|суши|шашлык|фастфуд|макдон|кфс|kfc|вода|сок|булоч|выпечк/, "Еда"],
  [/одежд|обув|магазин|покупк|озон|ozon|wildberries|вайлдберр|wb|подар|техник|мебел|косметик|маркетплейс|заказ/, "Покупки"],
];

/** Категория по тексту заметки: сначала точное имя категории, потом словарь подсказок. */
export function guessCategory(note: string, categories: CategoryRow[] = DEFAULT_CATEGORIES): CategoryRow {
  const lower = String(note || "").toLowerCase().replace(/ё/g, "е").trim();
  const byName = categories.find((c) => c.name.toLowerCase().replace(/ё/g, "е") === lower);
  if (byName) return byName;
  for (const [re, name] of CATEGORY_HINTS) {
    if (re.test(lower)) {
      const hit = categories.find((c) => c.name === name) || DEFAULT_CATEGORIES.find((c) => c.name === name);
      if (hit) return hit;
    }
  }
  return categories.find((c) => c.name === "Другое") || categories[categories.length - 1] || DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
}

export function payloadCategories(payload: ExtraPayload | null | undefined): CategoryRow[] {
  const list = Array.isArray(payload?.categories) ? payload!.categories!.filter((c) => c && typeof c.name === "string" && c.name) : [];
  return list.length ? list.map((c) => ({ id: String(c.id ?? c.name), name: c.name, emoji: c.emoji || "🏷️", limit: num(c.limit) })) : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

export function payloadTransactions(payload: ExtraPayload | null | undefined): TxRow[] {
  return Array.isArray(payload?.transactions) ? payload!.transactions!.filter((t) => t && typeof t === "object" && t.id) : [];
}

export function payloadAccounts(payload: ExtraPayload | null | undefined): AccountRow[] {
  return Array.isArray(payload?.accounts) ? payload!.accounts!.filter((a) => a && a.id) : [];
}

/** Счёт для операции из бота: по имени в заметке, иначе наличные, иначе первый. */
export function pickAccount(accounts: AccountRow[], note: string): { account: AccountRow | null; note: string } {
  if (!accounts.length) return { account: null, note };
  const words = note.split(" ");
  const last = (words[words.length - 1] || "").toLowerCase().replace(/ё/g, "е");
  const named = last ? accounts.find((a) => a.name.toLowerCase().replace(/ё/g, "е").startsWith(last) && last.length >= 3) : undefined;
  if (named) return { account: named, note: words.slice(0, -1).join(" ") };
  return { account: accounts.find((a) => a.type === "cash") || accounts[0], note };
}

export function monthTransactions(payload: ExtraPayload | null | undefined, monthPrefix: string, type: TxRow["type"]): TxRow[] {
  return payloadTransactions(payload).filter((t) => t.type === type && typeof t.date === "string" && t.date.startsWith(monthPrefix));
}

export function sumAmount(rows: { amount: unknown }[]): number {
  return round2(rows.reduce((a, r) => a + Math.max(0, num(r.amount)), 0));
}

export function newTxId(now: Date): string {
  return `tg_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- календарь ----------

const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Моноширинная сетка месяца: ▪ смена внесена, · рабочий день по графику, ▸ сегодня. Ячейка — 4 символа. */
export function calendarGrid(monthKey: string, saved: Set<string>, settings: Settings, today: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Пн = 0
  const cells: string[] = [];
  for (let i = 0; i < firstDow; i++) cells.push("    ");
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${monthKey}-${String(d).padStart(2, "0")}`;
    const dd = String(d).padStart(2, " ");
    const mark = saved.has(key) ? "▪" : isWorkDay(key, settings) ? "·" : " ";
    cells.push(`${key === today ? "▸" : " "}${dd}${mark}`);
  }
  while (cells.length % 7) cells.push("    ");
  const lines = [WEEKDAYS_RU.map((w) => ` ${w} `).join("")];
  for (let i = 0; i < cells.length; i += 7) lines.push(cells.slice(i, i + 7).join("").replace(/\s+$/, ""));
  return lines.join("\n");
}

export function monthKeyOf(key: string): string {
  return key.slice(0, 7);
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c] as string));
}

// ---------- PostgREST ----------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class DbError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class Db {
  private url: string;
  private key: string;
  private fetchImpl: FetchLike;

  constructor(url: string, key: string, fetchImpl: FetchLike) {
    this.url = url.replace(/\/$/, "");
    this.key = key;
    this.fetchImpl = fetchImpl;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extra,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.url}/rest/v1/${path}`, {
      method,
      headers: this.headers(extra),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DbError(`PostgREST ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  select<T>(table: string, query: string): Promise<T[]> {
    return this.request<T[]>("GET", `${table}?${query}`);
  }

  async one<T>(table: string, query: string): Promise<T | null> {
    const rows = await this.select<T>(table, `${query}&limit=1`);
    return rows[0] ?? null;
  }

  insert<T>(table: string, row: unknown): Promise<T[]> {
    return this.request<T[]>("POST", table, row, { Prefer: "return=representation" });
  }

  upsert<T>(table: string, row: unknown, onConflict: string): Promise<T[]> {
    return this.request<T[]>("POST", `${table}?on_conflict=${encodeURIComponent(onConflict)}`, row, {
      Prefer: "resolution=merge-duplicates,return=representation",
    });
  }

  update<T>(table: string, query: string, patch: unknown): Promise<T[]> {
    return this.request<T[]>("PATCH", `${table}?${query}`, patch, { Prefer: "return=representation" });
  }

  remove<T>(table: string, query: string): Promise<T[]> {
    return this.request<T[]>("DELETE", `${table}?${query}`, undefined, { Prefer: "return=representation" });
  }
}

// ---------- Telegram Bot API ----------

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number; username?: string; first_name?: string };
    message?: TelegramMessage;
  };
}

export class Telegram {
  private token: string;
  private fetchImpl: FetchLike;
  constructor(token: string, fetchImpl: FetchLike) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async call<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; result?: T } | null;
      return data && data.ok ? (data.result as T) : null;
    } catch {
      return null;
    }
  }

  sendMessage(chatId: number, text: string, replyMarkup?: unknown) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  /** Список команд в меню Telegram (кнопка «/» слева от поля ввода). */
  setMyCommands(commands: { command: string; description: string }[]) {
    return this.call("setMyCommands", { commands });
  }

  answerCallbackQuery(id: string, text?: string) {
    return this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }
}

export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "+100" }, { text: "+500" }, { text: "+1000" }],
    [{ text: "📦 Сегодня" }, { text: "📊 Месяц" }, { text: "🔮 Прогноз" }],
    [{ text: "📅 Календарь" }, { text: "💸 Расходы" }, { text: "⚙️ Ещё" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "350 — чехлы · +500 — добавить · 350 обед — расход",
};

export const BOT_COMMANDS = [
  { command: "today", description: "📦 Смена за сегодня" },
  { command: "month", description: "📊 Итоги месяца" },
  { command: "forecast", description: "🔮 Прогноз до конца месяца" },
  { command: "calendar", description: "📅 Календарь смен" },
  { command: "spent", description: "💸 Расходы за месяц" },
  { command: "undo", description: "↩️ Отменить последнее добавление" },
  { command: "holiday", description: "🎉 Праздничная ставка на сегодня" },
  { command: "settings", description: "⚙️ Настройки и напоминания" },
  { command: "help", description: "❓ Как пользоваться" },
];
