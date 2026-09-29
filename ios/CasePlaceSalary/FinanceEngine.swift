import Foundation

struct FinanceNumbers {
    var income: Double = 0      // заработано по сменам за месяц
    var expenses: Double = 0    // расходы за месяц
    var received: Double = 0    // доходы, зачисленные на счета
    var free: Double = 0        // income − expenses
    var upcoming: Double = 0    // неоплаченные регулярные платежи месяца
    var forecast: Double = 0    // остаток к концу месяца
    var daily: Double = 0       // можно тратить в день
    var rate: Int = 0           // % заработка, который остаётся
    var balance: Double = 0     // сумма по счетам
    var remainingDays: Int = 1
}

enum InsightTone { case warn, info, good }
struct Insight: Identifiable { let id = UUID(); let tone: InsightTone; let text: String }

struct PaydayInfo { enum Kind { case advance, salary }; let kind: Kind; let date: Date; let days: Int; let expected: Double }

/// Финансовая математика — зеркало функций financeNumbers/buildInsights/paydayInfo сайта.
struct FinanceEngine {
    let settings: Settings
    let shifts: [String: Shift]
    let extra: Extra
    var model: PayModel { PayModel(settings: settings) }

    // MARK: операции и счета
    func transactions(month: Date, type: TxType? = nil) -> [Transaction] {
        let p = DateUtil.monthPrefix(month)
        return extra.transactions.filter { $0.date.hasPrefix(p) && (type == nil || $0.type == type!) }
    }
    static func sum(_ list: [Transaction]) -> Double { list.reduce(0) { $0 + $1.amount } }

    func balance(of acc: Account) -> Double {
        var b = acc.balance
        for t in extra.transactions {
            switch t.type {
            case .income: if t.accountId == acc.id { b += t.amount }
            case .expense: if t.accountId == acc.id { b -= t.amount }
            case .transfer:
                if t.accountId == acc.id { b -= t.amount }
                if t.toAccountId == acc.id { b += t.amount }
            }
        }
        return b
    }
    var totalBalance: Double { extra.accounts.reduce(0) { $0 + balance(of: $1) } }
    func account(_ id: String?) -> Account? { guard let id = id else { return nil }; return extra.accounts.first { $0.id == id } }
    func category(named name: String) -> Category? { extra.categories.first { $0.name == name } }
    func emoji(for t: Transaction) -> String {
        switch t.type { case .income: return "💰"; case .transfer: return "🔁"; case .expense: return category(named: t.category)?.emoji ?? "📦" }
    }

    // MARK: регулярные платежи
    func nextDate(of r: Recurring, today: Date = Date()) -> Date {
        let y = DateUtil.year(today), m = DateUtil.month(today)
        if r.lastPaid == DateUtil.monthPrefix(today) {
            let next = DateUtil.addMonths(1, to: DateUtil.startOfMonth(today))
            return DateUtil.date(year: DateUtil.year(next), month: DateUtil.month(next), day: r.day)
        }
        return DateUtil.date(year: y, month: m, day: r.day)
    }
    func upcomingRecurring(days: Int = 7, today: Date = Date()) -> [(Recurring, Date)] {
        extra.recurring.map { ($0, nextDate(of: $0, today: today)) }.filter { DateUtil.daysBetween(today, $0.1) <= days }.sorted { $0.1 < $1.1 }
    }
    func unpaidRecurring(today: Date = Date()) -> [Recurring] { extra.recurring.filter { $0.lastPaid != DateUtil.monthPrefix(today) } }

