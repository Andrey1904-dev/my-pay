// Обработчик вебхука Telegram-бота CASE.PLACE SALARY.
// Вся логика вынесена в createBotHandler, чтобы её можно было тестировать без Deno:
// окружение, fetch и «сейчас» передаются снаружи.
//
import { selectJoke } from "../_shared/telegram-jokes.ts";

import {
  APP_URL,
  BOT_COMMANDS,
  Db,
  DEFAULT_SETTINGS,
  Telegram,
  WORK_END_MIN,
  WORK_START_MIN,
  addDays,
  buildShift,
  calendarGrid,
  dateKeyInTz,
  escapeHtml,
  formatDateRu,
  integer,
  isWorkDay,
  minutesInTz,
  money,
  monthKeyOf,
  monthNameRu,
  monthRange,
  motivation,
  normalizeSettings,
  correctLegacyShift,
  parseInput,
  plural,
  shiftTimeText,
  summarizeMonth,
  totalPay,
  round2,
  type FetchLike,
  type Settings,
  type ShiftRow,
  type TelegramMessage,
  type TelegramUpdate,
} from "../_shared/mypay.ts";

export interface BotDeps {
  env: (key: string) => string | undefined;
  fetch: FetchLike;
  now?: () => Date;
  /** Куда писать необработанные ошибки (по умолчанию console.error). */
  logError?: (message: string, error: unknown) => void;
}

interface LinkRow {
  user_id: string;
  chat_id: number;
  username: string | null;
  first_name: string | null;
}

interface PrefRow {
  user_id: string;
  chat_id: number;
  enabled: boolean;
  reminder_hour: number;
}

interface Card {
  text: string;
}

const REMINDER_HOURS = [19, 20, 21, 22];

export const HELP_TEXT = [
  "❓ <b>Как пользоваться</b>", "",
  "Напиши целое число от 0 до 20 000, например <code>1 250</code>.",
  "Это итог за сегодня по Екатеринбургу. Новое число заменяет прежнее, а не прибавляется.",
  "Проверь большие числа перед отправкой: значения выше 20 000 не сохраняются.", "",
  "/today — сегодня · /month — месяц · /forecast — прогноз",
  "/calendar — календарь · /last — последняя смена",
  "/settings — настройки · /notify_on и /notify_off — напоминания",
  "/unlink — отвязать аккаунт · /help — справка", "",
  `Календарь, расходы, праздничные смены и настройки: ${APP_URL}`,
].join("\n");

const LINK_HINT = [
  "👋 Привет! Это бот <b>CASE.PLACE SALARY</b>.",
  "",
  "Он записывает чехлы за смену, считает заработок — в том же аккаунте, что и приложение.",
  "",
  "Чтобы начать, привяжи аккаунт:",
  "1️⃣ Открой приложение → <b>Ещё</b> → <b>Telegram-бот</b>.",
  "2️⃣ Нажми «Получить код».",
  "3️⃣ Отправь сюда <code>/start КОД</code> или перейди по ссылке из приложения.",
].join("\n");

export function createBotHandler(deps: BotDeps) {
  const now = deps.now || (() => new Date());
  const logError = deps.logError || ((message, error) => console.error(message, error));

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ ok: true, service: "telegram-mypay" });

    const secret = deps.env("TELEGRAM_WEBHOOK_SECRET");
    if (!secret) return json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not set" }, 500);
    if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) return json({ ok: false, error: "forbidden" }, 401);

    const token = deps.env("TELEGRAM_BOT_TOKEN");
    const url = deps.env("SUPABASE_URL");
    const key = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!token || !url || !key) return json({ ok: false, error: "missing env" }, 500);

    let update: TelegramUpdate;
    try {
      update = await req.json();
    } catch {
      return json({ ok: false, error: "bad json" }, 400);
    }

    const ctx = new BotContext(new Db(url, key, deps.fetch), new Telegram(token, deps.fetch), now);
    try {
      if (update.callback_query) await ctx.handleCallback(update);
      else if (update.message) await ctx.handleMessage(update.message, update.update_id);
    } catch (err) {
      // Telegram повторяет доставку при не-2xx, поэтому логическую ошибку отвечаем 200 и сообщаем пользователю.
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      logError("telegram-mypay error", err);
      if (update.callback_query) await ctx.tg.answerCallbackQuery(update.callback_query.id, "Не получилось, попробуй ещё раз");
      if (chatId) await ctx.tg.sendMessage(chatId, "⚠️ Не получилось обработать сообщение. Попробуй ещё раз через минуту.");
    }
    return json({ ok: true });
  };
}

