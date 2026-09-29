import SwiftUI

// MARK: - Операция (расход / доход / перевод)

@MainActor struct TransactionEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let initialType: TxType
    @State private var type: TxType = .expense
    @State private var amount = ""
    @State private var category = ""
    @State private var accountId = ""
    @State private var toAccountId = ""
    @State private var date = Date()
    @State private var note = ""
    @State private var loaded = false

    private var accountOptions: [(String, String)] { [("", "Без счёта")] + store.extra.accounts.map { ($0.id, $0.name) } }
    private var categoryOptions: [(String, String)] {
        type == .income ? Category.incomeNames.map { ($0, $0) } : store.extra.categories.map { ($0.name, "\($0.emoji) \($0.name)") }
    }

    var body: some View {
        SheetScaffold(eyebrow: "Операция", title: type == .expense ? "Новая трата" : type == .income ? "Новый доход" : "Перевод между счетами") {
            Segmented(options: [(TxType.expense, "Расход"), (TxType.income, "Доход"), (TxType.transfer, "Перевод")], selection: $type)
            MoneyField(label: "Сумма", text: $amount, autoFocus: true)
            if type != .transfer {
                PickerField(label: "Категория", selection: $category, options: categoryOptions)
            }
            HStack(spacing: 10) {
                if type == .transfer {
                    PickerField(label: "Со счёта", selection: $accountId, options: store.extra.accounts.map { ($0.id, $0.name) })
                    PickerField(label: "На счёт", selection: $toAccountId, options: store.extra.accounts.map { ($0.id, $0.name) })
                } else {
                    PickerField(label: "Счёт", selection: $accountId, options: accountOptions)
                }
            }
            if type == .transfer && store.extra.accounts.count < 2 {
                Text("Для перевода нужны минимум два счёта — добавь их на экране «Финансы».").font(.system(size: 13, weight: .medium)).foregroundColor(Theme.dangerText)
            }
            DateField(label: "Дата", date: $date)
            TextInputField(label: "Комментарий", text: $note, placeholder: "Например: обед, проезд, аванс")
            Button(type == .expense ? "Добавить расход" : type == .income ? "Добавить доход" : "Перевести") { save() }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true; type = initialType; resetCategory()
            if let first = store.extra.accounts.first { accountId = type == .transfer ? first.id : "" }
            if store.extra.accounts.count > 1 { toAccountId = store.extra.accounts[1].id }
        }
        .onChange(of: type) { _ in
            resetCategory()
            if type == .transfer, accountId.isEmpty, let first = store.extra.accounts.first { accountId = first.id }
        }
        .presentationDetents([.large])
    }

    private func resetCategory() { category = categoryOptions.first?.0 ?? "" }

    private func save() {
        let v = Fmt.parse(amount)
        guard v > 0 else { store.showToast("Укажи сумму"); return }
        var t = Transaction()
        t.type = type; t.amount = v; t.date = DateUtil.key(date); t.note = note.trimmingCharacters(in: .whitespaces)
        t.category = type == .transfer ? "" : category
        t.accountId = accountId.isEmpty ? nil : accountId
        t.toAccountId = type == .transfer ? (toAccountId.isEmpty ? nil : toAccountId) : nil
        if type == .transfer && (t.accountId == nil || t.toAccountId == nil || t.accountId == t.toAccountId) { store.showToast("Выбери два разных счёта"); return }
        store.addTransaction(t)
        hapticSuccess()
        store.showToast(type == .expense ? "Расход добавлен" : type == .income ? "Доход добавлен" : "Перевод записан")
        dismiss()
    }
}

// MARK: - Счёт

