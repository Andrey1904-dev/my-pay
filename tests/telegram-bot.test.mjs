// Тесты Telegram-бота и общей логики Edge Functions.
// Запуск: node --test tests/telegram-bot.test.mjs (Node ≥ 22.18 — TypeScript исполняется напрямую).

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  parseInput, isWorkDay, summarizeMonth, dateKeyInTz, minutesInTz, money, plural, motivation,
  shiftTimeText, totalPay, buildShift, normalizeSettings, DEFAULT_SETTINGS, addDays, daysBetween,
} from "../supabase/functions/_shared/mypay.ts";
import { createBotHandler, HELP_TEXT } from "../supabase/functions/telegram-mypay/bot.ts";
import { createRemindersHandler, pickReminder } from "../supabase/functions/telegram-reminders/reminders.ts";
import { createFakeBackend, telegramRequest, messageUpdate, callbackUpdate } from "./helpers/fake-backend.mjs";

const USER = "11111111-1111-1111-1111-111111111111";
const CHAT = 111;
// Понедельник 28.09.2026, 14:30 по Екатеринбургу (UTC+5) → 09:30 UTC.
const NOW = new Date("2026-09-28T09:30:00Z");
const TODAY = "2026-09-28";

const ENV = {
  TELEGRAM_BOT_TOKEN: "123:ABC",
  TELEGRAM_WEBHOOK_SECRET: "s3cret",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

function settingsRow(over = {}) {
  return { user_id: USER, base_pay: 2627.84, holiday_pay: 4050, case_price: 1.69, piece_percent: 100, schedule_start: "2026-09-01", monthly_goal: 60000, ...over };
}

function linkedBackend(extraTables = {}) {
  return createFakeBackend({
    tables: {
      telegram_links: [{ user_id: USER, chat_id: CHAT, username: "andrey", first_name: "Андрей", linked_at: "2026-09-01T00:00:00Z", last_seen_at: "2026-09-01T00:00:00Z" }],
      settings: [settingsRow()],
      ...extraTables,
    },
  });
}

function makeBot(backend, { env = ENV, now = NOW } = {}) {
  return createBotHandler({ env: (k) => env[k], fetch: backend.fetch, now: () => now });
}

async function send(bot, text, opts) {
  const res = await bot(telegramRequest(messageUpdate(text, opts)));
  assert.equal(res.status, 200);
  return res;
}

// ---------------------------------------------------------------- shared

describe("модель и утилиты", () => {
  test("total = ставка + чехлы × цена × процент", () => {
    const s = normalizeSettings(settingsRow());
    assert.equal(totalPay(0, false, s), 2627.84);
    assert.equal(totalPay(1000, false, s), 4317.84);
    assert.equal(totalPay(1000, true, s), 5740);
    assert.equal(totalPay(1000, false, normalizeSettings(settingsRow({ piece_percent: 50 }))), 3472.84);
  });

  test("normalizeSettings подставляет дефолты вместо мусора", () => {
    const s = normalizeSettings({ base_pay: "abc", case_price: -1, schedule_start: "не дата", monthly_goal: null });
    assert.equal(s.base_pay, DEFAULT_SETTINGS.base_pay);
    assert.equal(s.case_price, DEFAULT_SETTINGS.case_price);
    assert.equal(s.schedule_start, null);
    assert.equal(s.monthly_goal, DEFAULT_SETTINGS.monthly_goal);
    assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
  });

  test("buildShift ограничивает чехлы и считает поля", () => {
    const s = normalizeSettings(settingsRow());
    const sh = buildShift(USER, TODAY, 350.6, false, s);
    assert.equal(sh.cases, 351);
    assert.equal(sh.piece_pay, 593.19);
    assert.equal(sh.total_pay, 3221.03);
    assert.equal(buildShift(USER, TODAY, -5, false, s).cases, 0);
    assert.equal(buildShift(USER, TODAY, 1e9, false, s).cases, 20000);
  });

  test("график 2/2 отсчитывается от schedule_start", () => {
    const s = normalizeSettings(settingsRow({ schedule_start: "2026-09-01" }));
    assert.equal(isWorkDay("2026-09-01", s), true);
    assert.equal(isWorkDay("2026-09-02", s), true);
    assert.equal(isWorkDay("2026-09-03", s), false);
    assert.equal(isWorkDay("2026-09-04", s), false);
    assert.equal(isWorkDay("2026-09-05", s), true);
    assert.equal(isWorkDay("2026-08-31", s), false); // до старта: −1 → индекс 3
    assert.equal(isWorkDay("2026-08-30", s), false);
    assert.equal(isWorkDay("2026-08-29", s), true);
    assert.equal(isWorkDay("2026-09-05", normalizeSettings(settingsRow({ schedule_start: null }))), null);
  });

  test("даты: зона Екатеринбурга, сдвиг и разница", () => {
    assert.equal(dateKeyInTz(new Date("2026-09-28T20:30:00Z")), "2026-09-29"); // 01:30 следующего дня по Екб
    assert.equal(dateKeyInTz(NOW), TODAY);
    assert.equal(minutesInTz(NOW), 14 * 60 + 30);
    assert.equal(addDays("2026-09-30", 1), "2026-10-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(daysBetween("2026-09-01", "2026-09-28"), 27);
  });

  test("summarizeMonth: прогноз учитывает оставшиеся смены по графику", () => {
    const s = normalizeSettings(settingsRow({ schedule_start: "2026-09-01" }));
    const rows = [
      buildShift(USER, "2026-09-25", 1000, false, s),
      buildShift(USER, "2026-09-26", 1200, false, s),
    ];
    const sum = summarizeMonth(rows, TODAY, s);
    assert.equal(sum.shifts, 2);
    assert.equal(sum.cases, 2200);
    assert.equal(sum.total, 8973.68);
    assert.equal(sum.avg, 4486.84);
    assert.equal(sum.best.work_date, "2026-09-26");
    // 28.09 — выходной по графику (индекс 27 % 4 = 3), 29 и 30 — рабочие.
    assert.equal(sum.remainingWorkDays, 2);
    assert.equal(sum.forecast, 8973.68 + 2 * 4486.84);
    assert.equal(sum.goalPercent, 15);
    assert.equal(summarizeMonth([], TODAY, s).forecast, null);
  });

  test("форматирование денег и склонения", () => {
    assert.equal(money(2627.84).replace(/\u00a0/g, " "), "2 627,84 ₽");
    assert.equal(money(1690).replace(/\u00a0/g, " "), "1 690 ₽");
    assert.equal(money(30014.4).replace(/\u00a0/g, " "), "30 014,40 ₽");
    assert.equal(plural(1, "смена", "смены", "смен"), "смена");
    assert.equal(plural(3, "смена", "смены", "смен"), "смены");
    assert.equal(plural(11, "смена", "смены", "смен"), "смен");
    assert.equal(plural(21, "чехол", "чехла", "чехлов"), "чехол");
  });

  test("мотивация по уровням и время до конца смены", () => {
    assert.match(motivation(0), /Начнём/);
    assert.match(motivation(299), /Разгон/);
    assert.match(motivation(799), /Хороший темп/);
    assert.match(motivation(1199), /Уверенная/);
    assert.match(motivation(1799), /Мощно/);
    assert.match(motivation(1800), /Ударная/);
    assert.equal(shiftTimeText(7 * 60), "⏱ Смена начнётся через 1 ч (в 08:00)");
    assert.equal(shiftTimeText(14 * 60 + 30), "⏱ До конца смены 4 ч 30 мин (до 19:00)");
    assert.equal(shiftTimeText(19 * 60), "🏁 Смена завершена — отличная работа");
  });
});

describe("разбор ввода", () => {
  test("числа, суммы и слова-паразиты", () => {
    assert.deepEqual(parseInput("350"), { kind: "set", cases: 350 });
    assert.deepEqual(parseInput("350 + 500"), { kind: "set", cases: 850 });
    assert.deepEqual(parseInput("чехлы 350"), { kind: "set", cases: 350 });
    assert.deepEqual(parseInput("Упаковал 1200 чехлов"), { kind: "set", cases: 1200 });
    assert.deepEqual(parseInput("+500"), { kind: "add", cases: 500 });
    assert.deepEqual(parseInput("+ 100 + 50"), { kind: "add", cases: 150 });
  });

  test("команды, кнопки и мусор", () => {
    assert.deepEqual(parseInput("/start ABC123"), { kind: "command", name: "start", arg: "ABC123" });
    assert.deepEqual(parseInput("/today@my_pay_bot"), { kind: "command", name: "today", arg: "" });
    assert.deepEqual(parseInput("Сегодня"), { kind: "command", name: "today", arg: "" });
    assert.deepEqual(parseInput("Отменить"), { kind: "command", name: "undo", arg: "" });
    assert.deepEqual(parseInput("привет"), { kind: "unknown" });
    assert.deepEqual(parseInput("0"), { kind: "unknown" });
    assert.deepEqual(parseInput("-100"), { kind: "unknown" });
    assert.deepEqual(parseInput("999999"), { kind: "unknown" });
    assert.deepEqual(parseInput(""), { kind: "unknown" });
  });
});

// ---------------------------------------------------------------- webhook

describe("вебхук: доступ и окружение", () => {
  test("GET отвечает статусом сервиса", async () => {
    const backend = linkedBackend();
    const res = await makeBot(backend)(telegramRequest(null, { method: "GET" }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: "telegram-mypay" });
  });

  test("неверный секрет → 401, без секрета в окружении → 500", async () => {
    const backend = linkedBackend();
    assert.equal((await makeBot(backend)(telegramRequest(messageUpdate("350"), { secret: "wrong" }))).status, 401);
    const noSecret = makeBot(backend, { env: { ...ENV, TELEGRAM_WEBHOOK_SECRET: undefined } });
    assert.equal((await noSecret(telegramRequest(messageUpdate("350")))).status, 500);
    assert.equal(backend.telegramCalls.length, 0);
  });

  test("битый JSON → 400, групповые чаты игнорируются", async () => {
    const backend = linkedBackend();
    const bot = makeBot(backend);
    const bad = new Request("https://x/telegram-mypay", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "s3cret" }, body: "{oops" });
    assert.equal((await bot(bad)).status, 400);
    await send(bot, "350", { type: "supergroup" });
    assert.equal(backend.telegramCalls.length, 0);
  });
});

