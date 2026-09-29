// Тесты веб-приложения в jsdom: настоящий index.html + script.js (локальный режим без Supabase).
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
    assert.equal(app.MyPay.version, 18);
    assert.equal(app.text("appVersion"), "v18");
    assert.equal(app.MyPay.cloudAvailable, false, "без SDK — локальный режим");
    assert.match(app.text("cloudNotice"), /локальном режиме/);
    assert.ok(app.$("logoutBtn").classList.contains("hidden"), "кнопка выхода скрыта без аккаунта");
  });

  test("дефолты и формула: ставка + чехлы × цена × процент", () => {
    const { MyPay } = open();
    // (выход 1900 + обед 200) × 1,15 = 2415; сделка 7 × 1,15 = 8,05 × 25% = 2,0125 за чехол
    assert.equal(MyPay.DEFAULTS.basePay, 2415);
    assert.equal(MyPay.DEFAULTS.holidayPay, 4050);
    assert.equal(MyPay.DEFAULTS.casePrice, 8.05);
    assert.equal(MyPay.DEFAULTS.percent, 25);
    assert.equal(MyPay.total(0, false), 2415);
    // пример владельца: 1000 чехлов = (1900 + 200 + 1750) × 1,15 = 4427,50
    assert.equal(Math.round(MyPay.total(1000, false) * 100) / 100, 4427.5);
    assert.equal(Math.round(MyPay.total(1000, true) * 100) / 100, 6062.5);
    const s = MyPay.makeShift("1200.7", false, 300);
    assert.equal(s.cases, 1200);
    assert.equal(Math.round(s.piece * 100) / 100, 2415);
    assert.equal(Math.round(s.total * 100) / 100, 5130);
  });

  test("normalizeSettings чинит мусор и мигрирует старый тариф 2150/7/20", () => {
    const { MyPay } = open();
    const bad = MyPay.normalizeSettings({ basePay: "x", casePrice: -3, percent: 250, scheduleStart: "вчера", goal: null });
    assert.equal(bad.basePay, 2415);
    assert.equal(bad.casePrice, 0);
    assert.equal(bad.percent, 100, "процент ограничен 100");
    assert.equal(bad.scheduleStart, TODAY);
    assert.equal(bad.goal, 60000);
    const legacy = MyPay.normalizeSettings({ basePay: 2150, casePrice: 7, percent: 20 });
    assert.equal(legacy.basePay, 2415);
    assert.equal(legacy.casePrice, 8.05);
    assert.equal(legacy.percent, 25);
    const prev = MyPay.normalizeSettings({ basePay: 2627.84, casePrice: 1.69, percent: 100 });
    assert.equal(prev.basePay, 2415, "прежние дефолты 2627.84/1.69/100 тоже мигрируют");
    assert.equal(prev.percent, 25);
    const custom = MyPay.normalizeSettings({ basePay: 2150, casePrice: 7, percent: 30 });
    assert.equal(custom.basePay, 2150, "неполное совпадение — не легаси, оставляем");
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
    assert.equal(app.MyPay.homeDirty, true);
    assert.match(app.text("shiftTotal"), /3 119,38/);
    app.click("saveShiftBtn");
    await tick();
    const saved = JSON.parse(app.window.localStorage.getItem("myPayShifts"));
    assert.equal(saved[TODAY].cases, 350);
    assert.equal(Math.round(saved[TODAY].total * 100) / 100, 3119.38);
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
    assert.match(app.text("homeBase"), /4 050/);
    assert.match(app.text("shiftTotal"), /4 050/);
  });

  test("сохранённая смена за сегодня подставляется в поле при старте", () => {
    const app = open({ shifts: { [TODAY]: { cases: 777, holiday: true, base: 4050, piece: 1563.71, total: 5613.71 } } });
    assert.equal(app.$("casesInput").value, "777");
    assert.equal(app.$("holidayInput").checked, true);
    assert.match(app.text("shiftTotal"), /5 613,71/);
  });

  test("статистика месяца: заработано, смены, цель", () => {
    const { shifts, scheduleStart } = seedMonth([1000, 1000]);
    const app = open({ shifts, settings: { scheduleStart, goal: 10000 } });
    const n = Object.keys(shifts).length;
    if (!n) return; // 1-е число месяца — сидов нет, проверять нечего
    assert.match(app.text("homeMonthShifts"), new RegExp(`^${n}`));
    const expected = n * 4317.84;
    assert.match(norm(app.text("homeMonthTotal")), new RegExp(expected.toLocaleString("ru-RU").replace(/\u00a0/g, " ").slice(0, 5)));
    assert.equal(app.text("homeGoalPercent"), `${Math.min(100, Math.round(expected / 10000 * 100))}%`);
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
    assert.match(app.text("modalTotal"), /5 330/);
    app.click("modalSave");
    await tick();
    assert.equal(app.MyPay.state.shifts[k].cases, 1200);
    assert.equal(Math.round(app.MyPay.state.shifts[k].total * 100) / 100, 5330);
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
  test("analyticsForMonth: сумма, лучшая смена, серия, до цели", () => {
    const { shifts, scheduleStart } = seedMonth([1000, 1500, 800]);
    const app = open({ shifts, settings: { scheduleStart, goal: 60000 } });
    const a = app.MyPay.analyticsForMonth(new Date());
    const n = Object.keys(shifts).length;
    assert.equal(a.es.length, n);
    if (!n) return;
    assert.equal(Math.round(a.sum * 100) / 100, Math.round(Object.values(shifts).reduce((x, s) => x + s.total, 0) * 100) / 100);
    assert.equal(a.best.cases, Math.max(...Object.values(shifts).map((s) => s.cases)));
    assert.equal(a.remaining, Math.max(0, 60000 - a.sum));
    assert.ok(a.bestStreak >= 1 && a.bestStreak <= n);
    assert.equal(a.shiftsNeeded, Math.ceil(a.remaining / (a.sum / n)));
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

describe("финансы", () => {
  test("расход добавляется через форму и учитывается в остатке", async () => {
    const { shifts, scheduleStart } = seedMonth([1000]);
    const app = open({ shifts, settings: { scheduleStart } });
    app.MyPay.showScreen("financeScreen");
    app.click("addTxTop");
    assert.ok(!app.$("expenseModal").classList.contains("hidden"));
    app.input("expenseAmount", "1500");
    app.$("expenseCategory").value = app.$("expenseCategory").options[0].value;
    app.input("expenseDate", TODAY);
    app.input("expenseNote", "проезд");
    app.click("expenseSave");
    await tick();
    const txs = app.MyPay.state.extra.transactions;
    assert.equal(txs.length, 1);
    assert.equal(txs[0].amount, 1500);
    assert.equal(txs[0].type, "expense");
    const f = app.MyPay.financeNumbers();
    assert.equal(f.expenses, 1500);
    assert.equal(Math.round((f.income - f.expenses) * 100) / 100, Math.round(f.free * 100) / 100);
    assert.match(norm(app.text("financeExpenses")), /1 500/);
    assert.match(app.text("expenseList"), /проезд/);
    await app.MyPay.deleteExpense(txs[0].id);
    assert.equal(app.MyPay.state.extra.transactions.length, 0);
  });

  test("старые expenses мигрируют в transactions один раз", () => {
    const app = open({ extra: { expenses: [{ id: "exp_1", amount: 300, category: "Еда", date: TODAY, note: "обед" }, { id: "exp_2", amount: 100, category: "Свои траты", date: TODAY }] } });
    const e = app.MyPay.state.extra;
    assert.equal(e.expenses, undefined);
    assert.equal(e.transactions.length, 2);
    assert.equal(e.transactions[0].type, "expense");
    assert.equal(e.transactions[0].note, "обед");
    assert.ok(e.categories.find((c) => c.name === "Свои траты"), "неизвестная категория добавляется в список");
    assert.equal(app.MyPay.financeNumbers().expenses, 400);
  });

  test("счета: баланс считается из операций, перевод двигает деньги между счетами", async () => {
    const app = open();
    app.MyPay.showScreen("financeScreen");
    app.click("addAccountBtn");
    app.input("accountName", "Карта");
    app.input("accountBalance", "10000");
    app.click("accountSave");
    await tick();
    app.click("addAccountBtn");
    app.input("accountName", "Наличные");
    app.$("accountType").value = "cash";
    app.input("accountBalance", "500");
    app.click("accountSave");
    await tick();
    const [card, cash] = app.MyPay.state.extra.accounts;
    assert.equal(app.MyPay.totalBalance(), 10500);

    app.MyPay.openExpenseModal("expense");
    app.input("expenseAmount", "700");
    app.$("txAccount").value = card.id;
    app.click("expenseSave");
    await tick();
    assert.equal(app.MyPay.accountBalance(card), 9300);

    app.MyPay.openExpenseModal("income");
    app.input("expenseAmount", "30000");
    app.$("txAccount").value = card.id;
    app.click("expenseSave");
    await tick();
    assert.equal(app.MyPay.accountBalance(card), 39300);
    assert.equal(app.MyPay.financeNumbers().received, 30000);

    app.MyPay.openExpenseModal("transfer");
    app.input("expenseAmount", "2000");
    app.$("txAccount").value = card.id;
    app.$("txToAccount").value = cash.id;
    app.click("expenseSave");
    await tick();
    assert.equal(app.MyPay.accountBalance(card), 37300);
    assert.equal(app.MyPay.accountBalance(cash), 2500);
    assert.match(norm(app.text("accountsRow")), /39 800/);

    // перевод на тот же счёт не проходит
    app.MyPay.openExpenseModal("transfer");
    app.input("expenseAmount", "100");
    app.$("txAccount").value = card.id;
    app.$("txToAccount").value = card.id;
    app.click("expenseSave");
    await tick();
    assert.match(app.text("toast"), /два разных счёта/);
  });

  test("лимиты: превышение подсвечивается и попадает в советы", async () => {
    const app = open({ extra: { transactions: [{ id: "t1", type: "expense", amount: 4500, category: "Еда", date: TODAY }] } });
    app.MyPay.showScreen("financeScreen");
    app.click("limitsBtn");
    const row = app.document.querySelector('#limitsEditor .limit-edit[data-cat="food"] input');
    row.value = "4000";
    app.click("limitsSave");
    await tick();
    assert.equal(app.MyPay.state.extra.categories.find((c) => c.id === "food").limit, 4000);
    assert.ok(app.document.querySelector("#limitsList .limit-row.is-over"));
    const tips = app.MyPay.buildInsights();
    assert.ok(tips.some((t) => t.tone === "warn" && /Лимит «Еда» превышен/.test(t.text)), JSON.stringify(tips));
  });

  test("регулярный платёж: «Оплатил» создаёт расход и переносит дату на следующий месяц", async () => {
    const app = open();
    app.MyPay.showScreen("financeScreen");
    app.click("addRecurringBtn");
    app.input("recName", "Аренда");
    app.input("recAmount", "15000");
    app.input("recDay", String(new Date(TODAY).getDate()));
    app.click("recurringSave");
    await tick();
    const r = app.MyPay.state.extra.recurring[0];
    assert.equal(r.name, "Аренда");
    assert.equal(app.MyPay.financeNumbers().upcoming, 15000, "неоплаченный платёж учитывается в прогнозе");
    assert.match(app.text("recurringList"), /сегодня/);
    await app.MyPay.payRecurring(r.id);
    assert.equal(app.MyPay.state.extra.transactions.length, 1);
    assert.equal(app.MyPay.state.extra.transactions[0].note, "Аренда");
    assert.equal(app.MyPay.financeNumbers().upcoming, 0);
    const next = app.MyPay.recurringNext(r, new Date(TODAY));
    assert.equal(next.getMonth(), (new Date(TODAY).getMonth() + 1) % 12);
  });

  test("долги: частичный возврат и закрытие", async () => {
    const app = open();
    app.MyPay.showScreen("financeScreen");
    app.click("addDebtBtn");
    app.input("debtPerson", "Иван");
    app.input("debtAmount", "5000");
    app.click("debtSave");
    await tick();
    const d = app.MyPay.state.extra.debts[0];
    assert.equal(d.direction, "i_owe");
    assert.match(norm(app.text("debtTotals")), /5 000/);
    const p = app.MyPay.addDebtPayment(d.id);
    await tick(10);
    app.input("promptInput", "2000");
    app.click("promptOk");
    await p;
    assert.equal(d.paid, 2000);
    const p2 = app.MyPay.addDebtPayment(d.id);
    await tick(10);
    app.input("promptInput", "3000");
    app.click("promptOk");
    await p2;
    assert.equal(d.paid, 5000);
    assert.match(app.text("debtsList"), /Одолжил другу/, "закрытый долг уходит из списка");
  });

  test("выплаты: обратный отсчёт до аванса/зарплаты", () => {
    const app = open({ extra: { payday: { advanceDay: 25, salaryDay: 10 } } });
    const info = app.MyPay.paydayInfo(new Date(2026, 8, 20));
    assert.equal(info.type, "advance");
    assert.equal(info.days, 5);
    const info2 = app.MyPay.paydayInfo(new Date(2026, 8, 26));
    assert.equal(info2.type, "salary");
    assert.equal(info2.date.getDate(), 10);
    assert.equal(info2.date.getMonth(), 9);
    const none = open({ extra: { payday: { advanceDay: 0, salaryDay: 0 } } });
    assert.equal(none.MyPay.paydayInfo(), null);
  });

  test("цель: создание, пополнение через диалог суммы, удаление", async () => {
    const app = open();
    app.click("addGoalBtn");
    app.input("goalName", "Отпуск");
    app.input("goalAmount", "50000");
    app.input("goalSaved", "10000");
    app.click("goalSave");
    await tick();
    const g = app.MyPay.state.extra.goals.at(-1);
    assert.equal(g.name, "Отпуск");
    assert.equal(g.saved, 10000);
    assert.equal(g.deposits.length, 1);
    assert.match(app.text("goalsList"), /Отпуск/);

    const p = app.MyPay.topUpGoal(g.id);
    await tick(10);
    assert.ok(!app.$("promptModal").classList.contains("hidden"));
    app.input("promptInput", "2500");
    app.click("promptOk");
    await p;
    assert.equal(g.saved, 12500);
    assert.equal(g.deposits.length, 2);

    const d = app.MyPay.deleteGoal(g.id);
    await tick(10);
    app.click("confirmOk");
    await d;
    assert.ok(!app.MyPay.state.extra.goals.find((x) => x.id === g.id));
  });

  test("пустые цель/расход не сохраняются", async () => {
    const app = open();
    app.click("addGoalBtn");
    app.input("goalName", "");
    app.input("goalAmount", "0");
    app.click("goalSave");
    await tick();
    assert.match(app.text("toast"), /Укажи название и сумму/);
    app.click("addTxTop");
    app.input("expenseAmount", "");
    app.click("expenseSave");
    await tick();
    assert.match(app.text("toast"), /Укажи сумму/);
  });
});

describe("настройки, тема, резервные копии", () => {
  test("настройки сохраняются и пересчитывают экран", async () => {
    const app = open();
    app.MyPay.openSettings();
    assert.equal(app.$("settingHoliday").value, "4050");
    app.input("settingBase", "3000");
    app.input("settingHoliday", "4500");
    app.input("settingPrice", "2");
    app.input("settingPercent", "50");
    app.input("settingGoal", "80000");
    app.click("settingsSave");
    await tick();
    assert.equal(app.MyPay.state.settings.basePay, 3000);
    assert.equal(app.MyPay.state.settings.holidayPay, 4500);
    assert.equal(app.MyPay.total(1000, false), 4000);
    assert.equal(JSON.parse(app.window.localStorage.getItem("myPaySettings")).goal, 80000);
    assert.match(app.text("shiftTotal"), /3 000/);
  });

  test("тема: system → light → dark, класс body и theme-color", () => {
    const app = open({ dark: true });
    assert.equal(app.MyPay.state.extra.theme, "system");
    assert.ok(app.document.body.classList.contains("dark"), "система тёмная → тёмная");
    app.MyPay.cycleTheme();
    assert.equal(app.MyPay.state.extra.theme, "light");
    assert.ok(!app.document.body.classList.contains("dark"));
    assert.equal(app.document.querySelector('meta[name="theme-color"]').getAttribute("content"), "#eeeeea");
    app.MyPay.cycleTheme();
    assert.equal(app.MyPay.state.extra.theme, "dark");
    assert.equal(app.document.querySelector('meta[name="theme-color"]').getAttribute("content"), "#0a0c0f");
    assert.equal(JSON.parse(app.window.localStorage.getItem("myPayExtra")).theme, "dark");
  });

  test("buildBackup → parseBackup круг, мусор отбрасывается", () => {
    const app = open({ shifts: { [TODAY]: { cases: 300, holiday: false, base: 2627.84, piece: 507, total: 3134.84 } } });
    const backup = app.MyPay.buildBackup();
    assert.equal(backup.version, 18);
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
    app.click(app.document.querySelector('.nav-item[data-screen="financeScreen"]'));
    assert.ok(app.$("financeScreen").classList.contains("active"));
    assert.ok(!app.$("homeScreen").classList.contains("active"));
    assert.equal(app.document.querySelector('.nav-item[data-screen="financeScreen"]').getAttribute("aria-current"), "page");
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