@MainActor struct AccountEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let account: Account?
    @State private var name = ""
    @State private var type: AccountType = .card
    @State private var balance = ""
    @State private var loaded = false
    @State private var confirmDelete = false

    var body: some View {
        SheetScaffold(eyebrow: "Счёт", title: account == nil ? "Новый счёт" : "Счёт") {
            TextInputField(label: "Название", text: $name, placeholder: "Например: Карта Сбер")
            PickerField(label: "Тип", selection: $type, options: AccountType.allCases.map { ($0, $0.title) })
            MoneyField(label: "Баланс сейчас", text: $balance, hint: "Дальше баланс считается сам: доходы, расходы и переводы меняют его автоматически.")
            Button("Сохранить счёт") {
                let n = name.trimmingCharacters(in: .whitespaces)
                guard !n.isEmpty else { store.showToast("Назови счёт"); return }
                var a = account ?? Account(); a.name = n; a.type = type
                store.saveAccount(a, desiredBalance: Fmt.parse(balance))
                hapticSuccess(); store.showToast("Счёт сохранён"); dismiss()
            }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
            if account != nil {
                Button("Удалить счёт", role: .destructive) { confirmDelete = true }.font(.system(size: 15, weight: .bold)).foregroundColor(Theme.dangerText).frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let a = account { name = a.name; type = a.type; balance = Fmt.input(store.finance.balance(of: a)) }
        }
        .alert("Удалить счёт?", isPresented: $confirmDelete) {
            Button("Удалить", role: .destructive) { if let a = account { store.deleteAccount(id: a.id) }; dismiss() }
            Button("Отмена", role: .cancel) {}
        } message: { Text("Операции останутся, но перестанут относиться к этому счёту.") }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Категории и лимиты

@MainActor struct LimitsEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var limits: [String: String] = [:]
    @State private var newName = ""
    @State private var loaded = false

    var body: some View {
        SheetScaffold(eyebrow: "Лимиты", title: "Категории и лимиты") {
            Text("Лимит — сколько максимум хочешь тратить по категории за месяц. Пусто — без лимита.").font(.system(size: 14, weight: .medium)).foregroundColor(Theme.ink2)
            VStack(spacing: 8) {
                ForEach(store.extra.categories) { c in
                    HStack(spacing: 8) {
                        Text("\(c.emoji) \(c.name)").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.ink).lineLimit(1)
                        Spacer()
                        TextField("без лимита", text: Binding(get: { limits[c.id] ?? "" }, set: { limits[c.id] = $0 }))
                            .keyboardType(.decimalPad).font(.num(15)).multilineTextAlignment(.trailing)
                            .frame(width: 120, height: 40).padding(.horizontal, 10)
                            .background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Theme.line, lineWidth: 1))
                        Button {
                            if !store.deleteCategory(id: c.id) { store.showToast("Категория используется в операциях — сначала удали их") }
                        } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundColor(Theme.muted).frame(width: 34, height: 34).background(Theme.surface3).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous)) }.buttonStyle(.plain)
                    }
                }
            }
            HStack(spacing: 8) {
                TextField("Новая категория", text: $newName).font(.system(size: 15, weight: .semibold)).padding(.horizontal, 12).frame(height: 44)
                    .background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line, lineWidth: 1))
                Button { if store.addCategory(name: newName) { newName = "" } else { store.showToast("Такая категория уже есть") } } label: { Label("Добавить", systemImage: "plus") }.buttonStyle(SoftButtonStyle())
            }.padding(.top, 6)
            Button("Сохранить лимиты") {
                var cats = store.extra.categories
                for i in cats.indices { cats[i].limit = max(0, Fmt.parse(limits[cats[i].id] ?? "")) }
                store.saveCategories(cats); hapticSuccess(); store.showToast("Лимиты сохранены"); dismiss()
            }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            for c in store.extra.categories { limits[c.id] = c.limit > 0 ? Fmt.input(c.limit) : "" }
        }
        .presentationDetents([.large])
    }
}

// MARK: - Регулярный платёж

