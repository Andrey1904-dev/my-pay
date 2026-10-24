// Обработчик вебхука Telegram-бота CASE.PLACE SALARY.
// Вся логика вынесена в createBotHandler, чтобы её можно было тестировать без Deno:
// окружение, fetch и «сейчас» передаются снаружи.
//
// Принципы интерфейса (v18):
//  • каждый ответ — «карточка» с заголовком и inline-кнопками для следующего шага;
//  • кнопки под карточкой редактируют то же сообщение, а не плодят новые;
//  • постоянная клавиатура — только самое частое: +100/+500/+1000, отчёты и «Ещё».

import {
  APP_URL,
  BOT_COMMANDS,
  Db,
  DEFAULT_SETTINGS,
  MAIN_KEYBOARD,
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
  shiftMonthKey,
  shiftTimeText,
  summarizeMonth,
  totalPay,
  round2,
  type FetchLike,
  type ParsedInput,
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

interface EntryRow {
  id: string;
  user_id: string;
  chat_id: number;
  work_date: string;
  cases: number;
  created_at: string;
}

interface PendingRow {
  chat_id: number;
  user_id: string;
  cases: number;
  expires_at: string;
}

interface PrefRow {
  user_id: string;
  chat_id: number;
  enabled: boolean;
  reminder_hour: number;
}

interface Card {
  text: string;
  markup?: unknown;
}

const PENDING_TTL_MIN = 15;
const REMINDER_HOURS = [19, 20, 21, 22];

export const HELP_TEXT = [
  "❓ <b>Как пользоваться</b>",
  "",
  "📦 <b>Чехлы</b>",
  "• <code>350</code> — внести за сегодня",
  "• <code>+500</code> — добавить к уже внесённым",
  "• <code>вчера 900</code> или <code>27.09 900</code> — за другой день",
  "• кнопки +100 / +500 / +1000 — прямо под карточкой смены",
  "",
  "📊 <b>Отчёты</b>",
  "/today — смена за сегодня · /month — итоги месяца",
  "/forecast — прогноз · /calendar — календарь смен",
  "/last — последняя смена",
  "",
  "⚙️ <b>Управление</b>",
  "/undo — отменить последнее добавление · /holiday — праздничная ставка",
  "/settings — напоминания и настройки · /menu — вернуть кнопки · /unlink — отвязать",
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

const LINK_MARKUP = { inline_keyboard: [[{ text: "🌐 Открыть приложение", url: APP_URL }]] };

const TODAY_MARKUP = {
  inline_keyboard: [
    [{ text: "+100", callback_data: "q:100" }, { text: "+500", callback_data: "q:500" }, { text: "+1000", callback_data: "q:1000" }],
    [{ text: "↩️ Отменить", callback_data: "undo" }, { text: "🎉 Праздничная", callback_data: "holiday" }],
    [{ text: "📊 Месяц", callback_data: "v:month" }, { text: "🔮 Прогноз", callback_data: "v:forecast" }, { text: "📅 Календарь", callback_data: "v:calendar" }],
  ],
};

const MONTH_MARKUP = {
  inline_keyboard: [
    [{ text: "📅 Календарь", callback_data: "v:calendar" }, { text: "🔮 Прогноз", callback_data: "v:forecast" }],
    [{ text: "📦 Сегодня", callback_data: "v:today" }],
  ],
};

const FORECAST_MARKUP = {
  inline_keyboard: [
    [{ text: "📊 Месяц", callback_data: "v:month" }, { text: "📅 Календарь", callback_data: "v:calendar" }],
    [{ text: "📦 Сегодня", callback_data: "v:today" }],
  ],
};


const HINT_MARKUP = {
  inline_keyboard: [
    [{ text: "📦 Сегодня", callback_data: "v:today" }, { text: "❓ Помощь", callback_data: "v:help" }],
  ],
};

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
      else if (update.message) await ctx.handleMessage(update.message);
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

  async handleMessage(msg: TelegramMessage) {
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
      await this.reply(null, chatId, LINK_HINT, LINK_MARKUP);
      return;
    }

    this.db.update("telegram_links", `chat_id=eq.${chatId}`, { last_seen_at: this.now().toISOString() }).catch(() => undefined);

    const settings = await this.loadSettings(link.user_id);

    switch (parsed.kind) {
      case "command":
        await this.handleCommand(link, parsed.name, settings);
        return;
      case "add":
      case "set":
        await this.handleCases(link, parsed, settings);
        return;
      default:
        await this.reply(
          link.user_id,
          chatId,
          [
            "🤔 Не понял.",
            "",
            "Так можно:",
            "• <code>350</code> — чехлы за сегодня, <code>+500</code> — добавить",
            "• <code>вчера 900</code> — смена за другой день",
          ].join("\n"),
          HINT_MARKUP,
        );
    }
  }

  async handleStart(msg: TelegramMessage, arg: string, link: LinkRow | null) {
    const chatId = msg.chat.id;
    const code = arg.trim().toUpperCase();
    this.tg.setMyCommands(BOT_COMMANDS).catch(() => undefined);
    if (!code) {
      if (link) {
        await this.reply(link.user_id, chatId, `✅ Telegram уже привязан. Пиши количество чехлов — и я всё посчитаю.\n\n${HELP_TEXT}`, MAIN_KEYBOARD);
      } else {
        await this.reply(null, chatId, LINK_HINT, LINK_MARKUP);
      }
      return;
    }
    const nowIso = this.now().toISOString();
    const row = await this.db.one<{ code: string; user_id: string; expires_at: string }>(
      "telegram_link_codes",
      `code=eq.${encodeURIComponent(code)}&expires_at=gt.${encodeURIComponent(nowIso)}&select=code,user_id,expires_at`,
    );
    if (!row) {
      await this.reply(link?.user_id ?? null, chatId, "❌ Код не найден или уже истёк. Получи новый в приложении: «Ещё» → «Telegram-бот».", LINK_MARKUP);
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
        "Теперь просто пиши число чехлов — например <code>350</code>, а <code>+500</code> добавит к внесённым.",
        "",
        "Кнопки внизу — отчёты и быстрые действия, /help — все возможности.",
      ].join("\n"),
      MAIN_KEYBOARD,
    );
  }

  async handleCommand(link: LinkRow, name: string, settings: Settings) {
    const chatId = link.chat_id;
    const today = this.todayKey();
    switch (name) {
      case "help":
        await this.reply(link.user_id, chatId, HELP_TEXT, MAIN_KEYBOARD);
        return;
      case "menu":
        await this.reply(link.user_id, chatId, "Кнопки на месте 👇", MAIN_KEYBOARD);
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
          await this.reply(link.user_id, chatId, "Пока нет ни одной смены. Напиши число чехлов — и она появится.", HINT_MARKUP);
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
          { inline_keyboard: [[{ text: "📅 Календарь", callback_data: `cal:${monthKeyOf(last.work_date)}` }, { text: "📦 Сегодня", callback_data: "v:today" }]] },
        );
        return;
      }
      case "undo": {
        const res = await this.undoLast(link, settings);
        await this.sendCard(link, res.card, res.note);
        return;
      }
      case "holiday": {
        const shift = await this.toggleHoliday(link, settings);
        await this.sendCard(link, await this.todayCard(link, settings), shift.is_holiday ? "🎉 Сегодня праздничная смена — ставка выше." : "📅 Сегодня обычная смена.");
        return;
      }
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
        await this.reply(link.user_id, chatId, "🔓 Telegram отвязан. Данные в приложении сохранены. Чтобы привязать снова — получи новый код в приложении.", { remove_keyboard: true });
        return;
      default:
        await this.reply(link.user_id, chatId, `Не знаю команду /${escapeHtml(name)}. Список — /help`, HINT_MARKUP);
    }
  }

  // ---------- ввод чехлов ----------

  async handleCases(link: LinkRow, parsed: Extract<ParsedInput, { kind: "add" | "set" }>, settings: Settings) {
    const today = this.todayKey();
    const date = parsed.date ?? today;
    const current = await this.loadShift(link.user_id, date);
    const existing = current?.cases ?? 0;
    const dateLabel = date === today ? "Сегодня" : formatDateRu(date, { weekday: "short", day: "numeric", month: "long" });

    if (parsed.kind === "set" && existing > 0 && existing !== parsed.cases) {
      const expires = new Date(this.now().getTime() + PENDING_TTL_MIN * 60000).toISOString();
      await this.db.upsert("telegram_pending_inputs", { chat_id: link.chat_id, user_id: link.user_id, cases: parsed.cases, expires_at: expires }, "chat_id");
      const suffix = date === today ? "" : `:${date}`;
      await this.reply(
        link.user_id,
        link.chat_id,
        `${dateLabel} уже внесено <b>${integer(existing)}</b> ${plural(existing, "чехол", "чехла", "чехлов")}. Что сделать с числом <b>${integer(parsed.cases)}</b>?`,
        {
          inline_keyboard: [
            [{ text: `➕ Добавить → ${integer(existing + parsed.cases)}`, callback_data: `add${suffix}` }, { text: `✏️ Заменить на ${integer(parsed.cases)}`, callback_data: `set${suffix}` }],
            [{ text: "Отмена", callback_data: "cancel" }],
          ],
        },
      );
      return;
    }

    const result = await this.applyCases(link, parsed.kind, parsed.cases, current, settings, date);
    if (date === today) {
      await this.sendCard(link, await this.todayCard(link, settings, result.delta));
    } else {
      await this.sendCard(link, this.dayCard(result.shift, result.delta));
    }
  }

  /** Записывает смену и возвращает её вместе с изменением числа чехлов. */
  async applyCases(link: LinkRow, kind: "add" | "set", cases: number, current: ShiftRow | null, settings: Settings, date = this.todayKey()) {
    const existing = current?.cases ?? 0;
    const nextCases = kind === "add" ? existing + cases : cases;
    const shift = buildShift(link.user_id, date, nextCases, current?.is_holiday ?? false, settings);
    preserveBonus(shift, current);
    await this.saveShift(shift);
    const delta = shift.cases - existing;
    if (delta > 0) {
      await this.db.insert("telegram_entries", { user_id: link.user_id, chat_id: link.chat_id, work_date: date, cases: delta });
    }
    return { shift, delta };
  }

  async toggleHoliday(link: LinkRow, settings: Settings): Promise<ShiftRow> {
    const today = this.todayKey();
    const shift = await this.loadShift(link.user_id, today);
    const next = buildShift(link.user_id, today, shift?.cases ?? 0, !(shift?.is_holiday ?? false), settings);
    preserveBonus(next, shift);
    await this.saveShift(next);
    return next;
  }

  async undoLast(link: LinkRow, settings: Settings): Promise<{ card: Card; note: string }> {
    const today = this.todayKey();
    const entry = await this.db.one<EntryRow>("telegram_entries", `user_id=eq.${link.user_id}&work_date=eq.${today}&order=created_at.desc&select=*`);
    if (!entry) {
      return { card: await this.todayCard(link, settings), note: "Нечего отменять: сегодня через бота ничего не добавляли." };
    }
    const current = await this.loadShift(link.user_id, today);
    const nextCases = Math.max(0, (current?.cases ?? 0) - entry.cases);
    const shift = buildShift(link.user_id, today, nextCases, current?.is_holiday ?? false, settings);
    preserveBonus(shift, current);
    await this.saveShift(shift);
    await this.db.remove("telegram_entries", `id=eq.${entry.id}`);
    return { card: await this.todayCard(link, settings), note: `↩️ Отменил последнее добавление (−${integer(entry.cases)}).` };
  }

  // ---------- callback-кнопки ----------

  async handleCallback(update: TelegramUpdate) {
    const cq = update.callback_query!;
    const chatId = cq.message?.chat.id;
    const messageId = cq.message?.message_id;
    if (!chatId || !messageId) {
      await this.tg.answerCallbackQuery(cq.id);
      return;
    }
    const link = await this.db.one<LinkRow>("telegram_links", `chat_id=eq.${chatId}&select=user_id,chat_id,username,first_name`);
    if (!link) {
      await this.tg.answerCallbackQuery(cq.id, "Аккаунт не привязан");
      return;
    }
    const data = cq.data || "noop";
    const [action, arg] = data.split(":");
    const settings = await this.loadSettings(link.user_id);

    // Подтверждение «добавить / заменить» (число ждёт в telegram_pending_inputs не дольше 15 минут).
    if (action === "add" || action === "set" || action === "cancel") {
      const pending = await this.db.one<PendingRow>("telegram_pending_inputs", `chat_id=eq.${chatId}&select=chat_id,user_id,cases,expires_at`);
      await this.db.remove("telegram_pending_inputs", `chat_id=eq.${chatId}`);
      if (action === "cancel") {
        await this.tg.answerCallbackQuery(cq.id, "Отменено");
        await this.tg.editMessageText(chatId, messageId, "Отменено. Ничего не изменилось.");
        return;
      }
      if (!pending || pending.user_id !== link.user_id || new Date(pending.expires_at).getTime() < this.now().getTime()) {
        await this.tg.answerCallbackQuery(cq.id, "Запрос устарел");
        await this.tg.editMessageText(chatId, messageId, "⌛️ Запрос устарел — отправь число ещё раз.");
        return;
      }
      const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : this.todayKey();
      const current = await this.loadShift(link.user_id, date);
      const result = await this.applyCases(link, action, pending.cases, current, settings, date);
      await this.tg.answerCallbackQuery(cq.id, "Готово");
      const card = date === this.todayKey() ? await this.todayCard(link, settings, result.delta) : this.dayCard(result.shift, result.delta);
      await this.editCard(link, messageId, card);
      return;
    }

    switch (action) {
      case "q": { // быстрое добавление +100/+500/+1000 к сегодняшней смене
        const add = Math.max(0, Math.round(Number(arg)));
        if (!add) { await this.tg.answerCallbackQuery(cq.id); return; }
        const current = await this.loadShift(link.user_id, this.todayKey());
        const result = await this.applyCases(link, "add", add, current, settings);
        await this.tg.answerCallbackQuery(cq.id, `+${integer(add)} → ${integer(result.shift.cases)}`);
        await this.editCard(link, messageId, await this.todayCard(link, settings, result.delta));
        return;
      }
      case "undo": {
        const res = await this.undoLast(link, settings);
        await this.tg.answerCallbackQuery(cq.id, res.note.replace(/<[^>]+>/g, "").slice(0, 190));
        await this.editCard(link, messageId, res.card, res.note);
        return;
      }
      case "holiday": {
        const shift = await this.toggleHoliday(link, settings);
        await this.tg.answerCallbackQuery(cq.id, shift.is_holiday ? "Праздничная ставка включена" : "Обычная ставка");
        await this.editCard(link, messageId, await this.todayCard(link, settings));
        return;
      }
      case "v": {
        const card = arg === "month" ? await this.monthCard(link, settings)
          : arg === "forecast" ? await this.forecastCard(link, settings)
          : arg === "calendar" ? await this.calendarCard(link, settings, monthKeyOf(this.todayKey()))
          : arg === "settings" ? await this.menuCard(link, settings)
          : arg === "help" ? { text: HELP_TEXT, markup: HINT_MARKUP }
          : await this.todayCard(link, settings);
        await this.tg.answerCallbackQuery(cq.id);
        await this.editCard(link, messageId, card);
        return;
      }
      case "cal": {
        const monthKey = /^\d{4}-\d{2}$/.test(arg || "") ? arg : monthKeyOf(this.todayKey());
        await this.tg.answerCallbackQuery(cq.id);
        await this.editCard(link, messageId, await this.calendarCard(link, settings, monthKey));
        return;
      }
      case "n": { // напоминания вкл/выкл
        const pref = await this.loadPref(link);
        const enabled = !pref.enabled;
        await this.db.upsert("telegram_preferences", { user_id: link.user_id, chat_id: chatId, enabled, updated_at: this.now().toISOString() }, "user_id");
        await this.tg.answerCallbackQuery(cq.id, enabled ? "🔔 Напоминания включены" : "🔕 Напоминания выключены");
        await this.editCard(link, messageId, await this.menuCard(link, settings));
        return;
      }
      case "h": { // время вечернего напоминания по кругу: 19 → 20 → 21 → 22
        const pref = await this.loadPref(link);
        const idx = REMINDER_HOURS.indexOf(pref.reminder_hour);
        const next = REMINDER_HOURS[(idx + 1) % REMINDER_HOURS.length];
        await this.db.upsert("telegram_preferences", { user_id: link.user_id, chat_id: chatId, enabled: pref.enabled, reminder_hour: next, updated_at: this.now().toISOString() }, "user_id");
        await this.tg.answerCallbackQuery(cq.id, `Напомню в ${next}:00`);
        await this.editCard(link, messageId, await this.menuCard(link, settings));
        return;
      }
      default:
        await this.tg.answerCallbackQuery(cq.id);
    }
  }

  // ---------- карточки ----------

  async todayCard(link: LinkRow, settings: Settings, delta = 0): Promise<Card> {
    const today = this.todayKey();
    const shift = await this.loadShift(link.user_id, today);
    return { text: this.todayText(shift, settings, today, delta), markup: TODAY_MARKUP };
  }

  todayText(shift: ShiftRow | null, settings: Settings, today: string, delta = 0): string {
    const minutes = this.minutes();
    const work = isWorkDay(today, settings);
    const head = `📦 <b>Сегодня · ${formatDateRu(today, { weekday: "short", day: "numeric", month: "long" })}</b>`;
    const scheduleLine = work === null ? "" : work ? "📅 По графику — рабочий день" : "📅 По графику — выходной";
    if (!shift) {
      return [head, scheduleLine, "", "Смена за сегодня ещё не внесена. Напиши число чехлов или нажми кнопку — и я посчитаю заработок.", "", shiftTimeText(minutes)].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
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

  dayCard(shift: ShiftRow, delta: number): Card {
    const deltaText = delta > 0 ? ` (+${integer(delta)})` : delta < 0 ? ` (−${integer(-delta)})` : "";
    return {
      text: [
        `🗓 <b>${formatDateRu(shift.work_date)}</b>${shift.is_holiday ? " · праздничная" : ""}`,
        "",
        `Упаковано: <b>${integer(shift.cases)}</b> ${plural(shift.cases, "чехол", "чехла", "чехлов")}${deltaText}`,
        `💰 За смену: <b>${money(shift.total_pay)}</b>`,
        `<blockquote>ставка ${money(shift.base_pay)} + сделка ${money(shift.piece_pay)}</blockquote>`,
      ].join("\n"),
      markup: { inline_keyboard: [[{ text: "📅 Календарь", callback_data: `cal:${monthKeyOf(shift.work_date)}` }, { text: "📊 Месяц", callback_data: "v:month" }]] },
    };
  }

  async monthCard(link: LinkRow, settings: Settings): Promise<Card> {
    const today = this.todayKey();
    const rows = await this.loadMonth(link.user_id, today);
    return { text: this.monthText(rows, settings, today), markup: MONTH_MARKUP };
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
    return { text: this.forecastText(rows, settings, today), markup: FORECAST_MARKUP };
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
    const prev = shiftMonthKey(monthKey, -1), next = shiftMonthKey(monthKey, 1);
    return {
      text: lines.join("\n"),
      markup: {
        inline_keyboard: [
          [{ text: `◀️ ${shortMonth(prev)}`, callback_data: `cal:${prev}` }, { text: "📦 Сегодня", callback_data: "v:today" }, { text: `${shortMonth(next)} ▶️`, callback_data: `cal:${next}` }],
          [{ text: "📊 Месяц", callback_data: "v:month" }, { text: "🔮 Прогноз", callback_data: "v:forecast" }],
        ],
      },
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
      markup: {
        inline_keyboard: [
          [{ text: pref.enabled ? "🔕 Выключить напоминания" : "🔔 Включить напоминания", callback_data: "n:toggle" }, { text: `🕘 Время: ${pref.reminder_hour}:00`, callback_data: "h:next" }],
          [{ text: "↩️ Отменить ввод", callback_data: "undo" }, { text: "🎉 Праздничная смена", callback_data: "holiday" }],
          [{ text: "❓ Помощь", callback_data: "v:help" }, { text: "🌐 Открыть приложение", url: APP_URL }],
        ],
      },
    };
  }

  // ---------- данные ----------

  async loadSettings(userId: string): Promise<Settings> {
    const row = await this.db.one<Partial<Settings>>("settings", `user_id=eq.${userId}&select=base_pay,holiday_pay,case_price,piece_percent,schedule_start`).catch(() => null);
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

  saveShift(shift: ShiftRow) {
    return this.db.upsert("shifts", shift, "user_id,work_date");
  }

  // ---------- отправка ----------

  async reply(userId: string | null, chatId: number, text: string, replyMarkup?: unknown) {
    await this.tg.sendMessage(chatId, text, replyMarkup);
    await this.logEvent(userId, chatId, "out", text);
  }

  /** Карточка новым сообщением; `note` — короткая строка над карточкой (результат действия). */
  async sendCard(link: LinkRow, card: Card, note?: string) {
    const text = note ? `${note}\n\n${card.text}` : card.text;
    await this.reply(link.user_id, link.chat_id, text, card.markup);
  }

  /** Карточка вместо существующего сообщения (после нажатия inline-кнопки). */
  async editCard(link: LinkRow, messageId: number, card: Card, note?: string) {
    const text = note ? `${note}\n\n${card.text}` : card.text;
    await this.tg.editMessageText(link.chat_id, messageId, text, card.markup);
    await this.logEvent(link.user_id, link.chat_id, "out", text);
  }

  async logEvent(userId: string | null, chatId: number, direction: "in" | "out", message: string) {
    try {
      await this.db.insert("telegram_bot_events", { user_id: userId, chat_id: chatId, direction, message: message.slice(0, 2000) });
    } catch {
      // Журнал — не критичен.
    }
  }
}

function preserveBonus(next: ShiftRow, previous: ShiftRow | null) {
  if (previous) next.total_pay = round2(next.total_pay + Math.max(0, round2(previous.total_pay - previous.base_pay - previous.piece_pay)));
}

function nextDayText(key: string, settings: Settings): string {
  const w = isWorkDay(key, settings);
  if (w === null) return `${formatDateRu(key, { weekday: "long", day: "numeric", month: "long" })}`;
  return w ? `рабочий день, начало в 08:00` : `выходной по графику`;
}

function shortMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const text = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", month: "short" }).format(new Date(Date.UTC(y, m - 1, 1))).replace(".", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