class BotContext {
  db: Db;
  tg: Telegram;
  now: () => Date;

  constructor(db: Db, tg: Telegram, now: () => Date) {
    this.db = db;
    this.tg = tg;
    this.now = now;
  }

  todayKey() {
    return dateKeyInTz(this.now());
  }

  minutes() {
    return minutesInTz(this.now());
  }

  // ---------- сообщения ----------

  async handleMessage(msg: TelegramMessage, updateId: number) {
    if (msg.chat.type !== "private" || msg.from?.is_bot) return;
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    if (!text) return;

    const link = await this.db.one<LinkRow>("telegram_links", `chat_id=eq.${chatId}&select=user_id,chat_id,username,first_name`);
    await this.logEvent(link?.user_id ?? null, chatId, "in", text);

    const parsed = parseInput(text, this.todayKey());

    if (parsed.kind === "command" && parsed.name === "start") {
      await this.handleStart(msg, parsed.arg, link);
      return;
    }

    if (!link) {
      await this.reply(null, chatId, LINK_HINT);
      return;
    }

    this.db.update("telegram_links", `chat_id=eq.${chatId}`, { last_seen_at: this.now().toISOString() }).catch(() => undefined);

    const settings = await this.loadSettings(link.user_id);

    switch (parsed.kind) {
      case "command":
        await this.handleCommand(link, parsed.name, settings);
        return;
      case "set":
        await this.handleCases(link, parsed.cases, settings, updateId);
        return;
      default:
        await this.reply(
          link.user_id,
          chatId,
          "🤔 Не понял. Пришли целое число от 0 до 20 000, например 1 250. Это итог за сегодня; новое число заменит прежнее. Справка: /help.",
        );
    }
  }

  async handleStart(msg: TelegramMessage, arg: string, link: LinkRow | null) {
    const chatId = msg.chat.id;
    const code = arg.trim().toUpperCase();
    this.tg.setMyCommands(BOT_COMMANDS).catch(() => undefined);
    if (!code) {
      if (link) {
        await this.reply(link.user_id, chatId, `✅ Telegram уже привязан. Пиши количество чехлов — и я всё посчитаю.\n\n${HELP_TEXT}`);
      } else {
        await this.reply(null, chatId, LINK_HINT);
      }
      return;
    }
    const nowIso = this.now().toISOString();
    const row = await this.db.one<{ code: string; user_id: string; expires_at: string }>(
      "telegram_link_codes",
      `code=eq.${encodeURIComponent(code)}&expires_at=gt.${encodeURIComponent(nowIso)}&select=code,user_id,expires_at`,
    );
    if (!row) {
      await this.reply(link?.user_id ?? null, chatId, "❌ Код не найден или уже истёк. Получи новый в приложении: «Ещё» → «Telegram-бот».");
      return;
    }
    // Один чат — один аккаунт, один аккаунт — один чат.
    await this.db.remove("telegram_pending_inputs", `chat_id=eq.${chatId}`);
    await this.db.remove("telegram_preferences", `chat_id=eq.${chatId}`);
    await this.db.remove("telegram_links", `chat_id=eq.${chatId}`);
    await this.db.remove("telegram_links", `user_id=eq.${row.user_id}`);
    await this.db.insert("telegram_links", {
      user_id: row.user_id,
      chat_id: chatId,
      username: msg.from?.username ?? null,
      first_name: msg.from?.first_name ?? null,
      linked_at: nowIso,
      last_seen_at: nowIso,
    });
    await this.db.remove("telegram_link_codes", `user_id=eq.${row.user_id}`);
    await this.db.upsert("telegram_preferences", { user_id: row.user_id, chat_id: chatId, enabled: true, updated_at: nowIso }, "user_id");
    const name = msg.from?.first_name ? `, ${escapeHtml(msg.from.first_name)}` : "";
    await this.reply(
      row.user_id,
      chatId,
      [
        `🎉 Готово${name}! Telegram привязан к аккаунту.`,
        "",
        "Теперь просто пиши итог за смену — например <code>1250</code>. Следующее число заменит предыдущее.",
        "",
        "/help — справка. Все настройки и расходы доступны в приложении.",
      ].join("\n"),
        );
  }

