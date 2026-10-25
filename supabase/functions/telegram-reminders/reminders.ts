// Напоминания в Telegram. Функция вызывается по расписанию раз в час и для каждого
// пользователя с включёнными напоминаниями (telegram_preferences.enabled) решает, что отправить:
//  • в reminder_hour (по умолчанию 21:00 Екатеринбурга) — «завтра рабочая смена», если по графику 2/2 завтра работа;
//  • в 19:00 — «внеси чехлы» обычным числом, если сегодня рабочий день по графику, а смена ещё не внесена;
//  • в reminder_hour последнего дня месяца — итоги месяца.
// Защита: заголовок Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (его передаёт pg_net из cron-задачи).

import {
  Db,
  DEFAULT_SETTINGS,
  Telegram,
  WORK_END_MIN,
  addDays,
  dateKeyInTz,
  formatDateRu,
  integer,
  isWorkDay,
  minutesInTz,
  money,
  monthNameRu,
  monthRange,
  normalizeSettings,
  correctLegacyShift,
  plural,
  summarizeMonth,
  type FetchLike,
  type MonthSummary,
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

export type ReminderKind = "tomorrow" | "enter_cases" | "month_digest";

export interface Reminder {
  kind: ReminderKind;
  text: string;
}

export interface ReminderReport {
  hour: number;
  today: string;
  checked: number;
  sent: number;
  failed: number;
  messages: { chat_id: number; kind: ReminderKind; text: string }[];
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
  const report: ReminderReport = { hour, today, checked: 0, sent: 0, failed: 0, messages: [] };
  const endHour = Math.floor(WORK_END_MIN / 60);

  const prefs = await db.select<PrefRow>("telegram_preferences", "enabled=eq.true&select=user_id,chat_id,enabled,reminder_hour");
  for (const pref of prefs) {
    report.checked++;
    // Лишние запросы к базе не делаем: сводка месяца нужна только в часы напоминаний.
    if (hour !== endHour && hour !== pref.reminder_hour) continue;
    const settings = await loadSettings(db, pref.user_id);
    const rows = await loadMonth(db, pref.user_id, today);
    const summary = summarizeMonth(rows, today, settings);
    const shiftSavedToday = rows.some((r) => r.work_date === today);
    for (const message of pickReminders(pref, settings, today, hour, shiftSavedToday, summary)) {
      const claimed = await db.rpc<boolean>("telegram_claim_reminder", { p_user_id: pref.user_id, p_date: today, p_kind: message.kind });
      if (!claimed) continue;
      const sent = await tg.sendMessage(pref.chat_id, message.text);
      if (!sent) { report.failed++; continue; }
      await db.insert("telegram_bot_events", { user_id: pref.user_id, chat_id: pref.chat_id, direction: "out", message: message.text }).catch(() => undefined);
      report.sent++;
      report.messages.push({ chat_id: pref.chat_id, kind: message.kind, text: message.text });
    }
  }
  return report;
}

/** Чистая функция выбора напоминаний — её удобно тестировать. */
export function pickReminders(
  pref: Pick<PrefRow, "reminder_hour">,
  settings: Settings,
  today: string,
  hour: number,
  shiftSavedToday: boolean,
  summary: MonthSummary | null = null,
): Reminder[] {
  const out: Reminder[] = [];
  const endHour = Math.floor(WORK_END_MIN / 60);
  if (hour === endHour && isWorkDay(today, settings) && !shiftSavedToday) {
    out.push({
      kind: "enter_cases",
      text: [
        "⏰ Смена закончилась!",
        "Напиши, сколько чехлов упаковала сегодня. Посчитаю зарплату и оценю твои подвиги 😂",
      ].join("\n"),
    });
  }
  if (hour === pref.reminder_hour) {
    const tomorrow = addDays(today, 1);
    if (isWorkDay(tomorrow, settings)) {
      const lines = [`🔔 Завтра рабочая смена: ${formatDateRu(tomorrow)}, 08:00–19:00. Хорошего отдыха!`];
      if (summary && summary.shifts > 0 && tomorrow.slice(0, 7) === today.slice(0, 7)) {
        lines.push(`📊 В этом месяце уже ${summary.shifts} ${plural(summary.shifts, "смена", "смены", "смен")} · <b>${money(summary.total)}</b>`);
      }
      out.push({ kind: "tomorrow", text: lines.join("\n") });
    }
    if (today === monthRange(today).to && summary && summary.shifts > 0) {
      out.push({ kind: "month_digest", text: digestText(summary, today) });
    }
  }
  return out;
}

/** Совместимость: первое напоминание или null. */
export function pickReminder(
  pref: Pick<PrefRow, "reminder_hour">,
  settings: Settings,
  today: string,
  hour: number,
  shiftSavedToday: boolean,
  summary: MonthSummary | null = null,
): Reminder | null {
  return pickReminders(pref, settings, today, hour, shiftSavedToday, summary)[0] ?? null;
}

export function digestText(s: MonthSummary, today: string): string {
  const lines = [
    `🏁 <b>Итоги месяца — ${monthNameRu(today)}</b>`,
    "",
    `💰 <b>${money(s.total)}</b> за ${s.shifts} ${plural(s.shifts, "смену", "смены", "смен")} · ${integer(s.cases)} ${plural(s.cases, "чехол", "чехла", "чехлов")}`,
    `📈 Средняя смена: ${money(s.avg)}`,
  ];
  if (s.best) lines.push(`🏆 Лучшая: ${money(s.best.total_pay)} (${formatDateRu(s.best.work_date, { day: "numeric", month: "long" })})`);
  lines.push("", "Завтра начинается новый месяц — удачи! 💪");
  return lines.join("\n");
}

async function loadSettings(db: Db, userId: string): Promise<Settings> {
  const row = await db
    .one<Partial<Settings>>("settings", `user_id=eq.${userId}&select=base_pay,holiday_pay,case_price,piece_percent,schedule_start`)
;
  return normalizeSettings(row ?? DEFAULT_SETTINGS);
}

async function loadMonth(db: Db, userId: string, key: string): Promise<ShiftRow[]> {
  const { from, to } = monthRange(key);
  return db.select<ShiftRow>("shifts", `user_id=eq.${userId}&work_date=gte.${from}&work_date=lte.${to}&order=work_date.asc&select=*`).then(rows => rows.map(correctLegacyShift));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