    // MARK: выплаты
    func payday(today: Date = Date()) -> PaydayInfo? {
        let adv = extra.payday.advanceDay, sal = extra.payday.salaryDay
        guard adv > 0 || sal > 0 else { return nil }
        let start = DateUtil.startOfDay(today)
        var candidates: [(PaydayInfo.Kind, Date)] = []
        for (kind, day) in [(PaydayInfo.Kind.advance, adv), (.salary, sal)] where day > 0 {
            for k in 0..<3 {
                let m = DateUtil.addMonths(k, to: DateUtil.startOfMonth(today))
                let d = DateUtil.date(year: DateUtil.year(m), month: DateUtil.month(m), day: day)
                if d >= start { candidates.append((kind, d)); break }
            }
        }
        guard let next = candidates.min(by: { $0.1 < $1.1 }) else { return nil }
        let days = DateUtil.daysBetween(start, next.1)
        var expected = 0.0
        if next.0 == .advance {
            let m = DateUtil.sameMonth(next.1, today) ? today : next.1
            expected = PayModel.monthEntries(shifts, month: m).filter { (Int($0.key.suffix(2)) ?? 0) <= 15 }.reduce(0) { $0 + $1.shift.total }
        } else {
            let prev = DateUtil.addMonths(-1, to: DateUtil.startOfMonth(next.1))
            let es = PayModel.monthEntries(shifts, month: prev)
            let total = es.reduce(0) { $0 + $1.shift.total }
            let advPart = adv > 0 ? es.filter { (Int($0.key.suffix(2)) ?? 0) <= 15 }.reduce(0) { $0 + $1.shift.total } : 0
            expected = max(0, total - advPart)
        }
        return PaydayInfo(kind: next.0, date: next.1, days: days, expected: expected)
    }

    // MARK: сводка месяца
    func numbers(now: Date = Date()) -> FinanceNumbers {
        var n = FinanceNumbers()
        let es = PayModel.monthEntries(shifts, month: now)
        n.income = es.reduce(0) { $0 + $1.shift.total }
        n.expenses = FinanceEngine.sum(transactions(month: now, type: .expense))
        n.received = FinanceEngine.sum(transactions(month: now, type: .income))
        n.free = n.income - n.expenses
        n.upcoming = unpaidRecurring(today: now).reduce(0) { $0 + $1.amount }
        n.remainingDays = max(1, DateUtil.daysInMonth(now) - DateUtil.day(now) + 1)
        n.forecast = (model.forecast(shifts, month: now, now: now) ?? n.income) - n.expenses - n.upcoming
        n.daily = max(0, n.free - n.upcoming) / Double(n.remainingDays)
        n.rate = n.income > 0 ? Int((min(1, max(0, n.free / n.income)) * 100).rounded()) : 0
        n.balance = totalBalance
        return n
    }

    func spentByCategory(month: Date) -> [String: Double] {
        var out: [String: Double] = [:]
        for t in transactions(month: month, type: .expense) { out[t.category, default: 0] += t.amount }
        return out
    }

    // MARK: прогноз по цели
    func goalETA(_ g: Goal) -> Date? {
        let left = g.amount - g.saved
        guard left > 0 else { return nil }
        let deps = g.deposits.filter { DateUtil.isKey($0.date) }.sorted { $0.date < $1.date }
        guard deps.count >= 2, let first = DateUtil.date(deps[0].date), let last = DateUtil.date(deps[deps.count - 1].date) else { return nil }
        let span = max(7, Double(DateUtil.daysBetween(first, last) + 1))
        let perDay = deps.reduce(0) { $0 + $1.amount } / span
        guard perDay > 0 else { return nil }
        return DateUtil.addDays(Int(ceil(left / perDay)), to: Date())
    }
    func goalMonthly(_ g: Goal, now: Date = Date()) -> Double? {
        guard let dl = g.deadline, let d = DateUtil.date(dl), d > now else { return nil }
        let months = max(1.0, ceil(Double(DateUtil.daysBetween(now, d)) / 30.4))
        return max(0, g.amount - g.saved) / months
    }