describe("привязка аккаунта", () => {
  test("непривязанный чат получает инструкцию", async () => {
    const backend = createFakeBackend();
    await send(makeBot(backend), "350");
    assert.equal(backend.sent().length, 1);
    assert.match(backend.lastText(), /привяжи аккаунт/i);
    assert.equal(backend.db.shifts?.length ?? 0, 0);
  });

  test("/start КОД привязывает, удаляет код и включает напоминания", async () => {
    const backend = createFakeBackend({
      tables: {
        telegram_link_codes: [{ code: "ABC123", user_id: USER, expires_at: "2026-09-28T10:00:00Z" }],
        settings: [settingsRow()],
      },
    });
    await send(makeBot(backend), "/start abc123");
    assert.equal(backend.db.telegram_links.length, 1);
    assert.equal(backend.db.telegram_links[0].user_id, USER);
    assert.equal(backend.db.telegram_links[0].chat_id, CHAT);
    assert.equal(backend.db.telegram_links[0].username, "andrey");
    assert.equal(backend.db.telegram_link_codes.length, 0);
    assert.equal(backend.db.telegram_preferences[0].enabled, true);
    const msg = backend.sent().at(-1);
    assert.match(msg.text, /Готово, Андрей/);
    assert.equal(msg.reply_markup.keyboard[0][0].text, "+100");
  });

  test("просроченный или чужой код отклоняется", async () => {
    const backend = createFakeBackend({
      tables: { telegram_link_codes: [{ code: "OLD111", user_id: USER, expires_at: "2026-09-28T09:00:00Z" }] },
    });
    await send(makeBot(backend), "/start OLD111");
    assert.equal(backend.db.telegram_links?.length ?? 0, 0);
    assert.match(backend.lastText(), /не найден или уже истёк/);
  });

  test("повторная привязка переносит чат на новый аккаунт", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    const backend = linkedBackend({ telegram_link_codes: [{ code: "NEW222", user_id: OTHER, expires_at: "2026-09-28T10:00:00Z" }] });
    await send(makeBot(backend), "/start NEW222");
    assert.equal(backend.db.telegram_links.length, 1);
    assert.equal(backend.db.telegram_links[0].user_id, OTHER);
  });

  test("/unlink удаляет связь и снимает клавиатуру", async () => {
    const backend = linkedBackend({ telegram_preferences: [{ user_id: USER, chat_id: CHAT, enabled: true, reminder_hour: 21 }] });
    await send(makeBot(backend), "/unlink");
    assert.equal(backend.db.telegram_links.length, 0);
    assert.equal(backend.db.telegram_preferences.length, 0);
    assert.deepEqual(backend.sent().at(-1).reply_markup, { remove_keyboard: true });
  });
});