  async handleCommand(link: LinkRow, name: string, settings: Settings) {
    const chatId = link.chat_id;
    const today = this.todayKey();
    switch (name) {
      case "help":
        await this.reply(link.user_id, chatId, HELP_TEXT);
        return;
      case "menu":
        await this.reply(link.user_id, chatId, HELP_TEXT);
        return;
      case "settings":
        await this.sendCard(link, await this.menuCard(link, settings));
        return;
      case "today":
        await this.sendCard(link, await this.todayCard(link, settings));
        return;
      case "month":
        await this.sendCard(link, await this.monthCard(link, settings));
        return;
      case "forecast":
        await this.sendCard(link, await this.forecastCard(link, settings));
        return;
      case "calendar":
        await this.sendCard(link, await this.calendarCard(link, settings, monthKeyOf(today)));
        return;
      case "last": {
        const last = await this.db.one<ShiftRow>("shifts", `user_id=eq.${link.user_id}&order=work_date.desc&select=*`);
        if (!last) {
          await this.reply(link.user_id, chatId, "Пока нет ни одной смены. Напиши число чехлов — и она появится.");
          return;
        }
        await this.reply(
          link.user_id,
          chatId,
          [
            `🗓 <b>${formatDateRu(last.work_date)}</b>${last.is_holiday ? " · праздничная" : ""}`,
            `📦 ${integer(last.cases)} ${plural(last.cases, "чехол", "чехла", "чехлов")}`,
            `💰 <b>${money(last.total_pay)}</b> — ставка ${money(last.base_pay)} + сделка ${money(last.piece_pay)}`,
          ].join("\n"),
        );
        return;
      }
      case "undo":
      case "holiday":
        await this.reply(link.user_id, chatId, `Для исправления итога отправь новое число. Праздничную ставку можно изменить в приложении: ${APP_URL}`);
        return;
      case "notify_on":
      case "notify_off": {
        const enabled = name === "notify_on";
        await this.db.upsert("telegram_preferences", { user_id: link.user_id, chat_id: chatId, enabled, updated_at: this.now().toISOString() }, "user_id");
        await this.reply(link.user_id, chatId, enabled ? "🔔 Напоминания включены: напишу вечером перед рабочим днём и напомню внести чехлы после смены." : "🔕 Напоминания выключены.");
        return;
      }
      case "unlink":
        await this.db.remove("telegram_pending_inputs", `chat_id=eq.${chatId}`);
        await this.db.remove("telegram_preferences", `chat_id=eq.${chatId}`);
        await this.db.remove("telegram_links", `chat_id=eq.${chatId}`);
        await this.reply(link.user_id, chatId, "🔓 Telegram отвязан. Данные в приложении сохранены. Чтобы привязать снова — получи новый код в приложении.");
        return;
      default:
        await this.reply(link.user_id, chatId, `Не знаю команду /${escapeHtml(name)}. Список — /help`);
    }
  }

  // ---------- ввод чехлов ----------