@MainActor struct RecurringEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let recurring: Recurring?
    @State private var name = ""
    @State private var amount = ""
    @State private var day = ""
    @State private var category = "Жильё"
    @State private var accountId = ""
    @State private var loaded = false
    @State private var confirmDelete = false

    var body: some View {
        SheetScaffold(eyebrow: "Регулярный платёж", title: recurring == nil ? "Новый платёж" : "Платёж") {
            TextInputField(label: "Название", text: $name, placeholder: "Аренда, кредит, подписка")
            HStack(spacing: 10) {
                MoneyField(label: "Сумма", text: $amount)
                MoneyField(label: "День месяца", text: $day, placeholder: "1", suffix: "")
            }
            PickerField(label: "Категория", selection: $category, options: store.extra.categories.map { ($0.name, "\($0.emoji) \($0.name)") })
            PickerField(label: "Счёт списания", selection: $accountId, options: [("", "Без счёта")] + store.extra.accounts.map { ($0.id, $0.name) })
            Button("Сохранить") {
                let n = name.trimmingCharacters(in: .whitespaces), a = Fmt.parse(amount)
                guard !n.isEmpty, a > 0 else { store.showToast("Укажи название и сумму"); return }
                var r = recurring ?? Recurring()
                r.name = n; r.amount = a; r.day = min(31, max(1, Int(Fmt.parse(day)))); r.category = category; r.accountId = accountId.isEmpty ? nil : accountId
                store.saveRecurring(r); hapticSuccess(); store.showToast("Платёж сохранён"); dismiss()
            }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
            if recurring != nil {
                Button("Удалить платёж", role: .destructive) { confirmDelete = true }.font(.system(size: 15, weight: .bold)).foregroundColor(Theme.dangerText).frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let r = recurring { name = r.name; amount = Fmt.input(r.amount); day = String(r.day); category = r.category; accountId = r.accountId ?? "" }
            else { day = String(DateUtil.day(Date())); if let c = store.extra.categories.first(where: { $0.name == "Жильё" }) ?? store.extra.categories.first { category = c.name } }
        }
        .alert("Удалить платёж?", isPresented: $confirmDelete) {
            Button("Удалить", role: .destructive) { if let r = recurring { store.deleteRecurring(id: r.id) }; dismiss() }
            Button("Отмена", role: .cancel) {}
        }
        .presentationDetents([.large])
    }
}

// MARK: - Долг

@MainActor struct DebtEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let debt: Debt?
    @State private var direction: DebtDirection = .iOwe
    @State private var person = ""
    @State private var amount = ""
    @State private var due: Date? = nil
    @State private var note = ""
    @State private var loaded = false
    @State private var confirmDelete = false

    var body: some View {
        SheetScaffold(eyebrow: "Долг", title: debt == nil ? "Новый долг" : "Долг") {
            Segmented(options: [(DebtDirection.iOwe, "Я должен"), (DebtDirection.owed, "Мне должны")], selection: $direction)
            TextInputField(label: "Кому / кто", text: $person, placeholder: "Имя")
            MoneyField(label: "Сумма", text: $amount)
            OptionalDateField(label: "Вернуть до", date: $due)
            TextInputField(label: "Комментарий", text: $note, placeholder: "Необязательно")
            Button("Сохранить") {
                let p = person.trimmingCharacters(in: .whitespaces), a = Fmt.parse(amount)
                guard !p.isEmpty, a > 0 else { store.showToast("Укажи имя и сумму"); return }
                var d = debt ?? Debt()
                d.person = p; d.amount = a; d.direction = direction; d.note = note.trimmingCharacters(in: .whitespaces); d.due = due.map { DateUtil.key($0) }
                store.saveDebt(d); hapticSuccess(); store.showToast("Долг сохранён"); dismiss()
            }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
            if debt != nil {
                Button("Удалить долг", role: .destructive) { confirmDelete = true }.font(.system(size: 15, weight: .bold)).foregroundColor(Theme.dangerText).frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let d = debt { direction = d.direction; person = d.person; amount = Fmt.input(d.amount); due = d.due.flatMap { DateUtil.date($0) }; note = d.note }
        }
        .alert("Удалить долг?", isPresented: $confirmDelete) {
            Button("Удалить", role: .destructive) { if let d = debt { store.deleteDebt(id: d.id) }; dismiss() }
            Button("Отмена", role: .cancel) {}
        }
        .presentationDetents([.large])
    }
}

// MARK: - Цель (копилка)

@MainActor struct GoalEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var emoji = Goal.emojis[0]
    @State private var name = ""
    @State private var amount = ""
    @State private var saved = ""
    @State private var deadline: Date? = nil

    var body: some View {
        SheetScaffold(eyebrow: "Копилка", title: "Новая цель") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Goal.emojis, id: \.self) { e in
                        Button { emoji = e; hapticTap() } label: {
                            Text(e).font(.system(size: 20)).frame(width: 42, height: 42)
                                .background(emoji == e ? Theme.accentSoft : Theme.surface2)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(emoji == e ? Theme.accent : Theme.line, lineWidth: emoji == e ? 2 : 1))
                        }.buttonStyle(.plain)
                    }
                }.padding(2)
            }
            TextInputField(label: "Название", text: $name, placeholder: "Например: новый телефон")
            HStack(spacing: 10) {
                MoneyField(label: "Нужно накопить", text: $amount)
                MoneyField(label: "Уже отложено", text: $saved)
            }
            OptionalDateField(label: "Хочу успеть к", date: $deadline, hint: "Необязательно. Подскажу, сколько откладывать в месяц.")
            Button("Создать цель") {
                let n = name.trimmingCharacters(in: .whitespaces), a = Fmt.parse(amount), s = max(0, Fmt.parse(saved))
                guard !n.isEmpty, a > 0 else { store.showToast("Укажи название и сумму цели"); return }
                var g = Goal(); g.name = n; g.amount = a; g.saved = s; g.emoji = emoji; g.deadline = deadline.map { DateUtil.key($0) }
                if s > 0 { g.deposits = [GoalDeposit(amount: s, note: "стартовый взнос")] }
                store.saveGoal(g); hapticSuccess(); store.showToast("Копилка создана 🎯"); dismiss()
            }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
        }
        .presentationDetents([.large])
    }
}