describe("ввод чехлов", () => {
  let backend, bot;
  beforeEach(() => {
    backend = linkedBackend();
    bot = makeBot(backend);
  });

  test("число в пустой день создаёт смену и запись для отмены", async () => {
    await send(bot, "350");
    const shift = backend.db.shifts[0];
    assert.equal(shift.work_date, TODAY);
    assert.equal(shift.cases, 350);
    assert.equal(shift.base_pay, 2627.84);
    assert.equal(shift.piece_pay, 591.5);
    assert.equal(shift.total_pay, 3219.34);
    assert.equal(shift.is_holiday, false);
    assert.equal(backend.db.telegram_entries.length, 1);
    assert.equal(backend.db.telegram_entries[0].cases, 350);
    const text = backend.lastText().replace(/\u00a0/g, " ");
    assert.match(text, /Сегодня упаковано: <b>350<\/b> чехлов \(\+350\)/);
    assert.match(text, /3 219,34 ₽/);
    assert.match(text, /До конца смены 4 ч 30 мин/);
    assert.match(text, /Хороший темп/);
  });

  test("+500 прибавляет к текущему значению", async () => {
    await send(bot, "350");
    await send(bot, "+500");
    assert.equal(backend.db.shifts.length, 1);
    assert.equal(backend.db.shifts[0].cases, 850);
    assert.equal(backend.db.telegram_entries.map((e) => e.cases).join(","), "350,500");
    assert.match(backend.lastText(), /\(\+500\)/);
  });

  test("«чехлы 350» и «350 + 500» понимаются как ввод", async () => {
    await send(bot, "чехлы 350");
    assert.equal(backend.db.shifts[0].cases, 350);
    await send(bot, "+ 100 + 50");
    assert.equal(backend.db.shifts[0].cases, 500);
  });

  test("число при уже внесённой смене спрашивает: добавить или заменить", async () => {
    await send(bot, "850");
    await send(bot, "900");
    assert.equal(backend.db.shifts[0].cases, 850, "смена не меняется до ответа");
    const pending = backend.db.telegram_pending_inputs[0];
    assert.equal(pending.cases, 900);
    assert.equal(pending.chat_id, CHAT);
    const msg = backend.sent().at(-1);
    assert.match(msg.text, /уже внесено <b>850<\/b>/);
    const buttons = msg.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    assert.deepEqual(buttons, ["add", "set", "cancel"]);
    assert.match(msg.reply_markup.inline_keyboard[0][0].text.replace(/\u00a0/g, " "), /1 750/);
  });

  test("callback «add» прибавляет, «set» заменяет, «cancel» ничего не меняет", async () => {
    await send(bot, "850");
    await send(bot, "900");
    await bot(telegramRequest(callbackUpdate("add")));
    assert.equal(backend.db.shifts[0].cases, 1750);
    assert.equal(backend.db.telegram_pending_inputs.length, 0);
    assert.equal(backend.telegramCalls.filter((c) => c.method === "answerCallbackQuery").length, 1);
    assert.match(backend.lastText(), /<b>1[\s\u00a0]750<\/b>/);

    await send(bot, "600");
    await bot(telegramRequest(callbackUpdate("set")));
    assert.equal(backend.db.shifts[0].cases, 600);
    assert.match(backend.lastText(), /\(−1[\s\u00a0]150\)/);

    await send(bot, "999");
    await bot(telegramRequest(callbackUpdate("cancel")));
    assert.equal(backend.db.shifts[0].cases, 600);
    assert.equal(backend.db.telegram_pending_inputs.length, 0);
    assert.match(backend.lastText(), /Отменено/);
  });

  test("просроченный callback не меняет смену", async () => {
    await send(bot, "850");
    await send(bot, "900");
    const late = makeBot(backend, { now: new Date(NOW.getTime() + 20 * 60000) });
    await late(telegramRequest(callbackUpdate("add")));
    assert.equal(backend.db.shifts[0].cases, 850);
    assert.match(backend.lastText(), /устарел/);
  });

  test("/undo снимает последнее добавление, повторно — нечего отменять", async () => {
    await send(bot, "350");
    await send(bot, "+500");
    await send(bot, "/undo");
    assert.equal(backend.db.shifts[0].cases, 350);
    assert.equal(backend.db.telegram_entries.length, 1);
    assert.match(backend.lastText(), /Отменил последнее добавление \(−500\)/);
    await send(bot, "Отменить");
    assert.equal(backend.db.shifts[0].cases, 0);
    await send(bot, "/undo");
    assert.match(backend.lastText(), /Нечего отменять/);
  });

  test("/holiday переключает праздничную ставку", async () => {
    await send(bot, "1000");
    await send(bot, "/holiday");
    assert.equal(backend.db.shifts[0].is_holiday, true);
    assert.equal(backend.db.shifts[0].base_pay, 4050);
    assert.equal(backend.db.shifts[0].total_pay, 5740);
    await send(bot, "/holiday");
    assert.equal(backend.db.shifts[0].is_holiday, false);
    assert.equal(backend.db.shifts[0].total_pay, 4317.84);
  });

  test("праздничный флаг сохраняется при добавлении чехлов", async () => {
    await send(bot, "/holiday");
    await send(bot, "+200");
    assert.equal(backend.db.shifts[0].is_holiday, true);
    assert.equal(backend.db.shifts[0].cases, 200);
  });

  test("настройки пользователя влияют на расчёт", async () => {
    backend.db.settings[0].case_price = 2;
    backend.db.settings[0].piece_percent = 50;
    backend.db.settings[0].base_pay = 3000;
    await send(bot, "1000");
    assert.equal(backend.db.shifts[0].total_pay, 4000);
  });

  test("все входящие и исходящие сообщения журналируются", async () => {
    await send(bot, "350");
    const events = backend.db.telegram_bot_events;
    assert.deepEqual(events.map((e) => e.direction), ["in", "out"]);
    assert.equal(events[0].message, "350");
    assert.equal(events[0].user_id, USER);
    assert.ok(new Date(backend.db.telegram_links[0].last_seen_at) >= NOW);
  });

  test("непонятный текст → подсказка без изменений в базе", async () => {
    await send(bot, "привет бот");
    assert.equal(backend.db.shifts?.length ?? 0, 0);
    assert.match(backend.lastText(), /Не понял/);
  });
});