  async handleCases(link: LinkRow, cases: number, settings: Settings, updateId: number) {
    const date = this.todayKey();
    // Use raw stored amounts and version: do not rewrite historical tariff snapshots.
    const current = await this.db.one<ShiftRow>("shifts", `user_id=eq.${link.user_id}&work_date=eq.${date}&select=*`);
    const shift = buildShift(link.user_id, date, cases, current?.is_holiday ?? false, settings);
    const configuredRate = settings.case_price * settings.piece_percent / 100;
    shift.piece_rate = configuredRate;
    if (current) {
      const rate = current.piece_rate ?? (current.cases > 0 && round2(current.cases * configuredRate) !== Number(current.piece_pay) ? current.piece_pay / current.cases : configuredRate);
      shift.piece_rate = rate;
      shift.base_pay = current.base_pay;
      shift.piece_pay = round2(cases * rate);
      shift.total_pay = round2(shift.base_pay + shift.piece_pay + Math.max(0, round2(current.total_pay - current.base_pay - current.piece_pay)));
    }
    const result = await this.db.rpc<{ status: string; shift?: ShiftRow }>("telegram_save_daily_total", {
      p_update_id: updateId, p_chat_id: link.chat_id, p_user_id: link.user_id,
      p_date: date, p_expected: current?.updated_at ?? null, p_shift: shift,
    });
    if (result.status === "duplicate") return;
    if (result.status === "conflict") {
      await this.reply(link.user_id, link.chat_id, "⚠️ Смена успела измениться в приложении или другом сообщении. Ничего не перезаписано. Проверь итог и отправь нужное число ещё раз.");
      return;
    }
    if (!result.shift) throw new Error("Missing saved shift");
    const status = result.status === "created" ? "Смена сохранена!" : result.status === "unchanged" ? "Данные уже актуальны!" : "Информация обновлена!";
    await this.reply(link.user_id, link.chat_id, `✅ ${status}\n\n💰 Заработано: ${money(result.shift.total_pay)}\n\n😂 ${escapeHtml(selectJoke(cases))}`);
  }

