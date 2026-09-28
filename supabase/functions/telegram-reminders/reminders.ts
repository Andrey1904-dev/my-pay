// Напоминания в Telegram. Функция вызывается по расписанию раз в час и для каждого
// пользователя с включёнными напоминаниями (telegram_preferences.enabled) решает, что отправить:
//  • в reminder_hour (по умолчанию 21:00 Екатеринбурга) — «завтра рабочая смена», если по графику 2/2 завтра работа;
//  • в 19:00 — «внеси чехлы», если сегодня рабочий день по графику, а смена ещё не внесена.
// Защита: заголовок Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (его передаёт pg_net из cron-задачи).

import {
  Db,
  DEFAULT_SETTINGS,
  Telegram,
  WORK_END_MIN,
  addDays,
  dateKeyInTz,
  formatDateRu,
  isWorkDay,
  minutesInTz,
  normalizeSettings,
  type FetchLike,
  type Settings,
  type ShiftRow,
} from "../_shared/mypay.ts";

export interface ReminderDeps {
  env: (key: string) => string | undefined;
  fetch: FetchLike;
  now?: () => Date;
}

interface PrefRow {
  user_id: string;
  chat_id: number;
  enabled: boolean;
  reminder_hour: number;
}

export interface ReminderReport {
  hour: number;
  today: string;
  checked: number;
  sent: number;
  messages: { chat_id: number; kind: "tomorrow" | "enter_cases"; text: string }[];
}

export function createRemindersHandler(deps: ReminderDeps) {
  const now = deps.now || (() => new Date());

  return async (req: Request): Promise<Response> => {
    const url = deps.env("SUPABASE_URL");
    const key = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    const token = deps.env("TELEGRAM_BOT_TOKEN");
    if (!url || !key || !token) return json({ ok: false, error: "missing env" }, 500);

    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${key}`) return json({ ok: false, error: "forbidden" }, 401);

    const db = new Db(url, key, deps.fetch);
    const tg = new Telegram(token, deps.fetch);
    const report = await runReminders(db, tg, now());
    return json({ ok: true, ...report });
  };
}

export async function runReminders(db: Db, tg: Telegram, now: Date): Promise<ReminderReport> {
  const today = dateKeyInTz(now);
  const hour = Math.floor(minutesInTz(now) / 60);
  const report: ReminderReport = { hour, today, checked: 0, sent: 0, messages: [] };

  const prefs = await db.select<PrefRow>("telegram_preferences", "enabled=eq.true&select=user_id,chat_id,enabled,reminder_hour");
  for (const pref of prefs) {
    report.checked++;
    const settings = await loadSettings(db, pref.user_id);
    const message = pickReminder(pref, settings, today, hour, await hasShift(db, pref.user_id, today));
    if (!message) continue;
    await tg.sendMessage(pref.chat_id, message.text);
    await db.insert("telegram_bot_events", { user_id: pref.user_id, chat_id: pref.chat_id, direction: "out", message: message.text }).catch(() => undefined);
    report.sent++;
    report.messages.push({ chat_id: pref.chat_id, ...message });
  }
  return report;
}

/** Чистая функция выбора напоминания — её удобно тестировать. */
export function pickReminder(
  pref: Pick<PrefRow, "reminder_hour">,
  settings: Settings,
  today: string,
  hour: number,
  shiftSavedToday: boolean,
): { kind: "tomorrow" | "enter_cases"; text: string } | null {
  const endHour = Math.floor(WORK_END_MIN / 60);
  if (hour === endHour && isWorkDay(today, settings) && !shiftSavedToday) {
    return {
      kind: "enter_cases",
      text: `📦 Смена закончилась — сколько чехлов сегодня? Напиши число, и я посчитаю заработок за ${formatDateRu(today, { day: "numeric", month: "long" })}.`,
    };
  }
  if (hour === pref.reminder_hour) {
    const tomorrow = addDays(today, 1);
    if (isWorkDay(tomorrow, settings)) {
      return {
        kind: "tomorrow",
        text: `🔔 Завтра рабочая смена: ${formatDateRu(tomorrow)}, начало в 08:00. Хорошего отдыха!`,
      };
    }
  }
  return null;
}

async function loadSettings(db: Db, userId: string): Promise<Settings> {
  const row = await db
    .one<Partial<Settings>>("settings", `user_id=eq.${userId}&select=base_pay,holiday_pay,case_price,piece_percent,schedule_start,monthly_goal`)
    .catch(() => null);
  return normalizeSettings(row ?? DEFAULT_SETTINGS);
}

async function hasShift(db: Db, userId: string, key: string): Promise<boolean> {
  const row = await db.one<Pick<ShiftRow, "work_date">>("shifts", `user_id=eq.${userId}&work_date=eq.${key}&select=work_date`).catch(() => null);
  return !!row;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
