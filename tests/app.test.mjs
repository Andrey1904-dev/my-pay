// Тесты функционального PWA в jsdom: настоящий app.html + script.js (локальный режим без Supabase).
// Запуск: node --test tests/app.test.mjs

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadApp, key, addDays, tick } from "./helpers/load-app.mjs";

const apps = [];
function open(opts) {
  const app = loadApp(opts);
  apps.push(app);
  return app;
}
afterEach(() => {
  while (apps.length) apps.pop().close();
});

const TODAY = key();
const norm = (s) => s.replace(/\u00a0/g, " ");
// Объекты из окна jsdom живут в другом realm — сравниваем через JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

// Смены текущего месяца по графику 2/2 с 1-го числа (для сидов).
function seedMonth(cases = [1000, 1200, 900, 1500]) {
  const shifts = {};
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  let i = 0;
  for (let d = new Date(start); d < now && i < cases.length; d.setDate(d.getDate() + 1)) {
    const diff = Math.round((d - start) / 86400000);
    if (diff % 4 >= 2) continue;
    const c = cases[i++];
    shifts[key(d)] = { cases: c, holiday: false, base: 2627.84, piece: c * 1.69, total: 2627.84 + c * 1.69 };
  }
  return { shifts, scheduleStart: key(start) };
}

