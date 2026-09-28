// Обработчик вебхука Telegram-бота CASE.PLACE SALARY.
// Вся логика вынесена в createBotHandler, чтобы её можно было тестировать без Deno:
// окружение, fetch и «сейчас» передаются снаружи.

import {
  Db,
  DEFAULT_SETTINGS,
  MAIN_KEYBOARD,
  Telegram,
  addDays,
  buildShift,
  dateKeyInTz,
  escapeHtml,
  formatDateRu,
  integer,
  isWorkDay,
  minutesInTz,
  money,
  monthNameRu,
  monthRange,
  motivation,
  normalizeSettings,
  parseInput,
  plural,
  shiftTimeText,
  summarizeMonth,
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

const PENDING_TTL_MIN = 15;

export const HELP_TEXT = [
  "<b>Как пользоваться</b>",
  "",
  "📦 Напиши число — это чехлы за сегодня: <code>350</code>, <code>350 + 500</code>, <code>чехлы 350</code>.",
  "➕ Со знаком плюс добавлю к уже внесённым: <code>+500</code>.",
  "",
  "/today — смена за сегодня",
  "/month — итоги месяца",
  "/forecast — прогноз до конца месяца",
  "/last — последняя внесённая смена",
  "/undo — отменить последнее добавление за сегодня",
  "/holiday — переключить праздничную ставку на сегодня",
  "/notify_on и /notify_off — напоминания о сменах",
  "/menu — показать кнопки",
  "/unlink — отвязать Telegram от аккаунта",
].join("\n");

const LINK_HINT = [
  "👋 Привет! Это бот <b>CASE.PLACE SALARY</b>.",
  "",
  "Чтобы вносить чехлы из чата, привяжи аккаунт:",
  "1. Открой приложение → «Ещё» → «Telegram-бот».",
  "2. Нажми «Получить код».",
  "3. Отправь сюда команду <code>/start КОД</code> или перейди по ссылке из приложения.",
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
      else if (update.message) await ctx.handleMessage(update.message);
    } catch (err) {
      // Telegram повторяет доставку при не-2xx, поэтому логическую ошибку отвечаем 200 и сообщаем пользователю.
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      logError("telegram-mypay error", err);
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

  // ---------- сообщения ----------

  async handleMessage(msg: TelegramMessage) {
    if (msg.chat.type !== "private" || msg.from?.is_bot) return;
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();
    if (!text) return;

    const link = await this.db.one<LinkRow>("telegram_links", `chat_id=eq.${chatId}&select=user_id,chat_id,username,first_name`);
    await this.logEvent(link?.user_id ?? null, chatId, "in", text);

    const parsed = parseInput(text);

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

    if (parsed.kind === "command") {
      await this.handleCommand(link, parsed.name, settings);
      return;
    }

    if (parsed.kind === "add" || parsed.kind === "set") {
      await this.handleCases(link, parsed.kind, parsed.cases, settings);
      return;
    }

    await this.reply(link.user_id, chatId, "🤔 Не понял. Напиши количество чехлов, например <code>350</code> или <code>+500</code>. Список команд — /help", MAIN_KEYBOARD);
  }

  async handleStart(msg: TelegramMessage, arg: string, link: LinkRow | null) {
    const chatId = msg.chat.id;
    const code = arg.trim().toUpperCase();
    if (!code) {
      if (link) {
        await this.reply(link.user_id, chatId, `✅ Telegram уже привязан. Пиши количество чехлов — и я всё посчитаю.\n\n${HELP_TEXT}`, MAIN_KEYBOARD);
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
    await this.reply(row.user_id, chatId, `🎉 Готово${name}! Telegram привязан к аккаунту.\n\nТеперь просто пиши число чехлов — например <code>350</code>. Кнопки ниже помогут с частыми действиями.`, MAIN_KEYBOARD);
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
      case "today": {
        const shift = await this.loadShift(link.user_id, today);
        await this.reply(link.user_id, chatId, this.todayText(shift, settings, today));
        return;
      }
      case "month": {
        const rows = await this.loadMonth(link.user_id, today);
        await this.reply(link.user_id, chatId, this.monthText(rows, settings, today));
        return;
      }
      case "forecast": {
        const rows = await this.loadMonth(link.user_id, today);
        await this.reply(link.user_id, chatId, this.forecastText(rows, settings, today));
        return;
      }
      case "last": {
        const last = await this.db.one<ShiftRow>("shifts", `user_id=eq.${link.user_id}&order=work_date.desc&select=*`);
        if (!last) {
          await this.reply(link.user_id, chatId, "Пока нет ни одной смены. Напиши число чехлов — и она появится.");
          return;
        }
        await this.reply(link.user_id, chatId, `🗓 <b>${formatDateRu(last.work_date)}</b>\n📦 ${integer(last.cases)} ${plural(last.cases, "чехол", "чехла", "чехлов")}\n💰 ${money(last.total_pay)}${last.is_holiday ? " · праздничная" : ""}`);
        return;
      }
      case "undo":
        await this.handleUndo(link, settings);
        return;
      case "holiday": {
        const shift = await this.loadShift(link.user_id, today);
        const next = buildShift(link.user_id, today, shift?.cases ?? 0, !(shift?.is_holiday ?? false), settings);
        await this.saveShift(next);
        await this.reply(link.user_id, chatId, `${next.is_holiday ? "🎉 Сегодня праздничная смена" : "📅 Сегодня обычная смена"}: ставка ${money(next.base_pay)}.\n💰 Итого за смену: <b>${money(next.total_pay)}</b>`);
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
        await this.reply(link.user_id, chatId, `Не знаю команду /${escapeHtml(name)}. Список — /help`);
    }
  }

  // ---------- ввод чехлов ----------

  async handleCases(link: LinkRow, kind: "add" | "set", cases: number, settings: Settings) {
    const today = this.todayKey();
    const current = await this.loadShift(link.user_id, today);
    const existing = current?.cases ?? 0;

    if (kind === "set" && existing > 0 && existing !== cases) {
      const expires = new Date(this.now().getTime() + PENDING_TTL_MIN * 60000).toISOString();
      await this.db.upsert("telegram_pending_inputs", { chat_id: link.chat_id, user_id: link.user_id, cases, expires_at: expires }, "chat_id");
      await this.reply(
        link.user_id,
        link.chat_id,
        `Сегодня уже внесено <b>${integer(existing)}</b> ${plural(existing, "чехол", "чехла", "чехлов")}. Что сделать с числом <b>${integer(cases)}</b>?`,
        {
          inline_keyboard: [
            [{ text: `➕ Добавить → ${integer(existing + cases)}`, callback_data: "add" }, { text: `✏️ Заменить на ${integer(cases)}`, callback_data: "set" }],
            [{ text: "Отмена", callback_data: "cancel" }],
          ],
        },
      );
      return;
    }

    const text = await this.applyCases(link, kind, cases, current, settings);
    await this.reply(link.user_id, link.chat_id, text, MAIN_KEYBOARD);
  }

  /** Записывает смену и возвращает текст ответа. */
  async applyCases(link: LinkRow, kind: "add" | "set", cases: number, current: ShiftRow | null, settings: Settings): Promise<string> {
    const today = this.todayKey();
    const existing = current?.cases ?? 0;
    const nextCases = kind === "add" ? existing + cases : cases;
    const shift = buildShift(link.user_id, today, nextCases, current?.is_holiday ?? false, settings);
    await this.saveShift(shift);
    const delta = shift.cases - existing;
    if (delta > 0) {
      await this.db.insert("telegram_entries", { user_id: link.user_id, chat_id: link.chat_id, work_date: today, cases: delta });
    }
    const deltaText = delta > 0 ? ` (+${integer(delta)})` : delta < 0 ? ` (−${integer(-delta)})` : "";
    return [
      `📦 Сегодня упаковано: <b>${integer(shift.cases)}</b> ${plural(shift.cases, "чехол", "чехла", "чехлов")}${deltaText}`,
      motivation(shift.cases),
      `💰 За смену: <b>${money(shift.total_pay)}</b> — ставка ${money(shift.base_pay)} + сделка ${money(shift.piece_pay)}`,
      shiftTimeText(minutesInTz(this.now())),
    ].join("\n");
  }

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
    const pending = await this.db.one<PendingRow>("telegram_pending_inputs", `chat_id=eq.${chatId}&select=chat_id,user_id,cases,expires_at`);
    const action = cq.data || "cancel";
    await this.db.remove("telegram_pending_inputs", `chat_id=eq.${chatId}`);

    if (action === "cancel") {
      await this.tg.answerCallbackQuery(cq.id, "Отменено");
      await this.tg.editMessageText(chatId, messageId, "Отменено. Ничего не изменилось.");
      return;
    }
    if (!pending || new Date(pending.expires_at).getTime() < this.now().getTime()) {
      await this.tg.answerCallbackQuery(cq.id, "Запрос устарел");
      await this.tg.editMessageText(chatId, messageId, "⌛️ Запрос устарел — отправь число ещё раз.");
      return;
    }
    const settings = await this.loadSettings(link.user_id);
    const current = await this.loadShift(link.user_id, this.todayKey());
    const text = await this.applyCases(link, action === "add" ? "add" : "set", pending.cases, current, settings);
    await this.tg.answerCallbackQuery(cq.id, "Готово");
    await this.tg.editMessageText(chatId, messageId, text);
    await this.logEvent(link.user_id, chatId, "out", text);
  }

  async handleUndo(link: LinkRow, settings: Settings) {
    const today = this.todayKey();
    const entry = await this.db.one<EntryRow>("telegram_entries", `user_id=eq.${link.user_id}&work_date=eq.${today}&order=created_at.desc&select=*`);
    if (!entry) {
      await this.reply(link.user_id, link.chat_id, "Нечего отменять: сегодня через бота ничего не добавляли.");
      return;
    }
    const current = await this.loadShift(link.user_id, today);
    const nextCases = Math.max(0, (current?.cases ?? 0) - entry.cases);
    const shift = buildShift(link.user_id, today, nextCases, current?.is_holiday ?? false, settings);
    await this.saveShift(shift);
    await this.db.remove("telegram_entries", `id=eq.${entry.id}`);
    await this.reply(
      link.user_id,
      link.chat_id,
      `↩️ Отменил последнее добавление (−${integer(entry.cases)}).\n📦 Сегодня: <b>${integer(shift.cases)}</b> ${plural(shift.cases, "чехол", "чехла", "чехлов")}\n💰 За смену: <b>${money(shift.total_pay)}</b>`,
      MAIN_KEYBOARD,
    );
  }

  // ---------- тексты ----------

  todayText(shift: ShiftRow | null, settings: Settings, today: string): string {
    const head = `🗓 <b>${formatDateRu(today)}</b>`;
    const work = isWorkDay(today, settings);
    const scheduleLine = work === null ? "" : work ? "📅 По графику — рабочий день" : "📅 По графику — выходной";
    if (!shift) {
      return [head, scheduleLine, "Смена за сегодня ещё не внесена. Напиши число чехлов — и я посчитаю заработок.", shiftTimeText(minutesInTz(this.now()))].filter(Boolean).join("\n");
    }
    return [
      head,
      scheduleLine,
      `📦 ${integer(shift.cases)} ${plural(shift.cases, "чехол", "чехла", "чехлов")}${shift.is_holiday ? " · праздничная смена" : ""}`,
      `💰 <b>${money(shift.total_pay)}</b> — ставка ${money(shift.base_pay)} + сделка ${money(shift.piece_pay)}`,
      motivation(shift.cases),
      shiftTimeText(minutesInTz(this.now())),
    ].filter(Boolean).join("\n");
  }

  monthText(rows: ShiftRow[], settings: Settings, today: string): string {
    const s = summarizeMonth(rows, today, settings);
    if (!s.shifts) return `📊 <b>${monthNameRu(today)}</b>\nСмен пока нет. Первая внесённая смена запустит статистику.`;
    const lines = [
      `📊 <b>${monthNameRu(today)}</b>`,
      `💰 Заработано: <b>${money(s.total)}</b>`,
      `🧾 ${s.shifts} ${plural(s.shifts, "смена", "смены", "смен")} · ${integer(s.cases)} ${plural(s.cases, "чехол", "чехла", "чехлов")}`,
      `📈 Средняя смена: ${money(s.avg)}`,
    ];
    if (s.best) lines.push(`🏆 Лучшая: ${money(s.best.total_pay)} (${formatDateRu(s.best.work_date, { day: "numeric", month: "long" })})`);
    if (settings.monthly_goal > 0) {
      const left = Math.max(0, settings.monthly_goal - s.total);
      lines.push(left > 0 ? `🎯 Цель ${money(settings.monthly_goal)}: ${s.goalPercent}%, осталось ${money(left)}` : `🎯 Цель ${money(settings.monthly_goal)} выполнена ✅`);
    }
    if (s.forecast !== null) lines.push(`🔮 Прогноз месяца: ${money(s.forecast)}`);
    return lines.join("\n");
  }

  forecastText(rows: ShiftRow[], settings: Settings, today: string): string {
    const s = summarizeMonth(rows, today, settings);
    const { to } = monthRange(today);
    if (!s.shifts || s.forecast === null) {
      return "🔮 Прогноз появится после первой внесённой смены в этом месяце.";
    }
    const lines = [
      `🔮 <b>Прогноз на ${monthNameRu(today)}</b>`,
      `Уже заработано: <b>${money(s.total)}</b> за ${s.shifts} ${plural(s.shifts, "смену", "смены", "смен")}`,
      settings.schedule_start
        ? `Впереди по графику 2/2: ${s.remainingWorkDays} ${plural(s.remainingWorkDays, "смена", "смены", "смен")} до ${formatDateRu(to, { day: "numeric", month: "long" })}`
        : "График не задан — укажи начало графика в настройках приложения, чтобы учесть будущие смены",
      `При средней смене ${money(s.avg)} итог составит ≈ <b>${money(s.forecast)}</b>`,
    ];
    if (settings.monthly_goal > 0) {
      const gap = settings.monthly_goal - s.forecast;
      if (gap > 0 && s.remainingWorkDays > 0) {
        const needAvg = (settings.monthly_goal - s.total) / s.remainingWorkDays;
        const needCases = Math.max(0, Math.ceil((needAvg - settings.base_pay) / Math.max(0.01, settings.case_price * settings.piece_percent / 100)));
        lines.push(`🎯 Чтобы дойти до цели ${money(settings.monthly_goal)}, нужно ≈ ${money(needAvg)} за смену — это около ${integer(needCases)} чехлов`);
      } else if (gap > 0) {
        lines.push(`🎯 До цели ${money(settings.monthly_goal)} не хватает ${money(gap)}, а смен по графику больше нет`);
      } else {
        lines.push(`🎯 Цель ${money(settings.monthly_goal)} при таком темпе будет выполнена ✅`);
      }
    }
    lines.push(`Завтра: ${nextDayText(addDays(today, 1), settings)}`);
    return lines.join("\n");
  }

  // ---------- данные ----------

  async loadSettings(userId: string): Promise<Settings> {
    const row = await this.db.one<Partial<Settings>>("settings", `user_id=eq.${userId}&select=base_pay,holiday_pay,case_price,piece_percent,schedule_start,monthly_goal`).catch(() => null);
    return normalizeSettings(row ?? DEFAULT_SETTINGS);
  }

  loadShift(userId: string, key: string): Promise<ShiftRow | null> {
    return this.db.one<ShiftRow>("shifts", `user_id=eq.${userId}&work_date=eq.${key}&select=*`);
  }

  loadMonth(userId: string, key: string): Promise<ShiftRow[]> {
    const { from, to } = monthRange(key);
    return this.db.select<ShiftRow>("shifts", `user_id=eq.${userId}&work_date=gte.${from}&work_date=lte.${to}&order=work_date.asc&select=*`);
  }

  saveShift(shift: ShiftRow) {
    return this.db.upsert("shifts", shift, "user_id,work_date");
  }

  async reply(userId: string | null, chatId: number, text: string, replyMarkup?: unknown) {
    await this.tg.sendMessage(chatId, text, replyMarkup);
    await this.logEvent(userId, chatId, "out", text);
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
