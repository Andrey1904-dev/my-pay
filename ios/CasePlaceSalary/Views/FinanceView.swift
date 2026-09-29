import SwiftUI

@MainActor struct FinanceView: View {
    @EnvironmentObject var store: AppStore

    enum Sheet: Identifiable {
        case transaction(TxType), account(Account?), limits, recurring(Recurring?), debt(Debt?), goal, payday
        case amount(title: String, subtitle: String, suggested: Double, onDone: (Double) -> Void)
        case goalHistory(Goal)
        var id: String {
            switch self {
            case .transaction(let t): return "tx_\(t.rawValue)"
            case .account(let a): return "acc_\(a?.id ?? "new")"
            case .limits: return "limits"
            case .recurring(let r): return "rec_\(r?.id ?? "new")"
            case .debt(let d): return "debt_\(d?.id ?? "new")"
            case .goal: return "goal"
            case .payday: return "payday"
            case .amount(let t, _, _, _): return "amount_\(t)"
            case .goalHistory(let g): return "hist_\(g.id)"
            }
        }
    }
    @State private var sheet: Sheet? = nil
    @State private var filter: TxType? = nil
    @State private var limit = 12
    @State private var deletingGoal: Goal? = nil

    private var engine: FinanceEngine { store.finance }
    private static let filterOptions: [(TxType?, String)] = [(nil, "Все"), (TxType.expense, "Расходы"), (TxType.income, "Доходы")]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    PageHead(eyebrow: "Деньги под контролем", title: "Финансы") {
                        IconButton(system: "plus", accent: true) { sheet = .transaction(.expense) }
                    }
                    let n = engine.numbers()
                    Group {
                        hero(n)
                        paydayStrip
                        quickActions
                        accountsSection
                        tiles(n)
                        insightsCard
                    }
                    Group {
                        limitsCard
                        recurringCard
                        debtsCard
                        goalsCard
                        transactionsCard
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .screenBackground()
            .navigationBarHidden(true)
            .refreshable { await store.refreshFromCloud() }
            .sheet(item: $sheet) { s in sheetView(s) }
            .alert("Удалить копилку?", isPresented: Binding(get: { deletingGoal != nil }, set: { if !$0 { deletingGoal = nil } })) {
                Button("Удалить", role: .destructive) { if let g = deletingGoal { store.deleteGoal(id: g.id) }; deletingGoal = nil }
                Button("Отмена", role: .cancel) { deletingGoal = nil }
            } message: { Text("«\(deletingGoal?.name ?? "")» будет удалена без возможности восстановления.") }
        }
    }

    @ViewBuilder
    private func sheetView(_ s: Sheet) -> some View {
        switch s {
        case .transaction(let t): TransactionEditor(initialType: t)
        case .account(let a): AccountEditor(account: a)
        case .limits: LimitsEditor()
        case .recurring(let r): RecurringEditor(recurring: r)
        case .debt(let d): DebtEditor(debt: d)
        case .goal: GoalEditor()
        case .payday: PaydayEditor()
        case .amount(let title, let subtitle, let suggested, let onDone): AmountPrompt(title: title, subtitle: subtitle, suggested: suggested, onDone: onDone)
        case .goalHistory(let g): GoalHistorySheet(goalID: g.id)
        }
    }

    // MARK: Hero

    private func hero(_ n: FinanceNumbers) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Theme.accent).frame(height: 3).clipShape(Capsule()).padding(.horizontal, 6)
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("СВОБОДНО В ЭТОМ МЕСЯЦЕ").font(.system(size: 11.5, weight: .bold)).kerning(1).foregroundColor(Theme.onGraphiteMuted)
                    Text(Fmt.signedMoney(n.free)).font(.num(36, weight: .heavy)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.6)
                    Text(n.income <= 0 && n.expenses <= 0 ? "Внеси смены и расходы — посчитаем, сколько остаётся" : n.free > 0 ? "≈ \(Fmt.money(n.daily)) в день до конца месяца\(n.upcoming > 0 ? " с учётом платежей" : "")" : "Расходы уже выше заработка за месяц")
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                RingView(progress: Double(n.rate) / 100, label: "\(n.rate)%", caption: "остаётся")
            }
            .padding(18)
        }
        .background(Theme.graphite)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
    }

    private var paydayStrip: some View {
        let p = engine.payday()
        return HStack(spacing: 12) {
            Image(systemName: "creditcard.fill").font(.system(size: 16, weight: .bold)).foregroundColor(Theme.onAccent).frame(width: 38, height: 38).background(Theme.accent).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                if let p = p {
                    let label = p.kind == .advance ? "аванса" : "зарплаты"
                    Text(p.days == 0 ? "Сегодня день \(label) 🎉" : "До \(label) \(p.days) \(plural(p.days, "день", "дня", "дней"))").font(.system(size: 15, weight: .heavy)).foregroundColor(Theme.ink)
                    Text("\(DateUtil.text(p.date, "d MMMM"))\(p.expected > 0 ? " · ожидаемо ≈ \(Fmt.money(p.expected))" : "")").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.accentText)
                } else {
                    Text("Когда аванс и зарплата?").font(.system(size: 15, weight: .heavy)).foregroundColor(Theme.ink)
                    Text("Укажи даты — покажу обратный отсчёт").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.accentText)
                }
            }
            Spacer()
            Button("Даты") { sheet = .payday }.font(.system(size: 13, weight: .bold)).foregroundColor(Theme.accentText)
        }
        .padding(12)
        .background(Theme.accentSoft)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous).stroke(Theme.accentSoftLine, lineWidth: 1))
    }

    private var quickActions: some View {
        HStack(spacing: 8) {
            quick("minus", "Расход", Theme.dangerSoft, Theme.dangerText) { sheet = .transaction(.expense) }
            quick("plus", "Доход", Theme.successSoft, Theme.successText) { sheet = .transaction(.income) }
            quick("arrow.left.arrow.right", "Перевод", Theme.surface3, Theme.ink2) { sheet = .transaction(.transfer) }
            quick("target", "В копилку", Theme.accentSoft, Theme.accentText) { quickGoalDeposit() }
        }
    }
    private func quick(_ system: String, _ title: String, _ bg: Color, _ fg: Color, action: @escaping () -> Void) -> some View {
        Button(action: { action(); hapticTap() }) {
            VStack(spacing: 7) {
                Image(systemName: system).font(.system(size: 16, weight: .bold)).foregroundColor(fg).frame(width: 38, height: 38).background(bg).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(title).font(.system(size: 12.5, weight: .bold)).foregroundColor(Theme.ink)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 11)
            .background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous).stroke(Theme.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }

    private func quickGoalDeposit() {
        let goals = store.extra.goals
        guard let g = goals.first(where: { !$0.isDone }) ?? goals.first else { sheet = .goal; return }
        sheet = .amount(title: "\(g.emoji) Пополнить «\(g.name)»", subtitle: "Отложено \(Fmt.money(g.saved)) из \(Fmt.money(g.amount)).", suggested: 1000, onDone: { v in store.topUpGoal(id: g.id, amount: v) })
    }

    // MARK: Счета

    private var accountsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 3) { Eyebrow(text: "Счета"); Text("Где лежат деньги").font(.system(size: 17, weight: .bold)).foregroundColor(Theme.ink) }
                Spacer()
                Button { sheet = .account(nil) } label: { Label("Счёт", systemImage: "plus") }.buttonStyle(SoftButtonStyle(small: true))
            }
            if store.extra.accounts.isEmpty {
                Button { sheet = .account(nil) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Добавь счета").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink)
                        Text("Карта, наличные, накопительный — балансы будут считаться сами по операциям.").font(.system(size: 13, weight: .medium)).foregroundColor(Theme.muted).multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                    .background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous).stroke(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
                }.buttonStyle(.plain)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Всего на счетах").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted)
                            Text(Fmt.signedMoney(engine.totalBalance)).font(.num(20, weight: .heavy)).foregroundColor(.white)
                            Text("\(store.extra.accounts.count) \(plural(store.extra.accounts.count, "счёт", "счёта", "счетов"))").font(.system(size: 11.5, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted)
                        }
                        .padding(14).frame(minWidth: 150, alignment: .leading).background(Theme.graphite).clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
                        ForEach(store.extra.accounts) { a in
                            let b = engine.balance(of: a)
                            Button { sheet = .account(a) } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Image(systemName: a.type.symbol).font(.system(size: 13, weight: .bold)).foregroundColor(Theme.accentText).frame(width: 28, height: 28).background(Theme.accentSoft).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous)).padding(.bottom, 4)
                                    Text(a.name).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.muted).lineLimit(1)
                                    Text(Fmt.signedMoney(b)).font(.num(18, weight: .heavy)).foregroundColor(b < 0 ? Theme.dangerText : Theme.ink)
                                    Text(a.type.title).font(.system(size: 11.5, weight: .semibold)).foregroundColor(Theme.muted)
                                }
                                .padding(14).frame(minWidth: 140, alignment: .leading)
                                .background(Theme.surface).clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous).stroke(Theme.line, lineWidth: 1))
                            }.buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func tiles(_ n: FinanceNumbers) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            StatTile(title: "Заработано", value: Fmt.money(n.income))
            StatTile(title: "Расходы", value: Fmt.money(n.expenses), tint: n.expenses > 0 ? Theme.dangerText : Theme.ink)
            StatTile(title: "Получено на счета", value: Fmt.money(n.received), tint: n.received > 0 ? Theme.successText : Theme.ink)
            StatTile(title: "Остаток к концу месяца", value: Fmt.signedMoney(n.forecast))
        }
    }

    // MARK: Советник

    private var insightsCard: some View {
        Card {
            SectionHeader("Советник", "Что стоит знать") { Chip(text: "авто", system: "sparkles", style: .accent) }
            VStack(spacing: 8) {
                ForEach(engine.insights()) { i in
                    HStack(alignment: .top, spacing: 10) {
                        Text(i.tone == .warn ? "⚠️" : i.tone == .good ? "✅" : "💡").font(.system(size: 16))
                        Text(i.text).font(.system(size: 14, weight: .medium)).foregroundColor(Theme.ink).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(i.tone == .warn ? Theme.dangerSoft : i.tone == .good ? Theme.successSoft : Theme.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .overlay(HStack { RoundedRectangle(cornerRadius: 2).fill(i.tone == .warn ? Theme.danger : i.tone == .good ? Theme.success : Theme.accent).frame(width: 3); Spacer() }.padding(.vertical, 8).padding(.leading, 0))
                }
            }
        }
    }

    // MARK: Лимиты

    private var limitsCard: some View {
        let spent = engine.spentByCategory(month: Date())
        var cats = store.extra.categories.filter { $0.limit > 0 || (spent[$0.name] ?? 0) > 0 }
        for (name, _) in spent where !cats.contains(where: { $0.name == name }) { cats.append(Category(id: "tmp_" + name, name: name, emoji: "📦")) }
        let sorted = cats.sorted { (spent[$0.name] ?? 0) > (spent[$1.name] ?? 0) }
        let maxV = max(1, sorted.map { max(spent[$0.name] ?? 0, $0.limit) }.max() ?? 1)
        return Card {
            SectionHeader("Лимиты", "Расходы по категориям") { Button { sheet = .limits } label: { Label("Лимиты", systemImage: "target") }.buttonStyle(SoftButtonStyle(small: true)) }
            if sorted.isEmpty { EmptyHint(text: "Расходов пока нет. Добавь первую трату или задай лимиты по категориям.") }
            VStack(spacing: 12) {
                ForEach(sorted) { c in
                    let s = spent[c.name] ?? 0
                    let over = c.limit > 0 && s >= c.limit, warn = c.limit > 0 && s / c.limit >= 0.8
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("\(c.emoji) \(c.name)").font(.system(size: 14, weight: .semibold)).foregroundColor(Theme.ink2)
                            Spacer()
                            (Text(Fmt.money(s)).font(.num(14, weight: .heavy)).foregroundColor(Theme.ink) + Text(c.limit > 0 ? " / \(Fmt.money(c.limit))" : "").font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.muted))
                        }
                        Track(progress: c.limit > 0 ? s / c.limit : s / maxV, color: over ? Theme.danger : warn ? Theme.warn : Theme.accent, height: 7)
                        if c.limit > 0 { Text(over ? "Превышен на \(Fmt.money(s - c.limit))" : "Осталось \(Fmt.money(c.limit - s))").font(.system(size: 12, weight: .semibold)).foregroundColor(over ? Theme.dangerText : Theme.muted) }
                    }
                }
            }
        }
    }

    // MARK: Регулярные платежи

    private var recurringCard: some View {
        let list = store.extra.recurring.map { ($0, engine.nextDate(of: $0)) }.sorted { $0.1 < $1.1 }
        let p = DateUtil.monthPrefix(Date())
        return Card {
            SectionHeader("Регулярные платежи", "Что скоро списывать") { Button { sheet = .recurring(nil) } label: { Label("Платёж", systemImage: "plus") }.buttonStyle(SoftButtonStyle(small: true)) }
            if list.isEmpty { EmptyHint(text: "Аренда, кредит, связь, подписки — добавь, и я напомню заранее и учту в остатке.") }
            ForEach(list, id: \.0.id) { item in
                let r = item.0, next = item.1
                let days = DateUtil.daysBetween(Date(), next), paid = r.lastPaid == p
                HStack(spacing: 10) {
                    Button { sheet = .recurring(r) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(engine.category(named: r.category)?.emoji ?? "📦") \(r.name)").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink).lineLimit(1)
                            Text(paid ? "оплачено в этом месяце" : days < 0 ? "просрочен на \(-days) \(plural(-days, "день", "дня", "дней"))" : days == 0 ? "сегодня" : days == 1 ? "завтра" : "через \(days) \(plural(days, "день", "дня", "дней")) · \(DateUtil.text(next, "d MMM"))")
                                .font(.system(size: 12.5, weight: .semibold)).foregroundColor(days < 0 && !paid ? Theme.dangerText : days <= 3 && !paid ? Theme.accentText : Theme.muted)
                        }
                        .contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    Spacer()
                    Text(Fmt.money(r.amount)).font(.num(15, weight: .heavy)).foregroundColor(Theme.ink)
                    if paid {
                        Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.successText).frame(width: 34, height: 34).background(Theme.successSoft).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    } else {
                        Button("Оплатил") { store.payRecurring(id: r.id); hapticSuccess() }.buttonStyle(SoftButtonStyle(small: true))
                    }
                }
                .padding(.vertical, 8).opacity(paid ? 0.6 : 1)
                Divider().background(Theme.line)
            }
        }
    }

    // MARK: Долги

    private var debtsCard: some View {
        let debts = store.extra.debts.filter { $0.left > 0.001 }.sorted { ($0.due ?? "9999") < ($1.due ?? "9999") }
        let iOwe = debts.filter { $0.direction == .iOwe }.reduce(0) { $0 + $1.left }
        let owed = debts.filter { $0.direction == .owed }.reduce(0) { $0 + $1.left }
        let today = DateUtil.todayKey
        return Card {
            SectionHeader("Долги", "Кто кому должен") { Button { sheet = .debt(nil) } label: { Label("Долг", systemImage: "plus") }.buttonStyle(SoftButtonStyle(small: true)) }
            if debts.isEmpty { EmptyHint(text: "Одолжил другу или взял до зарплаты — запиши, чтобы ничего не потерялось.") } else {
                HStack(spacing: 8) {
                    debtTotal("Я должен", Fmt.money(iOwe), Theme.ink)
                    debtTotal("Мне должны", Fmt.money(owed), Theme.ink)
                    debtTotal("Баланс", (owed - iOwe >= 0 ? "+" : "−") + Fmt.money(abs(owed - iOwe)), owed - iOwe >= 0 ? Theme.successText : Theme.dangerText)
                }.padding(.bottom, 6)
            }
            ForEach(debts) { d in
                let overdue = d.due.map { $0 < today } ?? false
                HStack(alignment: .center, spacing: 10) {
                    Button { sheet = .debt(d) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(d.direction == .owed ? "→" : "←") \(d.person)").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink)
                            Text("\(d.direction == .owed ? "должен тебе" : "ты должен") · \(d.due.map { (overdue ? "просрочено с " : "до ") + DateUtil.shortDay($0) } ?? "без срока")\(d.note.isEmpty ? "" : " · " + d.note)")
                                .font(.system(size: 12.5, weight: .semibold)).foregroundColor(overdue ? Theme.dangerText : Theme.muted).lineLimit(2)
                            Track(progress: d.amount > 0 ? d.paid / d.amount : 0, color: d.direction == .owed ? Theme.success : Theme.accent, height: 5)
                        }
                        .contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    VStack(alignment: .trailing, spacing: 6) {
                        Text(Fmt.money(d.left)).font(.num(15, weight: .heavy)).foregroundColor(Theme.ink)
                        Button(d.direction == .owed ? "Вернули" : "Вернул") {
                            sheet = .amount(title: d.direction == .owed ? "Сколько вернули?" : "Сколько вернул?", subtitle: "\(d.person): осталось \(Fmt.money(d.left)).", suggested: d.left.rounded(), onDone: { v in store.payDebt(id: d.id, amount: v) })
                        }.buttonStyle(SoftButtonStyle(small: true))
                    }
                }
                .padding(.vertical, 8)
                Divider().background(Theme.line)
            }
        }
    }
    private func debtTotal(_ title: String, _ value: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased()).font(.system(size: 10.5, weight: .bold)).kerning(0.5).foregroundColor(Theme.muted)
            Text(value).font(.num(14, weight: .heavy)).foregroundColor(tint).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(10).background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: Копилки

    private var goalsCard: some View {
        Card {
            SectionHeader("Копилки", "На что копим") { Button { sheet = .goal } label: { Label("Цель", systemImage: "plus") }.buttonStyle(SoftButtonStyle(small: true)) }
            if store.extra.goals.isEmpty { EmptyHint(text: "Копилок пока нет. Создай первую — покажу прогресс, срок и сколько откладывать.") }
            VStack(spacing: 8) {
                ForEach(store.extra.goals) { g in
                    let pct = g.progress
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Text(g.emoji).font(.system(size: 20))
                            Text(g.name).font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink).lineLimit(1)
                            Spacer()
                            Text("\(Fmt.money(g.saved)) / \(Fmt.money(g.amount))").font(.num(12.5, weight: .bold)).foregroundColor(Theme.muted)
                        }
                        Track(progress: pct, color: g.isDone ? Theme.success : Theme.accent)
                        HStack {
                            Text(goalHint(g)).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.muted)
                            Spacer()
                            Text(g.isDone ? "Цель достигнута 🎉" : "осталось \(Fmt.money(max(0, g.amount - g.saved)))").font(.system(size: 12.5, weight: .semibold)).foregroundColor(g.isDone ? Theme.successText : Theme.muted)
                        }
                        HStack(spacing: 8) {
                            Button { sheet = .amount(title: "\(g.emoji) Пополнить «\(g.name)»", subtitle: "Отложено \(Fmt.money(g.saved)) из \(Fmt.money(g.amount)).", suggested: 1000, onDone: { v in store.topUpGoal(id: g.id, amount: v) }) } label: { Label("Пополнить", systemImage: "plus") }.buttonStyle(SoftButtonStyle(small: true))
                            Button("\(g.deposits.count) \(plural(g.deposits.count, "взнос", "взноса", "взносов"))") { sheet = .goalHistory(g) }.font(.system(size: 13, weight: .bold)).foregroundColor(Theme.ink2).padding(.horizontal, 6)
                            Spacer()
                            Button { deletingGoal = g } label: { Image(systemName: "trash").font(.system(size: 13, weight: .bold)).foregroundColor(Theme.dangerText).frame(width: 36, height: 36).background(Theme.dangerSoft).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous)) }.buttonStyle(.plain)
                        }
                    }
                    .padding(14).background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        }
    }
    private func goalHint(_ g: Goal) -> String {
        let pct = Int((g.progress * 100).rounded())
        if g.isDone { return "\(pct)%" }
        if let dl = g.deadline, let d = DateUtil.date(dl) {
            if d < Date() { return "\(pct)% · срок прошёл" }
            if let m = engine.goalMonthly(g) { return "\(pct)% · к \(DateUtil.shortDay(dl)) · ≈ \(Fmt.money(m)) в мес." }
        }
        if let eta = engine.goalETA(g) { return "\(pct)% · при таком темпе — к \(DateUtil.text(eta, "d MMM"))" }
        return "\(pct)%"
    }

    // MARK: Операции

    private var transactionsCard: some View {
        let all = store.extra.transactions.filter { filter == nil || $0.type == filter! }.sorted { $0.date == $1.date ? $0.id > $1.id : $0.date > $1.date }
        let shown = Array(all.prefix(limit))
        return Card {
            SectionHeader("Операции", "История") {
                Segmented(options: FinanceView.filterOptions, selection: $filter).frame(width: 210)
            }
            if all.isEmpty { EmptyHint(text: "Операций пока нет. Нажми «Расход» или «Доход» вверху экрана.") }
            ForEach(Array(shown.enumerated()), id: \.element.id) { idx, t in
                let month = String(t.date.prefix(7))
                if idx == 0 || String(shown[idx - 1].date.prefix(7)) != month {
                    Text(DateUtil.date(t.date).map { DateUtil.text($0, "LLLL yyyy").uppercased() } ?? month).font(.system(size: 11.5, weight: .heavy)).kerning(0.8).foregroundColor(Theme.muted).padding(.top, idx == 0 ? 0 : 10).padding(.bottom, 4)
                }
                transactionRow(t)
                Divider().background(Theme.line)
            }
            if all.count > shown.count {
                Button("Показать ещё") { limit += 20 }.font(.system(size: 14, weight: .bold)).foregroundColor(Theme.ink2).frame(maxWidth: .infinity, minHeight: 44)
            }
        }
    }

    private func transactionRow(_ t: Transaction) -> some View {
        let acc = engine.account(t.accountId), to = engine.account(t.toAccountId)
        let title = t.type == .transfer ? "\(acc?.name ?? "?") → \(to?.name ?? "?")" : (t.category.isEmpty ? (t.type == .income ? "Доход" : "Расход") : t.category)
        let sub = [DateUtil.shortDay(t.date), t.type != .transfer ? (acc?.name ?? "") : "", t.note].filter { !$0.isEmpty }.joined(separator: " · ")
        let sign = t.type == .income ? "+" : t.type == .expense ? "−" : ""
        return HStack(spacing: 10) {
            Text(engine.emoji(for: t)).font(.system(size: 17)).frame(width: 36, height: 36).background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink).lineLimit(1)
                Text(sub).font(.system(size: 12.5, weight: .medium)).foregroundColor(Theme.muted).lineLimit(1)
            }
            Spacer()
            Text(sign + Fmt.money(t.amount)).font(.num(15, weight: .heavy)).foregroundColor(t.type == .income ? Theme.successText : t.type == .transfer ? Theme.muted : Theme.ink)
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .contextMenu { Button(role: .destructive) { store.deleteTransaction(id: t.id); store.showToast("Операция удалена") } label: { Label("Удалить операцию", systemImage: "trash") } }
    }
}