@MainActor struct GoalHistorySheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let goalID: String
    var body: some View {
        let g = store.extra.goals.first { $0.id == goalID }
        SheetScaffold(eyebrow: "Взносы", title: g.map { "\($0.emoji) \($0.name)" } ?? "Копилка") {
            if let g = g {
                Text("Отложено \(Fmt.money(g.saved)) из \(Fmt.money(g.amount))").font(.system(size: 14, weight: .semibold)).foregroundColor(Theme.ink2)
                if g.deposits.isEmpty { EmptyHint(text: "Взносов пока нет.") }
                ForEach(g.deposits.sorted { $0.date > $1.date }) { d in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(DateUtil.shortDay(d.date)).font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink)
                            if !d.note.isEmpty { Text(d.note).font(.system(size: 12.5)).foregroundColor(Theme.muted) }
                        }
                        Spacer()
                        Text("+" + Fmt.money(d.amount)).font(.num(15, weight: .heavy)).foregroundColor(Theme.successText)
                    }.padding(.vertical, 8)
                    Divider().background(Theme.line)
                }
            }
            Button("Закрыть") { dismiss() }.buttonStyle(PrimaryButtonStyle(fill: Theme.surface3, text: Theme.ink)).padding(.top, 8)
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Ввод суммы (пополнение, возврат долга)

@MainActor struct AmountPrompt: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let subtitle: String
    let suggested: Double
    let onDone: (Double) -> Void
    @State private var text = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SheetHeader(eyebrow: "Сумма", title: title)
            Text(subtitle).font(.system(size: 14, weight: .medium)).foregroundColor(Theme.ink2)
            MoneyField(label: "Сумма", text: $text, autoFocus: true)
            HStack(spacing: 8) {
                ForEach([500.0, 1000, 2000, 5000], id: \.self) { v in
                    Button("+\(Int(v))") { text = Fmt.input(Fmt.parse(text) + v) }.buttonStyle(SoftButtonStyle(small: true))
                }
                Spacer()
            }
            Button("Готово") {
                let v = Fmt.parse(text)
                guard v > 0 else { return }
                onDone(v); dismiss()
            }.buttonStyle(PrimaryButtonStyle())
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20).padding(.top, 10)
        .background(Theme.bg.ignoresSafeArea())
        .onAppear { text = Fmt.input(suggested) }
        .presentationDetents([.height(380), .large])
    }
}

// MARK: - Дни выплат

@MainActor struct PaydayEditor: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var advance = ""
    @State private var salary = ""
    @State private var loaded = false

    var body: some View {
        SheetScaffold(eyebrow: "Выплаты", title: "Дни аванса и зарплаты") {
            Text("Укажи числа, когда приходят деньги — покажу обратный отсчёт и ожидаемую сумму. 0 — не показывать.").font(.system(size: 14, weight: .medium)).foregroundColor(Theme.ink2)
            HStack(spacing: 10) {
                MoneyField(label: "Аванс — число", text: $advance, placeholder: "25", suffix: "")
                MoneyField(label: "Зарплата — число", text: $salary, placeholder: "10", suffix: "")
            }
            Button("Сохранить") {
                var p = Payday(); p.advanceDay = min(31, max(0, Int(Fmt.parse(advance)))); p.salaryDay = min(31, max(0, Int(Fmt.parse(salary))))
                store.setPayday(p); hapticSuccess(); store.showToast("Даты выплат сохранены"); dismiss()
            }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
        }
        .onAppear { guard !loaded else { return }; loaded = true; advance = String(store.extra.payday.advanceDay); salary = String(store.extra.payday.salaryDay) }
        .presentationDetents([.medium])
    }
}