  // Old buttons are inert, including pending add/replace and quick-add buttons.
  async handleCallback(update: TelegramUpdate) {
    const cq = update.callback_query!;
    if (cq.message?.chat.type !== "private") return;
    await this.tg.answerCallbackQuery(cq.id, "Кнопки больше не используются. Отправь итог за сегодня числом.");
    await this.tg.call("editMessageReplyMarkup", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
  }

  // ---------- карточки ----------

  async todayCard(link: LinkRow, settings: Settings, delta = 0): Promise<Card> {
    const today = this.todayKey();
    const shift = await this.loadShift(link.user_id, today);
    return { text: this.todayText(shift, settings, today, delta) };
  }

  todayText(shift: ShiftRow | null, settings: Settings, today: string, delta = 0): string {
    const minutes = this.minutes();
    const work = isWorkDay(today, settings);
    const head = `📦 <b>Сегодня · ${formatDateRu(today, { weekday: "short", day: "numeric", month: "long" })}</b>`;
    const scheduleLine = work === null ? "" : work ? "📅 По графику — рабочий день" : "📅 По графику — выходной";
    if (!shift) {
      return [head, scheduleLine, "", "Смена за сегодня ещё не внесена. Напиши число чехлов — и я посчитаю заработок.", "", shiftTimeText(minutes)].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
    }
    const deltaText = delta > 0 ? ` (+${integer(delta)})` : delta < 0 ? ` (−${integer(-delta)})` : "";
    const lines = [
      head,
      [scheduleLine, shift.is_holiday ? "🎉 Праздничная ставка" : ""].filter(Boolean).join(" · "),
      "",
      `Упаковано: <b>${integer(shift.cases)}</b> ${plural(shift.cases, "чехол", "чехла", "чехлов")}${deltaText}`,
      motivation(shift.cases),
      "",
      `💰 За смену: <b>${money(shift.total_pay)}</b>`,
      `<blockquote>ставка ${money(shift.base_pay)} + сделка ${money(shift.piece_pay)}</blockquote>`,
      shiftTimeText(minutes),
    ];
    const pace = this.paceText(shift, settings, minutes);
    if (pace) lines.push(pace);
    return lines.filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
  }

  /** Темп: сколько чехлов получится к 19:00, если продолжать так же. */
  paceText(shift: ShiftRow, settings: Settings, minutes: number): string {
    const elapsed = minutes - WORK_START_MIN;
    if (shift.cases <= 0 || elapsed < 60 || minutes >= WORK_END_MIN) return "";
    const projected = Math.round(shift.cases / elapsed * (WORK_END_MIN - WORK_START_MIN));
    if (projected <= shift.cases) return "";
    return `📈 Темп: ≈ ${integer(projected)} ${plural(projected, "чехол", "чехла", "чехлов")} к 19:00 — это ${money(totalPay(projected, shift.is_holiday, settings))}`;
  }

  async monthCard(link: LinkRow, settings: Settings): Promise<Card> {
    const today = this.todayKey();
    const rows = await this.loadMonth(link.user_id, today);
    return { text: this.monthText(rows, settings, today),  };
  }

  monthText(rows: ShiftRow[], settings: Settings, today: string): string {
    const s = summarizeMonth(rows, today, settings);
    if (!s.shifts) return `📊 <b>${monthNameRu(today)}</b>\n\nСмен пока нет. Первая внесённая смена запустит статистику.`;
    const lines = [
      `📊 <b>${monthNameRu(today)}</b>`,
      "",
      `💰 Заработано: <b>${money(s.total)}</b>`,
      `🧾 ${s.shifts} ${plural(s.shifts, "смена", "смены", "смен")} · ${integer(s.cases)} ${plural(s.cases, "чехол", "чехла", "чехлов")}`,
      `📈 Средняя смена: ${money(s.avg)}`,
    ];
    if (s.best) lines.push(`🏆 Лучшая: ${money(s.best.total_pay)} (${formatDateRu(s.best.work_date, { day: "numeric", month: "long" })})`);
    if (s.forecast !== null) lines.push(`🔮 Прогноз месяца: ${money(s.forecast)}${s.remainingWorkDays ? ` (впереди ${s.remainingWorkDays} ${plural(s.remainingWorkDays, "смена", "смены", "смен")})` : ""}`);
    return lines.join("\n");
  }

  async forecastCard(link: LinkRow, settings: Settings): Promise<Card> {
    const today = this.todayKey();
    const rows = await this.loadMonth(link.user_id, today);
    return { text: this.forecastText(rows, settings, today),  };
  }

  forecastText(rows: ShiftRow[], settings: Settings, today: string): string {
    const s = summarizeMonth(rows, today, settings);
    const { to } = monthRange(today);
    if (!s.shifts || s.forecast === null) {
      return "🔮 Прогноз появится после первой внесённой смены в этом месяце.";
    }
    const lines = [
      `🔮 <b>Прогноз на ${monthNameRu(today)}</b>`,
      "",
      `Уже заработано: <b>${money(s.total)}</b> за ${s.shifts} ${plural(s.shifts, "смену", "смены", "смен")}`,
      settings.schedule_start
        ? `Впереди по графику 2/2: ${s.remainingWorkDays} ${plural(s.remainingWorkDays, "смена", "смены", "смен")} до ${formatDateRu(to, { day: "numeric", month: "long" })}`
        : "График не задан — укажи начало графика в настройках приложения, чтобы учесть будущие смены",
      `При средней смене ${money(s.avg)} итог составит ≈ <b>${money(s.forecast)}</b>`,
    ];
    lines.push(`📅 Завтра: ${nextDayText(addDays(today, 1), settings)}`);
    return lines.join("\n");
  }

  async calendarCard(link: LinkRow, settings: Settings, monthKey: string): Promise<Card> {
    const today = this.todayKey();
    const { from, to } = monthRange(`${monthKey}-01`);
    const rows = await this.db.select<ShiftRow>("shifts", `user_id=eq.${link.user_id}&work_date=gte.${from}&work_date=lte.${to}&order=work_date.asc&select=*`).then(rows => rows.map(correctLegacyShift));
    const saved = new Set(rows.map((r) => r.work_date));
    const total = rows.reduce((a, r) => a + Number(r.total_pay || 0), 0);
    const cases = rows.reduce((a, r) => a + Number(r.cases || 0), 0);
    let planned = 0;
    if (settings.schedule_start) {
      for (let k = from; k <= to; k = addDays(k, 1)) if (isWorkDay(k, settings) && !saved.has(k) && k >= today) planned++;
    }
    const lines = [
      `📅 <b>${monthNameRu(`${monthKey}-01`)}</b>`,
      `<pre>${calendarGrid(monthKey, saved, settings, today)}</pre>`,
      "▪ смена внесена · рабочий по графику ▸ сегодня",
      "",
      rows.length ? `🧾 ${rows.length} ${plural(rows.length, "смена", "смены", "смен")} · ${integer(cases)} ${plural(cases, "чехол", "чехла", "чехлов")} · <b>${money(total)}</b>` : "Смен в этом месяце пока нет.",
    ];
    if (planned && monthKey >= monthKeyOf(today)) lines.push(`⏳ Впереди по графику: ${planned} ${plural(planned, "смена", "смены", "смен")}`);
    return {
      text: lines.join("\n"),
    };
  }

  async menuCard(link: LinkRow, settings: Settings): Promise<Card> {
    const pref = await this.loadPref(link);
    const lines = [
      "⚙️ <b>Настройки</b>",
      "",
      `Ставка ${money(settings.base_pay)} · праздничная ${money(settings.holiday_pay)}`,
      `Чехол ${money(settings.case_price)} × ${integer(settings.piece_percent)}%`,
      settings.schedule_start ? `График 2/2 с ${formatDateRu(settings.schedule_start, { day: "numeric", month: "long" })}` : "График 2/2 не задан",
      "",
      pref.enabled ? `🔔 Напоминания включены: вечером в ${pref.reminder_hour}:00 перед рабочим днём и в 19:00, если смена не внесена.` : "🔕 Напоминания выключены.",
      "",
      "Ставки и график меняются в приложении: Ещё → Настройки расчёта.",
    ];
    return {
      text: lines.join("\n"),
    };
  }

  // ---------- данные ----------

  async loadSettings(userId: string): Promise<Settings> {
    const row = await this.db.one<Partial<Settings>>("settings", `user_id=eq.${userId}&select=base_pay,holiday_pay,case_price,piece_percent,schedule_start`);
    return normalizeSettings(row ?? DEFAULT_SETTINGS);
  }

  async loadPref(link: LinkRow): Promise<PrefRow> {
    const row = await this.db.one<Partial<PrefRow>>("telegram_preferences", `user_id=eq.${link.user_id}&select=user_id,chat_id,enabled,reminder_hour`).catch(() => null);
    const hour = Number(row?.reminder_hour);
    return { user_id: link.user_id, chat_id: link.chat_id, enabled: row ? row.enabled !== false : true, reminder_hour: REMINDER_HOURS.includes(hour) ? hour : Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 21 };
  }

  loadShift(userId: string, key: string): Promise<ShiftRow | null> {
    return this.db.one<ShiftRow>("shifts", `user_id=eq.${userId}&work_date=eq.${key}&select=*`).then(s => s ? correctLegacyShift(s) : null);
  }

  loadMonth(userId: string, key: string): Promise<ShiftRow[]> {
    const { from, to } = monthRange(key);
    return this.db.select<ShiftRow>("shifts", `user_id=eq.${userId}&work_date=gte.${from}&work_date=lte.${to}&order=work_date.asc&select=*`).then(rows => rows.map(correctLegacyShift));
  }

  // ---------- отправка ----------

  async reply(userId: string | null, chatId: number, text: string) {
    await this.tg.sendMessage(chatId, text);
    await this.logEvent(userId, chatId, "out", text);
  }

  /** Карточка новым сообщением; `note` — короткая строка над карточкой (результат действия). */
  async sendCard(link: LinkRow, card: Card, note?: string) {
    const text = note ? `${note}\n\n${card.text}` : card.text;
    await this.reply(link.user_id, link.chat_id, text);
  }

  async logEvent(userId: string | null, chatId: number, direction: "in" | "out", message: string) {
    try {
      await this.db.insert("telegram_bot_events", { user_id: userId, chat_id: chatId, direction, message: message.slice(0, 2000) });
    } catch {
      // Журнал — не критичен.
    }
  }
}

function nextDayText(key: string, settings: Settings): string {
  const w = isWorkDay(key, settings);
  if (w === null) return `${formatDateRu(key, { weekday: "long", day: "numeric", month: "long" })}`;
  return w ? `рабочий день, начало в 08:00` : `выходной по графику`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