describe("отчёты", () => {
  let backend, bot;
  beforeEach(() => {
    const s = normalizeSettings(settingsRow());
    backend = linkedBackend({
      shifts: [
        buildShift(USER, "2026-09-25", 1000, false, s),
        buildShift(USER, "2026-09-26", 1200, false, s),
        buildShift(USER, "2026-08-30", 900, false, s),
      ],
    });
    bot = makeBot(backend);
  });

  test("/today без смены: график и приглашение", async () => {
    await send(bot, "/today");
    const t = backend.lastText();
    assert.match(t, /Понедельник, 28 сентября/);
    assert.match(t, /выходной/);
    assert.match(t, /ещё не внесена/);
  });

  test("/today со сменой показывает разбивку", async () => {
    await send(bot, "500");
    await send(bot, "Сегодня");
    const t = backend.lastText().replace(/\u00a0/g, " ");
    assert.match(t, /500 чехлов/);
    assert.match(t, /3 472,84 ₽/);
    assert.match(t, /ставка 2 627,84 ₽ \+ сделка 845 ₽/);
  });

  test("/month считает только текущий месяц", async () => {
    await send(bot, "/month");
    const t = backend.lastText().replace(/\u00a0/g, " ");
    assert.match(t, /Сентябрь 2026/);
    assert.match(t, /2 смены · 2 200 чехлов/);
    assert.match(t, /Заработано: <b>8 973,68 ₽<\/b>/);
    assert.match(t, /Лучшая: 4 655,84 ₽ \(26 сентября\)/);
    assert.match(t, /Цель 60 000 ₽: 15%/);
    assert.match(t, /Прогноз месяца: 17 947,36 ₽/);
  });

  test("/forecast объясняет оставшиеся смены и цель", async () => {
    await send(bot, "Прогноз");
    const t = backend.lastText().replace(/\u00a0/g, " ");
    assert.match(t, /Впереди по графику 2\/2: 2 смены до 30 сентября/);
    assert.match(t, /≈ <b>17 947,36 ₽<\/b>/);
    assert.match(t, /нужно ≈ 25 513,16 ₽ за смену/);
    assert.match(t, /Завтра: рабочий день, начало в 08:00/);
  });

  test("/forecast без смен в месяце", async () => {
    backend.db.shifts = backend.db.shifts.filter((r) => r.work_date < "2026-09-01");
    await send(bot, "/forecast");
    assert.match(backend.lastText(), /появится после первой внесённой смены/);
  });

  test("/last показывает последнюю по дате смену", async () => {
    await send(bot, "/last");
    const t = backend.lastText().replace(/\u00a0/g, " ");
    assert.match(t, /Суббота, 26 сентября/);
    assert.match(t, /1 200 чехлов/);
  });

  test("/help, /menu и неизвестная команда", async () => {
    await send(bot, "/help");
    assert.equal(backend.lastText(), HELP_TEXT);
    await send(bot, "/menu");
    assert.equal(backend.sent().at(-1).reply_markup.keyboard.length, 3);
    await send(bot, "/wat");
    assert.match(backend.lastText(), /Не знаю команду \/wat/);
  });

  test("/notify_off и /notify_on переключают настройку", async () => {
    await send(bot, "/notify_off");
    assert.equal(backend.db.telegram_preferences[0].enabled, false);
    await send(bot, "/notify_on");
    assert.equal(backend.db.telegram_preferences.length, 1);
    assert.equal(backend.db.telegram_preferences[0].enabled, true);
    assert.equal(backend.db.telegram_preferences[0].chat_id, CHAT);
  });
});

