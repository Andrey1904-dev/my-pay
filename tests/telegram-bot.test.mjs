// Тесты Telegram-бота и общей логики Edge Functions.
// Запуск: node --test tests/telegram-bot.test.mjs (Node ≥ 22.18 — TypeScript исполняется напрямую).

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  MAIN_KEYBOARD, parseInput, isWorkDay, summarizeMonth, dateKeyInTz, minutesInTz, money, plural, motivation,
  shiftTimeText, totalPay, buildShift, normalizeSettings, DEFAULT_SETTINGS, addDays, daysBetween,
  correctLegacyShift, piecePay, bar, calendarGrid, shiftMonthKey,
} from "../supabase/functions/_shared/mypay.ts";
import { createBotHandler, HELP_TEXT } from "../supabase/functions/telegram-mypay/bot.ts";
import { createRemindersHandler, pickReminder, pickReminders, digestText } from "../supabase/functions/telegram-reminders/reminders.ts";
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

  test("прогресс-бар, категории, календарная сетка", () => {
    assert.equal(bar(0), "▱▱▱▱▱▱▱▱▱▱");
    assert.equal(bar(0.42), "▰▰▰▰▱▱▱▱▱▱");
    assert.equal(bar(7), "▰▰▰▰▰▰▰▰▰▰");
    assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
    assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
    const s = normalizeSettings(settingsRow({ schedule_start: "2026-09-01" }));
    const grid = calendarGrid("2026-09", new Set(["2026-09-01", "2026-09-26"]), s, TODAY).split("\n");
    assert.equal(grid[0], " Пн  Вт  Ср  Чт  Пт  Сб  Вс ");
    assert.equal(grid[1], "      1▪  2·  3   4   5·  6·", "▪ внесена, · по графику, пусто — выходной");
    assert.equal(grid[5], "▸28  29· 30·", "▸ сегодня");
    assert.ok(grid.every((l) => l.length <= 28));
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
    assert.deepEqual(msg.reply_markup, MAIN_KEYBOARD);
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

  test("/unlink удаляет связь и сохраняет основную клавиатуру", async () => {
    const backend = linkedBackend({ telegram_preferences: [{ user_id: USER, chat_id: CHAT, enabled: true, reminder_hour: 21 }] });
    await send(makeBot(backend), "/unlink");
    assert.equal(backend.db.telegram_links.length, 0);
    assert.equal(backend.db.telegram_preferences.length, 0);
    assert.deepEqual(backend.sent().at(-1).reply_markup, MAIN_KEYBOARD);
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
    assert.match(t, /Пн, 28 сентября/);
    assert.match(t, /выходной/);
    assert.match(t, /ещё не внесена/);
  });

  test("/today со сменой показывает разбивку", async () => {
    await send(bot, "500");
    await send(bot, "Сегодня");
    const t = backend.lastText().replace(/\u00a0/g, " ");
    assert.match(t, /<b>500<\/b> чехлов/);
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
    assert.match(t, /Прогноз месяца: 17 947,36 ₽/);
  });

  test("/forecast объясняет оставшиеся смены", async () => {
    await send(bot, "Прогноз");
    const t = backend.lastText().replace(/\u00a0/g, " ");
    assert.match(t, /Впереди по графику 2\/2: 2 смены до 30 сентября/);
    assert.match(t, /≈ <b>17 947,36 ₽<\/b>/);
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
    assert.deepEqual(backend.sent().at(-1).reply_markup, MAIN_KEYBOARD);
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

  test("напоминание в 19:00 — без кнопок; в последний день месяца — итоги", () => {
    const enter = pickReminders({ reminder_hour: 21 }, s, "2026-09-29", 19, false);
    assert.equal(enter.length, 1);
    assert.equal(enter[0].markup, undefined);
    const rows = [buildShift(USER, "2026-09-25", 1000, false, s), buildShift(USER, "2026-09-26", 1200, false, s)];
    const summary = summarizeMonth(rows, "2026-09-30", s);
    // 30.09 — рабочий, 1.10 — выходной по графику: только итоги месяца.
    const last = pickReminders({ reminder_hour: 21 }, s, "2026-09-30", 21, true, summary);
    assert.deepEqual(last.map((r) => r.kind), ["month_digest"]);
    assert.match(last[0].text.replace(/\u00a0/g, " "), /Итоги месяца — Сентябрь 2026[\s\S]*<b>8 973,68 ₽<\/b> за 2 смены · 2 200 чехлов/);
    assert.equal(last[0].markup, undefined);
    assert.equal(pickReminders({ reminder_hour: 21 }, s, "2026-09-30", 21, true, summarizeMonth([], "2026-09-30", s)).length, 0, "без смен итогов нет");
    // Вечер перед рабочим днём с прогрессом месяца.
    const eve = pickReminder({ reminder_hour: 21 }, s, TODAY, 21, false, summarizeMonth(rows, TODAY, s));
    assert.match(eve.text.replace(/\u00a0/g, " "), /Завтра рабочая смена: Вторник, 29 сентября, 08:00–19:00[\s\S]*уже 2 смены · <b>8 973,68 ₽<\/b>/);
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


describe('итог за смену без inline-действий', () => {
  test('новая смена, замена 1200 на 500 и повтор того же числа', async () => {
    const b = linkedBackend(); const bot = makeBot(b);
    await send(bot, '1200');
    assert.equal(b.db.shifts[0].cases, 1200);
    assert.equal(b.db.shifts[0].total_pay, 4655.84);
    assert.match(b.lastText(), /✅ Смена сохранена!/);
    await send(bot, '500');
    assert.equal(b.db.shifts.length, 1);
    assert.equal(b.db.shifts[0].cases, 500);
    assert.equal(b.db.shifts[0].total_pay, 3472.84);
    assert.match(b.lastText(), /✅ Информация обновлена!/);
    const old = structuredClone(b.db.shifts);
    await send(bot, '500');
    assert.deepEqual(b.db.shifts, old);
    assert.match(b.lastText(), /✅ Данные уже актуальны!/);
    assert.equal(b.sent().length, 3);
    for (const msg of b.sent()) {
      assert.deepEqual(msg.reply_markup, MAIN_KEYBOARD);
      assert.doesNotMatch(msg.text, /Упаковано:|ставка|Темп:/);
      assert.equal(msg.text.split('\n\n').length, 3);
    }
  });

  test('все границы ввода и запрет выражений', () => {
    for (const [text, cases] of [['0',0],['500',500],['1 250',1250],['1\u00a0250',1250],['20 000',20000]]) {
      assert.deepEqual(parseInput(text), { kind:'set', cases, date:null });
    }
    for (const text of ['-1','1.5','1,5','NaN','Infinity','+500','1+2','1e3','12 50','20001','99999999999999999999','вчера 500','500 чехлов','alert(1)']) {
      assert.equal(parseInput(text).kind, 'unknown', text);
    }
  });

  test('дата Екб, выходной, чужие смены и история', async () => {
    const other = buildShift('other', TODAY, 999, false, normalizeSettings(settingsRow()));
    const historical = buildShift(USER, '2025-01-01', 777, true, normalizeSettings(settingsRow()));
    const b = linkedBackend({ shifts:[other, historical] });
    await send(makeBot(b), '1250');
    assert.deepEqual(b.db.shifts.slice(0,2), [other, historical]);
    assert.equal(b.db.shifts[2].work_date, TODAY); // rest day is allowed
    await send(makeBot(b, { now:new Date('2026-09-28T19:01:00Z') }), '0');
    assert.equal(b.db.shifts[3].work_date, '2026-09-29');
    assert.equal(b.db.shifts[3].cases, 0);
  });

  test('праздник, премия и исторический тариф сохраняются, в том числе через ноль', async () => {
    const sh = { ...buildShift(USER,TODAY,1000,true,normalizeSettings(settingsRow())), total_pay:6040, updated_at:'v1' };
    const b = linkedBackend({ shifts:[sh] }); const bot = makeBot(b);
    await send(bot,'1500');
    assert.equal(b.db.shifts[0].total_pay,6885);
    Object.assign(b.db.settings[0], { case_price:8, piece_percent:100, base_pay:9000 });
    await send(bot,'0');
    assert.equal(b.db.shifts[0].total_pay,4350);
    await send(bot,'500');
    assert.equal(b.db.shifts[0].total_pay,5195);
    assert.equal(b.db.shifts[0].is_holiday,true);
  });

  test('задержанный повтор update не откатывает более новое число', async () => {
    const b = linkedBackend(); const bot = makeBot(b);
    const first = messageUpdate('1200');
    await bot(telegramRequest(first));
    await send(bot,'500');
    const version = b.db.shifts[0].updated_at;
    await bot(telegramRequest(first));
    assert.equal(b.db.shifts[0].cases,500);
    assert.equal(b.db.shifts[0].updated_at,version);
    assert.equal(b.sent().length,2);
  });

  test('конфликт после чтения не перезаписывает PWA', async () => {
    const b = linkedBackend(); await send(makeBot(b),'500');
    const wrapped = { ...b, fetch:async (url,init) => {
      if (String(url).endsWith('/rpc/telegram_save_daily_total')) Object.assign(b.db.shifts[0],{ cases:900,updated_at:'pwa-new-version' });
      return b.fetch(url,init);
    } };
    await send(makeBot(wrapped),'700');
    assert.equal(b.db.shifts[0].cases,900);
    assert.match(b.lastText(),/Ничего не перезаписано/);
  });

  test('ошибки записи и настроек не уничтожают сохранённую смену и не дают успех', async () => {
    for (const part of ['/rpc/telegram_save_daily_total','/rest/v1/settings']) {
      const b = linkedBackend(); await send(makeBot(b),'500'); const saved = structuredClone(b.db.shifts);
      const bot = createBotHandler({ env:k=>ENV[k], now:()=>NOW, logError:()=>{}, fetch:(url,init) => String(url).includes(part) ? new Response('error',{status:500}) : b.fetch(url,init) });
      await send(bot,'700');
      assert.deepEqual(b.db.shifts,saved);
      assert.match(b.lastText(),/Не получилось обработать/);
      assert.doesNotMatch(b.lastText(),/✅/);
    }
  });

  test('старые callback, undo и holiday не меняют данные; все команды с одной основной клавиатурой', async () => {
    const b = linkedBackend(); const bot = makeBot(b); await send(bot,'500');
    const saved = structuredClone(b.db.shifts);
    for (const data of ['q:500','add','set','holiday','undo','n:toggle','h:next']) await bot(telegramRequest(callbackUpdate(data)));
    for (const cmd of ['/start','/help','/menu','/today','/month','/forecast','/calendar','/settings','/last','/undo','/holiday','/notify_off','/notify_on']) await send(bot,cmd);
    assert.deepEqual(b.db.shifts,saved);
    for (const msg of b.sent()) assert.deepEqual(msg.reply_markup,MAIN_KEYBOARD);
    assert.ok(b.telegramCalls.some(c=>c.method==='setMyCommands'));
  });

  test('повтор cron не дублирует уведомление; внесённая смена подавляет напоминание', async () => {
    const b = linkedBackend({ telegram_preferences:[{user_id:USER,chat_id:CHAT,enabled:true,reminder_hour:21}] });
    const now = new Date('2026-09-29T14:05:00Z');
    const h = createRemindersHandler({env:k=>ENV[k],fetch:b.fetch,now:()=>now});
    const req = () => new Request('https://x/reminders',{method:'POST',headers:{authorization:`Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`}});
    await h(req()); await h(req());
    assert.equal(b.sent().length,1);
    assert.deepEqual(b.sent()[0].reply_markup,MAIN_KEYBOARD);
    assert.match(b.lastText(),/Смена закончилась/);
    const saved = linkedBackend({ telegram_preferences:[{user_id:USER,chat_id:CHAT,enabled:true,reminder_hour:21}], shifts:[buildShift(USER,'2026-09-29',0,false,normalizeSettings(settingsRow()))] });
    await createRemindersHandler({env:k=>ENV[k],fetch:saved.fetch,now:()=>now})(req());
    assert.equal(saved.sent().length,0);
  });
});

describe('основная клавиатура и восстановленные разделы', () => {
  test('строго 2×3 кнопки, правильный порядок и настройки Telegram', () => {
    assert.deepEqual(MAIN_KEYBOARD, {
      keyboard:[[{text:'📦 Сегодня'},{text:'📊 Месяц'},{text:'🔮 Прогноз'}],[{text:'📅 Календарь'},{text:'💸 Расходы'},{text:'⚙️ Ещё'}]],
      resize_keyboard:true,one_time_keyboard:false,is_persistent:true,
    });
    for (const [text,name] of [['📦 Сегодня','today'],['📊 Месяц','month'],['🔮 Прогноз','forecast'],['📅 Календарь','calendar'],['💸 Расходы','spent'],['⚙️ Ещё','settings']]) assert.deepEqual(parseInput(text),{kind:'command',name,arg:''});
    assert.equal(parseInput('500').kind,'set');
  });

  test('все шесть кнопок открывают свой раздел одним сообщением и не меняют смену/финансы', async () => {
    const b=linkedBackend({user_app_data:[{user_id:USER,payload:{transactions:[{id:'old',type:'expense',date:TODAY,amount:350,category:'Еда',note:'Обед'}],custom:{keep:true}},updated_at:'2026-09-28T00:00:00Z'}]});
    const bot=makeBot(b); await send(bot,'1200');
    const shifts=structuredClone(b.db.shifts),finance=structuredClone(b.db.user_app_data);
    for (const [text,pattern] of [['📦 Сегодня',/Сегодня · Пн, 28 сентября/],['📊 Месяц',/Средняя смена:/],['🔮 Прогноз',/Уже заработано:[\s\S]*итог составит/],['📅 Календарь',/<pre>/],['💸 Расходы',/Потрачено:[\s\S]*350/],['⚙️ Ещё',/Настройки[\s\S]*\/help/]]) {
      const before=b.sent().length;
      await send(bot,text);
      assert.equal(b.sent().length,before+1,text);
      assert.match(b.lastText(),pattern);
      assert.deepEqual(b.sent().at(-1).reply_markup,MAIN_KEYBOARD);
    }
    assert.deepEqual(b.db.shifts,shifts);
    assert.deepEqual(b.db.user_app_data,finance);
  });

  test('/start и первое сохранение восстанавливают клавиатуру без лишних сообщений', async () => {
    for (const text of ['/start','1250']) {
      const b=linkedBackend(); await send(makeBot(b),text);
      assert.equal(b.sent().length,1);
      assert.deepEqual(b.sent()[0].reply_markup,MAIN_KEYBOARD);
      assert.equal(b.sent()[0].reply_markup.inline_keyboard,undefined);
      assert.equal(b.sent()[0].reply_markup.remove_keyboard,undefined);
    }
  });

  test('календарь перелистывает существующую сетку, редактируя исходное сообщение', async () => {
    const b=linkedBackend();const bot=makeBot(b);
    await send(bot,'📅 Календарь');
    assert.match(b.lastText(),/\/cal_2026_08 · \/calendar · \/cal_2026_10/);
    await send(bot,'/cal_2026_08'); assert.match(b.lastText(),/Август 2026/);
    await send(bot,'/cal_2026_10'); assert.match(b.lastText(),/Октябрь 2026/);
    const sends=b.sent().length;
    await bot(telegramRequest(callbackUpdate('cal:2026-08',{messageId:77})));
    const edit=b.telegramCalls.filter(c=>c.method==='editMessageText').at(-1).payload;
    assert.equal(edit.message_id,77);assert.match(edit.text,/Август 2026/);
    assert.equal(edit.reply_markup.inline_keyboard[0][2].callback_data,'cal:2026-09');
    await bot(telegramRequest(callbackUpdate('v:calendar',{messageId:77})));
    assert.match(b.lastText(),/Сентябрь 2026/);
    assert.equal(b.sent().length,sends);
    for(const invalid of ['cal:2026-99','cal:0000-00','cal:9999-12','q:500']) await bot(telegramRequest(callbackUpdate(invalid)));
    assert.equal(b.db.shifts?.length??0,0);
  });

  test('расходы восстановлены из прежнего payload; явные команды не конфликтуют с количеством', async () => {
    const payload={transactions:[{id:'old',type:'expense',date:TODAY,amount:100,category:'Еда',note:'Завтрак'}],categories:[{id:'food',name:'Еда',emoji:'🍔',limit:1000}],accounts:[{id:'cash',name:'Наличные',type:'cash',balance:500}],goals:[{id:'keep'}],custom:{untouched:true}};
    const b=linkedBackend({user_app_data:[{user_id:USER,payload,updated_at:'2026-09-28T00:00:00Z'}]});const bot=makeBot(b);
    const update=messageUpdate('/expense 350 обед'); update.update_id=123456;
    await bot(telegramRequest(update));
    assert.match(b.lastText(),/Записал расход/);
    assert.equal(b.db.user_app_data[0].payload.transactions.length,2);
    assert.equal(b.db.shifts?.length??0,0);
    const sends=b.sent().length;
    await bot(telegramRequest(update));assert.equal(b.sent().length,sends);
    await send(bot,'500');assert.equal(b.db.shifts[0].cases,500);
    await send(bot,'💸 Расходы');assert.match(b.lastText(),/450/);
    await send(bot,'/delete_expense tg_update_123456');
    assert.equal(b.db.user_app_data[0].payload.transactions.length,1);
    await bot(telegramRequest(update));
    assert.equal(b.db.user_app_data[0].payload.transactions.length,1,'replay after deletion cannot recreate expense');
    assert.deepEqual(b.db.user_app_data[0].payload.accounts,payload.accounts);
    assert.deepEqual(b.db.user_app_data[0].payload.goals,payload.goals);
    assert.deepEqual(b.db.user_app_data[0].payload.custom,payload.custom);
    await send(bot,'/income 1000 подарок');
    assert.equal(b.db.user_app_data[0].payload.transactions.at(-1).type,'income');
    for(const alias of ['/spent','/expenses','/finance']) { await send(bot,alias);assert.match(b.lastText(),/Расходы ·/); }
  });

  test('финансовый конфликт и ошибка сохранения не перезаписывают данные и не дают успех', async () => {
    for(const fail of [false,true]) {
      const b=linkedBackend({user_app_data:[{user_id:USER,payload:{transactions:[],custom:'keep'},updated_at:'2026-09-28T00:00:00Z'}]});
      const bot=createBotHandler({env:k=>ENV[k],now:()=>NOW,logError:()=>{},fetch:(url,init)=>{
        if(String(url).includes('/rest/v1/user_app_data')&&init?.method==='PATCH') {
          if(fail)return Promise.resolve(new Response('error',{status:500}));
          b.db.user_app_data[0].updated_at='2026-09-28T12:00:00Z';
        }
        return b.fetch(url,init);
      }});
      await send(bot,'/expense 350 обед');
      assert.equal(b.db.user_app_data[0].payload.transactions.length,0);
      assert.doesNotMatch(b.lastText(),/Записал расход/);
      assert.match(b.lastText(),fail?/Не получилось/:/Ничего не перезаписано/);
    }
  });

  test('расходы чужого аккаунта нельзя просмотреть или удалить; HTML экранируется', async () => {
    const b=linkedBackend({user_app_data:[{user_id:'other',payload:{transactions:[{id:'secret',type:'expense',date:TODAY,amount:999,note:'secret'}]}},{user_id:USER,payload:{transactions:[{id:'own',type:'expense',date:TODAY,amount:10,category:'<b>еда</b>',note:'<i>заметка</i>'}]}}]});const bot=makeBot(b);
    await send(bot,'💸 Расходы');assert.doesNotMatch(b.lastText(),/secret/);assert.match(b.lastText(),/&lt;b&gt;/);
    await send(bot,'/delete_expense secret');assert.match(b.lastText(),/не найдена/);
    assert.equal(b.db.user_app_data[0].payload.transactions.length,1);
  });
});