    // MARK: советник
    func insights(now: Date = Date()) -> [Insight] {
        var out: [Insight] = []
        let n = numbers(now: now)
        let today = DateUtil.key(now)
        func daysWord(_ d: Int) -> String { "\(d) \(plural(d, "день", "дня", "дней"))" }

        let due = upcomingRecurring(days: 7, today: now)
        if let first = due.first {
            let sum = due.reduce(0) { $0 + $1.0.amount }
            let d = DateUtil.daysBetween(now, first.1)
            let when = d <= 0 ? "сегодня" : "через " + daysWord(d)
            if sum > max(0, n.free) {
                out.append(Insight(tone: .warn, text: "Ближайшие платежи на \(Fmt.money(sum)) (\(first.0.name) \(when)) — свободных денег \(Fmt.money(max(0, n.free))), не хватает \(Fmt.money(sum - max(0, n.free)))."))
            } else {
                out.append(Insight(tone: .info, text: "\(first.0.name) \(Fmt.money(first.0.amount)) — \(when). После всех платежей недели останется \(Fmt.money(n.free - sum))."))
            }
        }
        let spent = spentByCategory(month: now)
        for c in extra.categories where c.limit > 0 {
            let s = spent[c.name] ?? 0, pct = s / c.limit
            if pct >= 1 { out.append(Insight(tone: .warn, text: "Лимит «\(c.name)» превышен на \(Fmt.money(s - c.limit)) — в этом месяце лучше притормозить.")) }
            else if pct >= 0.8 { out.append(Insight(tone: .info, text: "Лимит «\(c.name)» почти исчерпан: \(Int((pct * 100).rounded()))% (\(Fmt.money(c.limit - s)) в запасе).")) }
        }
        let prevMonth = DateUtil.addMonths(-1, to: DateUtil.startOfMonth(now))
        let dayN = DateUtil.day(now)
        let prevSame = FinanceEngine.sum(transactions(month: prevMonth, type: .expense).filter { (Int($0.date.suffix(2)) ?? 0) <= dayN })
        if prevSame > 0 && n.expenses > prevSame * 1.15 {
            out.append(Insight(tone: .warn, text: "Тратишь на \(Int(((n.expenses / prevSame - 1) * 100).rounded()))% больше, чем в прошлом месяце к этому дню (\(Fmt.money(n.expenses)) против \(Fmt.money(prevSame)))."))
        } else if prevSame > 0 && n.expenses < prevSame * 0.85 {
            out.append(Insight(tone: .good, text: "Расходы ниже прошлого месяца на \(Int(((1 - n.expenses / prevSame) * 100).rounded()))% — так держать 👍"))
        }
        if let top = spent.max(by: { $0.value < $1.value }), n.expenses > 0, top.value / n.expenses >= 0.45, spent.count > 1 {
            out.append(Insight(tone: .info, text: "\(Int((top.value / n.expenses * 100).rounded()))% расходов месяца — «\(top.key)». Если хочется экономить, начинать стоит здесь."))
        }
        for g in extra.goals where g.amount - g.saved > 0 {
            guard let dl = g.deadline, let d = DateUtil.date(dl) else { continue }
            if d < now { out.append(Insight(tone: .warn, text: "Срок цели «\(g.name)» прошёл, не хватает \(Fmt.money(g.amount - g.saved)). Передвинь дату или пополни копилку.")); continue }
            if let m = goalMonthly(g, now: now) { out.append(Insight(tone: .info, text: "Чтобы успеть с «\(g.name)» к \(DateUtil.text(d, "d MMMM")), откладывай ≈ \(Fmt.money(m)) в месяц.")) }
        }
        for dbt in extra.debts where dbt.left > 0 {
            guard let due = dbt.due, due < today, let dd = DateUtil.date(due) else { continue }
            let days = DateUtil.daysBetween(dd, now)
            out.append(Insight(tone: .warn, text: dbt.direction == .owed
                ? "\(dbt.person) задерживает \(Fmt.money(dbt.left)) уже \(daysWord(days)) — самое время напомнить."
                : "Долг \(dbt.person) на \(Fmt.money(dbt.left)) просрочен на \(daysWord(days))."))
        }
        if let p = payday(today: now), due.isEmpty {
            let kind = p.kind == .advance ? "Аванс" : "Зарплата"
            let exp = p.expected > 0 ? " (≈ \(Fmt.money(p.expected)))" : ""
            out.append(Insight(tone: .info, text: "\(kind) через \(daysWord(p.days))\(exp). До этого можно тратить ≈ \(Fmt.money(max(0, n.free) / Double(max(1, p.days)))) в день."))
        }
        if n.income > 0 && n.rate >= 30 && n.expenses > 0 {
            out.append(Insight(tone: .good, text: "Остаётся \(n.rate)% заработка — отличный темп. Отложи часть в копилку, пока не потратилось."))
        }
        if out.isEmpty {
            out.append(Insight(tone: .info, text: n.income > 0 ? "Пока всё ровно: расходы под контролем, платежей на неделе нет. Добавь лимиты и цели — подскажу больше." : "Внеси смены и расходы — начну подсказывать, где деньги утекают и сколько можно отложить."))
        }
        let order: [InsightTone: Int] = [.warn: 0, .info: 1, .good: 2]
        return Array(out.sorted { (order[$0.tone] ?? 1) < (order[$1.tone] ?? 1) }.prefix(4))
    }
}
