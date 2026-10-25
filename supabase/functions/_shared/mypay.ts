import { PAY, fixedPart } from "./pay.ts";
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
}

export const DEFAULT_SETTINGS: Settings = {
  base_pay: fixedPart(),
  holiday_pay: fixedPart(true),
  case_price: PAY.caseRate,
  piece_percent: PAY.casePercent,
  schedule_start: null,
};

export interface ShiftRow {
  user_id: string;
  work_date: string;
  cases: number;
  is_holiday: boolean;
  base_pay: number;
  piece_pay: number;
  total_pay: number;
  updated_at?: string;
  piece_rate?: number | null;
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

/** Текстовый прогресс-бар: ▰▰▰▱▱▱▱▱▱▱ */
export function bar(fraction: number, width = 10): string {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const filled = Math.round(f * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export const APP_URL = "https://andrey1904-dev.github.io/my-pay/app.html";

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
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const date = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
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
  return { shifts, cases, total, avg, best, forecast, remainingWorkDays };
}

// ---------- разбор ввода ----------

export type ParsedInput =
  | { kind: "set"; cases: number; date: string | null }
  | { kind: "command"; name: string; arg: string }
  | { kind: "unknown" };

const BUTTON_COMMANDS: Record<string, string> = {
  "сегодня": "today",
  "месяц": "month",
  "прогноз": "forecast",
  "календарь": "calendar",
  "расходы": "spent",
  "отменить": "undo",
  "помощь": "help",
  "меню": "menu",
  "еще": "settings",
  "настройки": "settings",
  "последняя": "last",
  "праздник": "holiday",
};

export function parseInput(textRaw: string, _today?: string): ParsedInput {
  const text = String(textRaw || "").trim();
  if (!text) return { kind: "unknown" };
  if (text.startsWith("/")) {
    const m = text.match(/^\/([a-zA-Z_][a-zA-Z0-9_]*)(?:@\w+)?\s*(.*)$/s);
    if (!m) return { kind: "unknown" };
    return { kind: "command", name: m[1].toLowerCase(), arg: m[2].trim() };
  }
  const lower = text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  // Кнопки клавиатуры могут начинаться с эмодзи: «📦 Сегодня».
  const button = lower.replace(/^[^a-zа-я0-9+\-\/]+/u, "").trim();
  if (BUTTON_COMMANDS[button]) return { kind: "command", name: BUTTON_COMMANDS[button], arg: "" };

  // Only a whole daily total. Spaces are accepted only as thousands separators.
  if (!/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)$/.test(text)) return { kind: "unknown" };
  const cases = Number(text.replace(/[ \u00a0\u202f]/g, ""));
  if (!Number.isSafeInteger(cases) || cases < 0 || cases > MAX_CASES) return { kind: "unknown" };
  return { kind: "set", cases, date: null };
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

  rpc<T>(name: string, args: unknown): Promise<T> {
    return this.request<T>("POST", `rpc/${name}`, args);
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

  sendMessage(chatId: number, text: string, replyMarkup: unknown = MAIN_KEYBOARD) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  }

  editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
    return this.call("editMessageText", {
      chat_id: chatId, message_id: messageId, text, parse_mode: "HTML",
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

// The only persistent keyboard. Contextual inline controls never replace it.
export const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "📦 Сегодня" }, { text: "📊 Месяц" }, { text: "🔮 Прогноз" }],
    [{ text: "📅 Календарь" }, { text: "💸 Расходы" }, { text: "⚙️ Ещё" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
  is_persistent: true,
};

export const BOT_COMMANDS = [
  { command: "today", description: "📦 Смена за сегодня" },
  { command: "month", description: "📊 Итоги месяца" },
  { command: "forecast", description: "🔮 Прогноз до конца месяца" },
  { command: "calendar", description: "📅 Календарь смен" },
  { command: "spent", description: "💸 Расходы за месяц" },
  { command: "expense", description: "Добавить расход: /expense 350 обед" },
  { command: "income", description: "Добавить доход: /income 1000 подарок" },
  { command: "delete_expense", description: "Удалить операцию по её ID" },
  { command: "undo", description: "Как исправить итог смены" },
  { command: "holiday", description: "Где изменить праздничную ставку" },
  { command: "settings", description: "⚙️ Настройки и напоминания" },
  { command: "help", description: "❓ Как пользоваться" },
];