describe("устойчивость", () => {
  test("ошибка базы → 200 и извинение пользователю (без повторной доставки)", async () => {
    const backend = linkedBackend();
    const failing = async (input, init) => {
      if (String(input).includes("/rest/v1/shifts")) return new Response("boom", { status: 500 });
      return backend.fetch(input, init);
    };
    const logged = [];
    const bot = createBotHandler({ env: (k) => ENV[k], fetch: failing, now: () => NOW, logError: (m, e) => logged.push([m, e]) });
    const res = await bot(telegramRequest(messageUpdate("350")));
    assert.equal(res.status, 200);
    assert.match(backend.lastText(), /Не получилось обработать/);
    assert.equal(logged.length, 1);
    assert.match(String(logged[0][1]), /PostgREST GET shifts/);
  });

  test("недоступный Telegram API не ломает запись смены", async () => {
    const backend = createFakeBackend({ telegramFail: true, tables: { telegram_links: [{ user_id: USER, chat_id: CHAT }], settings: [settingsRow()] } });
    const res = await makeBot(backend)(telegramRequest(messageUpdate("350")));
    assert.equal(res.status, 200);
    assert.equal(backend.db.shifts[0].cases, 350);
  });
});

// ---------------------------------------------------------------- reminders

describe("напоминания", () => {
  const s = normalizeSettings(settingsRow({ schedule_start: "2026-09-01" }));

  test("pickReminder: вечером перед рабочим днём и в 19:00 без смены", () => {
    // 28.09 выходной, 29.09 рабочий.
    assert.equal(pickReminder({ reminder_hour: 21 }, s, TODAY, 21, false)?.kind, "tomorrow");
    assert.equal(pickReminder({ reminder_hour: 21 }, s, TODAY, 20, false), null);
    assert.equal(pickReminder({ reminder_hour: 21 }, s, TODAY, 19, false), null, "сегодня выходной — не просим чехлы");
    assert.equal(pickReminder({ reminder_hour: 21 }, s, "2026-09-29", 19, false)?.kind, "enter_cases");
    assert.equal(pickReminder({ reminder_hour: 21 }, s, "2026-09-29", 19, true), null);
    assert.equal(pickReminder({ reminder_hour: 21 }, s, "2026-09-30", 21, true), null, "завтра 1 октября — выходной");
    assert.equal(pickReminder({ reminder_hour: 21 }, normalizeSettings(settingsRow({ schedule_start: null })), TODAY, 21, false), null);
  });

  test("handler: проверяет сервисный ключ и рассылает только включённым", async () => {
    const backend = createFakeBackend({
      tables: {
        telegram_preferences: [
          { user_id: USER, chat_id: CHAT, enabled: true, reminder_hour: 21 },
          { user_id: "33333333-3333-3333-3333-333333333333", chat_id: 333, enabled: false, reminder_hour: 21 },
        ],
        settings: [settingsRow()],
      },
    });
    const at21 = new Date("2026-09-28T16:05:00Z"); // 21:05 Екб
    const handler = createRemindersHandler({ env: (k) => ENV[k], fetch: backend.fetch, now: () => at21 });
    const denied = await handler(new Request("https://x/telegram-reminders", { method: "POST" }));
    assert.equal(denied.status, 401);
    const res = await handler(new Request("https://x/telegram-reminders", { method: "POST", headers: { Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}` } }));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.checked, 1);
    assert.equal(body.sent, 1);
    assert.equal(backend.sent().length, 1);
    assert.equal(backend.sent()[0].chat_id, CHAT);
    assert.match(backend.sent()[0].text, /Завтра рабочая смена: Вторник, 29 сентября/);
    assert.equal(backend.db.telegram_bot_events.length, 1);
  });
});