describe("загрузка и модель", () => {
  test("приложение стартует без ошибок и публикует API", () => {
    const app = open();
    assert.deepEqual(app.errors, []);
    assert.equal(app.MyPay.version, "1.11");
    assert.equal(app.text("appVersion"), "V1.11");
    assert.equal(app.text("brandVersion"), "V1.11", "версия в шапке рядом с названием");
    assert.match(app.text("brandVersion").trim(), /^V\d+(\.\d+)+$/);
    assert.equal(app.MyPay.cloudAvailable, false, "без SDK — локальный режим");
    assert.match(app.text("cloudNotice"), /локальном режиме/);
    assert.ok(app.$("logoutBtn").classList.contains("hidden"), "кнопка выхода скрыта без аккаунта");
  });

  test("версия одинакова в script.js, sw.js, app.html и package.json", async () => {
    const fs = await import("node:fs");
    const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const v = read("src/app/config.js").match(/const APP_VERSION = "([\d.]+)"/)[1];
    assert.match(read("sw.js"), new RegExp(`CACHE_NAME\\s*=\\s*"my-pay-v${v.replace(".", "\\.")}"`));
    assert.match(read("index.html"), new RegExp(`script\\.js\\?v=${v.replace(".", "\\.")}"`));
    assert.match(read("sw.js"), new RegExp(`style\\.css\\?v=${v.replace(".", "\\.")}"`));
    assert.match(read("index.html"), new RegExp(`id="brandVersion">V${v.replace(".", "\\.")}<`));
    assert.equal(v, "1.11");
    assert.equal(JSON.parse(read("package.json")).version, "1.1.1");
    const lock = JSON.parse(read("package-lock.json"));
    assert.equal(lock.version, "1.1.1");
    assert.equal(lock.packages[""].version, "1.1.1");

  });

  test("дефолты и формула: ставка + чехлы × цена × процент", () => {
    const { MyPay } = open();
    // (выход 1900 + обед 200) × 1,15 = 2415; сделка 7 × 25% = 1,75 за чехол
    assert.equal(MyPay.DEFAULTS.basePay, 2415);
    assert.equal(MyPay.DEFAULTS.holidayPay, 4600);
    assert.equal(MyPay.DEFAULTS.casePrice, 7);
    assert.equal(MyPay.DEFAULTS.percent, 25);
    assert.equal(MyPay.total(0, false), 2415);
    // 1000 чехлов = (1900 + 200) × 1,15 + 1750 = 4165
    assert.equal(Math.round(MyPay.total(1000, false) * 100) / 100, 4165);
    assert.equal(Math.round(MyPay.total(1000, true) * 100) / 100, 6350);
    const s = MyPay.makeShift("1200.7", false, 300);
    assert.equal(s.cases, 1200);
    assert.equal(Math.round(s.piece * 100) / 100, 2100);
    assert.equal(Math.round(s.total * 100) / 100, 4815);
  });

  test("normalizeSettings чинит мусор и мигрирует старый тариф 2150/7/20", () => {
    const { MyPay } = open();
    const bad = MyPay.normalizeSettings({ basePay: "x", casePrice: -3, percent: 250, scheduleStart: "вчера", goal: null });
    assert.equal(bad.basePay, 2415);
    assert.equal(bad.casePrice, 0);
    assert.equal(bad.percent, 100, "процент ограничен 100");
    assert.equal(bad.scheduleStart, TODAY);
    const legacy = MyPay.normalizeSettings({ basePay: 2150, casePrice: 7, percent: 20 });
    assert.equal(legacy.basePay, 2415);
    assert.equal(legacy.casePrice, 7);
    assert.equal(legacy.percent, 25);
    const prev = MyPay.normalizeSettings({ basePay: 2627.84, casePrice: 1.69, percent: 100 });
    assert.equal(prev.basePay, 2415, "прежние дефолты 2627.84/1.69/100 тоже мигрируют");
    assert.equal(prev.percent, 25);
    const custom = MyPay.normalizeSettings({ basePay: 2150, casePrice: 7, percent: 30 });
    assert.equal(custom.basePay, 2150, "неполное совпадение — не легаси, оставляем");
  });

  test("исправление старых настроек и смен сохраняет премии и не меняет свои тарифы", () => {
    const app = open({ settings: { basePay: 2415, holidayPay: 4050, casePrice: 8.05, percent: 25 }, shifts: {
      "2026-09-01": { cases: 1000, holiday: false, base: 2415, piece: 2012.5, total: 4727.5 },
      "2026-09-15": { cases: 1000, holiday: true, base: 4050, piece: 2012.5, total: 6362.5 },
    }});
    const { state, correctLegacyShift } = app.MyPay;
    assert.equal(state.settings.casePrice, 7);
    assert.equal(state.settings.holidayPay, 4600);
    assert.equal(state.shifts["2026-09-01"].total, 4465);
    assert.equal(state.shifts["2026-09-15"].total, 6650);
    for (const s of Object.values(state.shifts)) assert.deepEqual(plain(correctLegacyShift(s)), plain(s));
    const custom = { cases: 1000, holiday: true, base: 5000, piece: 2000, total: 7300 };
    assert.deepEqual(plain(correctLegacyShift(custom)), custom);
    assert.equal(app.MyPay.normalizeSettings({ basePay: 2415, casePrice: 8.05, percent: 25, holidayPay: 5000 }).holidayPay, 5000);
    const saved = JSON.parse(app.window.localStorage.getItem("myPayShifts"));
    assert.equal(saved["2026-09-15"].total, 6650);
  });

  test("праздничная ставка читается из настроек, а не захардкожена", () => {
    const app = open({ settings: { basePay: 2627.84, holidayPay: 5000, casePrice: 1.69, percent: 100, scheduleStart: TODAY, goal: 60000 } });
    assert.equal(app.MyPay.total(0, true), 5000);
    assert.match(app.text("holidayRateLabel"), /5 000/);
  });

  test("график 2/2: два рабочих, два выходных", () => {
    const { MyPay } = open({ settings: { scheduleStart: TODAY } });
    const d = new Date();
    assert.equal(MyPay.isWork(d), true);
    assert.equal(MyPay.isWork(addDays(d, 1)), true);
    assert.equal(MyPay.isWork(addDays(d, 2)), false);
    assert.equal(MyPay.isWork(addDays(d, 3)), false);
    assert.equal(MyPay.isWork(addDays(d, 4)), true);
    assert.equal(MyPay.isWork(addDays(d, -1)), false);
    assert.equal(MyPay.isWork(addDays(d, -3)), true);
  });

  test("форматирование: деньги, короткие суммы, склонения, экранирование", () => {
    const { MyPay } = open();
    assert.equal(norm(MyPay.money(2627.84)), "2 627,84 ₽");
    assert.equal(norm(MyPay.money(1690)), "1 690 ₽");
    assert.equal(norm(MyPay.money(30014.4)), "30 014,40 ₽");
    assert.equal(norm(MyPay.moneyShort(5585.34)), "5,6к");
    assert.equal(norm(MyPay.moneyShort(950)), "950");
    assert.equal(MyPay.plural(1, "смена", "смены", "смен"), "смена");
    assert.equal(MyPay.plural(4, "смена", "смены", "смен"), "смены");
    assert.equal(MyPay.plural(12, "смена", "смены", "смен"), "смен");
    assert.equal(MyPay.escapeHtml('<b>"x"</b>'), "&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    assert.equal(MyPay.isDateKey("2026-09-28"), true);
    assert.equal(MyPay.isDateKey("28.09.2026"), false);
  });
});

describe("главный экран", () => {
  test("ввод чехлов пересчитывает итог и сохраняет смену за сегодня", async () => {
    const app = open({ settings: { scheduleStart: TODAY } });
    app.input("casesInput", "350");
    assert.equal(app.MyPay.homeDirty, false, "change commits the draft locally");
    assert.match(app.text("shiftTotal"), /3 027,50/);
    app.click("saveShiftBtn");
    await tick();
    const saved = JSON.parse(app.window.localStorage.getItem("myPayShifts"));
    assert.equal(saved[TODAY].cases, 350);
    assert.equal(Math.round(saved[TODAY].total * 100) / 100, 3027.5);
    assert.equal(app.MyPay.homeDirty, false);
    assert.match(app.text("homeMonthShifts"), /1/);
    assert.match(app.text("toast"), /Смена сохранена/);
  });

  test("кнопки +100/+500 и −/+ меняют поле", () => {
    const app = open();
    app.click(app.document.querySelector('[data-add="500"]'));
    assert.equal(app.$("casesInput").value, "500");
    app.click(app.document.querySelector('[data-step="100"]'));
    assert.equal(app.$("casesInput").value, "600");
    app.click(app.document.querySelector('[data-step="-100"]'));
    app.click(app.document.querySelector('[data-step="-100"]'));
    app.click(app.document.querySelector('[data-step="-100"]'));
    app.click(app.document.querySelector('[data-step="-100"]'));
    app.click(app.document.querySelector('[data-step="-100"]'));
    app.click(app.document.querySelector('[data-step="-100"]'));
    app.click(app.document.querySelector('[data-step="-100"]'));
    assert.equal(app.$("casesInput").value, "0", "ниже нуля не уходит");
  });

  test("праздничный переключатель меняет ставку", () => {
    const app = open();
    app.$("holidayInput").checked = true;
    app.$("holidayInput").dispatchEvent(new app.window.Event("change", { bubbles: true }));
    assert.match(app.text("homeBase"), /4 600/);
    assert.match(app.text("shiftTotal"), /4 600/);
  });

  test("сохранённая смена за сегодня подставляется в поле при старте", () => {
    const app = open({ shifts: { [TODAY]: { cases: 777, holiday: true, base: 4050, piece: 1563.71, total: 5613.71 } } });
    assert.equal(app.$("casesInput").value, "777");
    assert.equal(app.$("holidayInput").checked, true);
    assert.match(app.text("shiftTotal"), /5 959,75/);
  });

  test("статистика месяца: заработано и смены", () => {
    const { shifts, scheduleStart } = seedMonth([1000, 1000]);
    const app = open({ shifts, settings: { scheduleStart, goal: 10000 } });
    const n = Object.keys(shifts).length;
    if (!n) return; // 1-е число месяца — сидов нет, проверять нечего
    assert.match(app.text("homeMonthShifts"), new RegExp(`^${n}`));
    const expected = n * 4317.84;
    assert.match(norm(app.text("homeMonthTotal")), new RegExp(expected.toLocaleString("ru-RU").replace(/\u00a0/g, " ").slice(0, 5)));
  });

  test("прогноз: null без смен, иначе заработано + средняя × оставшиеся рабочие дни", () => {
    const app = open({ settings: { scheduleStart: TODAY } });
    assert.equal(app.MyPay.monthForecast(), null);
    const { shifts, scheduleStart } = seedMonth([1000, 1000, 1000, 1000]);
    const app2 = open({ shifts, settings: { scheduleStart } });
    const f = app2.MyPay.monthForecast();
    const sum = Object.values(shifts).reduce((a, s) => a + s.total, 0);
    if (!Object.keys(shifts).length) return assert.equal(f, null);
    assert.ok(f >= Math.round(sum), "прогноз не меньше уже заработанного");
    // остаток = рабочие дни с сегодняшнего по конец месяца без сохранённой смены
    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    let remaining = 0;
    for (let n = now.getDate(); n <= days; n++) {
      const x = new Date(now.getFullYear(), now.getMonth(), n);
      if (app2.MyPay.isWork(x) && !shifts[key(x)]) remaining++;
    }
    assert.equal(f, Math.round(sum + 4317.84 * remaining));
  });
});

describe("календарь и смены", () => {
  test("первый тап выбирает день, второй открывает окно смены", () => {
    const app = open({ settings: { scheduleStart: TODAY } });
    app.MyPay.showScreen("calendarScreen");
    const days = [...app.document.querySelectorAll("#calendarDays .day:not(.empty)")];
    const d1 = days[0];
    app.click(d1);
    assert.equal(app.MyPay.state.selectedDate, key(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
    assert.ok(app.$("shiftModal").classList.contains("hidden"));
    app.click(app.document.querySelector("#calendarDays .day.selected"));
    assert.ok(!app.$("shiftModal").classList.contains("hidden"), "второй тап открыл модалку");
    assert.equal(app.MyPay.state.modalDate, app.MyPay.state.selectedDate);
  });

  test("окно смены: сохранение, удаление с подтверждением и возврат", async () => {
    const app = open({ settings: { scheduleStart: TODAY } });
    const k = key(new Date(new Date().getFullYear(), new Date().getMonth(), 2));
    app.MyPay.openShiftModal(k);
    app.input("modalCases", "1200");
    app.input("modalHours", "11");
    app.input("modalBonus", "500");
    app.input("modalNote", "переработка");
    assert.match(app.text("modalTotal"), /5 015/);
    app.click("modalSave");
    await tick();
    assert.equal(app.MyPay.state.shifts[k].cases, 1200);
    assert.equal(Math.round(app.MyPay.state.shifts[k].total * 100) / 100, 5015);
    assert.deepEqual(plain(app.MyPay.state.extra.shiftMeta[k]), { hours: 11, bonus: 500, note: "переработка" });
    assert.ok(app.$("shiftModal").classList.contains("hidden"));

    const p = app.MyPay.deleteShift(k);
    await tick(10);
    assert.ok(!app.$("confirmModal").classList.contains("hidden"), "показан диалог подтверждения");
    assert.match(app.text("confirmTitle"), /Удалить смену/);
    app.click("confirmOk");
    assert.equal(await p, true);
    assert.equal(app.MyPay.state.shifts[k], undefined);
    assert.ok(!app.$("undoDeleteBtn").classList.contains("hidden"), "в «Ещё» появилась кнопка возврата");

    await app.MyPay.undoLastDelete();
    assert.equal(app.MyPay.state.shifts[k].cases, 1200);
    assert.deepEqual(plain(app.MyPay.state.extra.shiftMeta[k]), { hours: 11, bonus: 500, note: "переработка" });
    assert.ok(app.$("undoDeleteBtn").classList.contains("hidden"));
  });

  test("отмена в диалоге ничего не удаляет", async () => {
    const app = open({ shifts: { [TODAY]: { cases: 100, holiday: false, base: 2627.84, piece: 169, total: 2796.84 } } });
    const p = app.MyPay.deleteShift(TODAY);
    await tick(10);
    app.click("confirmCancel");
    assert.equal(await p, false);
    assert.equal(app.MyPay.state.shifts[TODAY].cases, 100);
  });

  test("шаблон подставляет значения в окно смены", () => {
    const app = open();
    app.MyPay.openShiftModal(TODAY);
    const pill = app.document.querySelector("#modalTemplatePills [data-modal-tpl]");
    assert.ok(pill, "есть кнопки шаблонов");
    app.click(pill);
    const t = app.MyPay.state.extra.templates[0];
    assert.equal(app.$("modalCases").value, String(t.cases));
    assert.equal(app.$("modalHours").value, String(t.hours));
  });

  test("переключение месяцев в календаре и статистике синхронно, клик по заголовку возвращает к текущему", () => {
    const app = open();
    const m0 = app.MyPay.state.calendarDate.getMonth();
    app.click("nextMonth");
    assert.equal(app.MyPay.state.calendarDate.getMonth(), (m0 + 1) % 12);
    assert.equal(app.text("statsMonth"), app.text("monthTitle"));
    app.click("statsPrev");
    app.click("statsPrev");
    assert.equal(app.MyPay.state.calendarDate.getMonth(), (m0 + 11) % 12);
    app.click("monthTitle");
    assert.equal(app.MyPay.state.calendarDate.getMonth(), m0);
    assert.equal(app.MyPay.state.calendarDate.getFullYear(), new Date().getFullYear());
  });

  test("очистка месяца: подтверждение, затем смены месяца удалены", async () => {
    const { shifts, scheduleStart } = seedMonth([500, 600, 700]);
    const other = { "2000-01-05": { cases: 1, holiday: false, base: 1, piece: 1, total: 2 } };
    const app = open({ shifts: { ...shifts, ...other }, settings: { scheduleStart } });
    const p = app.MyPay.clearMonth();
    await tick(10);
    assert.match(app.text("confirmTitle"), /Очистить месяц/);
    app.click("confirmOk");
    await p;
    assert.deepEqual(Object.keys(app.MyPay.state.shifts), ["2000-01-05"], "чужой месяц не тронут");
  });
});

describe("статистика", () => {
  test("analyticsForMonth: сумма, лучшая смена и серия", () => {
    const { shifts, scheduleStart } = seedMonth([1000, 1500, 800]);
    const app = open({ shifts, settings: { scheduleStart, goal: 60000 } });
    const a = app.MyPay.analyticsForMonth(new Date());
    const n = Object.keys(shifts).length;
    assert.equal(a.es.length, n);
    if (!n) return;
    assert.equal(Math.round(a.sum * 100) / 100, Math.round(Object.values(shifts).reduce((x, s) => x + s.total, 0) * 100) / 100);
    assert.equal(a.best.cases, Math.max(...Object.values(shifts).map((s) => s.cases)));
    assert.ok(a.bestStreak >= 1 && a.bestStreak <= n);
  });

  test("список смен месяца и график заполняются", () => {
    const { shifts, scheduleStart } = seedMonth([1000, 1500]);
    const app = open({ shifts, settings: { scheduleStart } });
    app.MyPay.showScreen("statsScreen");
    const n = Object.keys(shifts).length;
    assert.equal(app.document.querySelectorAll("#historyList .history-item").length, n);
    assert.equal(app.document.querySelectorAll("#earningsChart .bar").length, n);
    if (n) assert.match(norm(app.text("monthTotal")), /₽/);
  });
});

describe("выплаты", () => {

  test("выплаты: обратный отсчёт до аванса/зарплаты", () => {
    const app = open({ extra: { payday: { advanceDay: 25, salaryDay: 10 } } });
    const info = app.MyPay.paydayInfo(new Date(2026, 8, 20));
    assert.equal(info.type, "advance");
    assert.equal(info.days, 3);
    const info2 = app.MyPay.paydayInfo(new Date(2026, 8, 26));
    assert.equal(info2.type, "salary");
    assert.equal(info2.date.getDate(), 8);
    assert.equal(info2.date.getMonth(), 9);
    const s = { cases: 1000, holiday: false, base: 2415, piece: 1750, total: 4165 };
    const real = open({ shifts: { "2026-09-03": s, "2026-09-20": s }, extra: { payday: { advanceDay: 23, salaryDay: 8 } } });
    const adv = real.MyPay.paydayInfo(new Date(2026, 8, 10));
    assert.equal(adv.type, "advance"); assert.equal(adv.date.getDate(), 23);
    assert.ok(Math.abs(adv.expected - 1900) < 0.01, "23-го — чистый выход за 1–15");
    const sal = real.MyPay.paydayInfo(new Date(2026, 8, 29));
    assert.equal(sal.type, "salary"); assert.equal(sal.date.getDate(), 8);
    assert.ok(Math.abs(sal.expected - (4165 * 2 - 1900)) < 0.01, "8-го — остальное за прошлый месяц");
    const none = open({ extra: { payday: { advanceDay: 0, salaryDay: 0 } } });
    assert.equal(none.MyPay.paydayInfo(), null);
  });

  test("выплаты: границы 1/15/16/31, праздники, премия и переход года", () => {
    const app = open();
    const { state, makeShift, paydayInfo } = app.MyPay;
    state.shifts = {
      "2026-12-01": makeShift(1000, false),
      "2026-12-15": makeShift(1000, true, 300),
      "2026-12-16": makeShift(1000, false),
      "2026-12-31": makeShift(1000, true),
      "2027-01-01": makeShift(1000, false),
    };
    const advance = paydayInfo(new Date(2026, 11, 23));
    assert.equal(advance.days, 0);
    assert.equal(advance.expected, 5700);
    const salary = paydayInfo(new Date(2026, 11, 29));
    assert.equal(salary.date.getFullYear(), 2027);
    assert.equal(salary.date.getMonth(), 0);
    assert.equal(salary.date.getDate(), 8);
    assert.equal(salary.days, 10);
    // 5700 выходы второй половины + 800 обеды + 1830 районный за весь месяц + 7000 сделка + 300 премия
    assert.equal(salary.expected, 15630);
    state.extra.payday.advanceDay = 0; // скрытие отсчёта аванса не добавляет его в зарплату
    assert.equal(paydayInfo(new Date(2026, 11, 29)).expected, 15630);
    state.extra.payday.advanceDay = 23;
    assert.equal(advance.expected + salary.expected, 4165 * 2 + 6350 * 2 + 300);
    assert.equal(paydayInfo(new Date(2027, 0, 8)).days, 0);
    assert.equal(paydayInfo(new Date(2027, 0, 9)).expected, 1900);
    assert.equal(paydayInfo(new Date(2026, 8, 29)).expected, 0);
  });

  test("выплата 8 марта включает конец февраля, настройки дат не затираются", () => {
    const app = open();
    app.MyPay.state.shifts = { "2028-02-29": app.MyPay.makeShift(1000, true) };
    const p = app.MyPay.paydayInfo(new Date(2028, 1, 29));
    assert.equal(p.date.getMonth(), 2); assert.equal(p.date.getDate(), 8);
    assert.equal(p.days, 8); assert.equal(p.expected, 6350);
    const custom = app.MyPay.normalizeExtra({ payday: { advanceDay: 22, salaryDay: 9 } });
    assert.deepEqual(plain(custom.payday), { advanceDay: 22, salaryDay: 9 });
  });
});

describe("настройки, тема, резервные копии", () => {
  test("настройки сохраняются и пересчитывают экран", async () => {
    const app = open();
    app.MyPay.openSettings();
    assert.equal(app.$("settingHoliday").value, "4600");
    app.input("settingBase", "3000");
    app.input("settingHoliday", "4500");
    app.input("settingPrice", "2");
    app.input("settingPercent", "50");
    app.click("settingsSave");
    await tick();
    assert.equal(app.MyPay.state.settings.basePay, 3000);
    assert.equal(app.MyPay.state.settings.holidayPay, 4500);
    assert.equal(app.MyPay.total(1000, false), 4000);
    assert.match(app.text("shiftTotal"), /3 000/);
  });

  test("тема: system → light → dark, класс body и theme-color", () => {
    const app = open({ dark: true, extra: { theme: "system" } });
    assert.equal(app.MyPay.state.extra.theme, "system");
    assert.ok(app.document.body.classList.contains("dark"), "система тёмная → тёмная");
    app.MyPay.cycleTheme();
    assert.equal(app.MyPay.state.extra.theme, "light");
    assert.ok(!app.document.body.classList.contains("dark"));
    assert.equal(app.document.querySelector('meta[name="theme-color"]').getAttribute("content"), "#f3f2ef");
    app.MyPay.cycleTheme();
    assert.equal(app.MyPay.state.extra.theme, "dark");
    assert.equal(app.document.querySelector('meta[name="theme-color"]').getAttribute("content"), "#101214");
    assert.equal(JSON.parse(app.window.localStorage.getItem("myPayExtra")).theme, "dark");
  });

  test("buildBackup → parseBackup круг, мусор отбрасывается", () => {
    const app = open({ shifts: { [TODAY]: { cases: 300, holiday: false, base: 2627.84, piece: 507, total: 3134.84 } } });
    const backup = app.MyPay.buildBackup();
    assert.equal(backup.version, 1);
    const parsed = app.MyPay.parseBackup(JSON.stringify(backup));
    assert.equal(parsed.shifts[TODAY].cases, 300);
    assert.equal(parsed.settings.basePay, 2415);
    const dirty = app.MyPay.parseBackup(JSON.stringify({ settings: {}, shifts: { "bad-date": { cases: 5 }, "2026-01-01": { cases: -4, holiday: 1 }, "2026-01-02": null } }));
    assert.deepEqual(Object.keys(dirty.shifts), ["2026-01-01"]);
    assert.equal(dirty.shifts["2026-01-01"].cases, 0);
    assert.equal(dirty.shifts["2026-01-01"].holiday, true);
    assert.throws(() => app.MyPay.parseBackup("{}"), /invalid backup/);
    assert.throws(() => app.MyPay.parseBackup("not json"));
  });

  test("CSV содержит BOM, заголовок и строки смен", () => {
    const app = open({
      shifts: { "2026-01-05": { cases: 100, holiday: false, base: 2627.84, piece: 169, total: 2796.84 } },
      extra: { shiftMeta: { "2026-01-05": { hours: 11, bonus: 0, note: 'тест "кавычки"' } } },
    });
    const csv = app.MyPay.buildCsv();
    assert.equal(csv.charCodeAt(0), 0xfeff);
    const lines = csv.slice(1).split("\n");
    assert.equal(lines[0].split(";")[0], '"Дата"');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^"2026-01-05";"100";"Нет"/);
    assert.match(lines[1], /"тест ""кавычки"""/);
    assert.match(lines[1], /"254,26"|"254.26"/); // доход в час
  });
});

describe("офлайн-очередь и навигация", () => {
  test("очередь: дубли по типу и дате схлопываются", () => {
    const app = open();
    app.MyPay.queueCloudOp({ type: "saveShift", date: "2026-01-01", shift: { cases: 1 } });
    app.MyPay.queueCloudOp({ type: "saveShift", date: "2026-01-01", shift: { cases: 2 } });
    app.MyPay.queueCloudOp({ type: "deleteShift", date: "2026-01-02" });
    const q = app.MyPay.loadQueue();
    assert.equal(q.length, 2);
    assert.equal(q[0].shift.cases, 2);
    assert.ok(q.every((op) => typeof op.queuedAt === "number"));
    app.window.localStorage.setItem("myPayCloudQueue", "{broken");
    assert.deepEqual(plain(app.MyPay.loadQueue()), []);
  });

  test("нижняя навигация переключает экраны и aria-current", () => {
    const app = open();
    app.click(app.document.querySelector('.nav-item[data-screen="statsScreen"]'));
    assert.ok(app.$("statsScreen").classList.contains("active"));
    assert.ok(!app.$("homeScreen").classList.contains("active"));
    assert.equal(app.document.querySelector('.nav-item[data-screen="statsScreen"]').getAttribute("aria-current"), "page");
    assert.equal(app.document.querySelector('.nav-item[data-screen="homeScreen"]').getAttribute("aria-current"), null);
  });

  test("экран входа: переключение режимов и валидация без сети", async () => {
    const app = open();
    app.MyPay.setAuthMode("signup");
    assert.ok(!app.$("signupNameWrap").classList.contains("hidden"));
    assert.ok(!app.$("confirmPasswordWrap").classList.contains("hidden"));
    app.MyPay.setAuthMode("login");
    assert.ok(app.$("signupNameWrap").classList.contains("hidden"));
    app.$("authModal").classList.remove("hidden");
    app.input("authEmail", "");
    app.input("authPassword", "");
    app.click("authAction");
    await tick();
    assert.match(app.text("authStatus"), /Облако недоступно/, "без SDK объясняем, почему вход невозможен");
  });
});

test('неверные календарные даты отклоняются, дата цеха не зависит от браузера', () => {
  const app = open();
  assert.equal(app.MyPay.isDateKey('2026-02-31'), false);
  assert.equal(app.MyPay.isDateKey('2028-02-29'), true);
  assert.equal(app.MyPay.dateKey(app.MyPay.workNow(new Date('2026-10-24T20:30:00Z'))), '2026-10-25');
});

test('сохранённая премия включается в итог на главной', () => {
  const app = open({ shifts: { [TODAY]: { cases: 1000, holiday: false, base: 2415, piece: 1750, total: 4465 } }, extra: { shiftMeta: { [TODAY]: { bonus: 300 } } } });
  assert.match(app.text('shiftTotal'), /4 465/);
  assert.equal(app.$('homeBonusRow').classList.contains('hidden'), false);
});

test('удалённые разделы отсутствуют, шаблоны доступны в «Ещё»', () => {
  const app = open();
  assert.equal(app.document.querySelectorAll('.nav-item').length, 4);
  assert.equal(app.$('financeScreen'), null);
  assert.equal(app.$('settingGoal'), null);
  assert.ok(app.$('moreScreen').contains(app.$('templatesList')));
});
