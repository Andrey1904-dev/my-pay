import Foundation

// MARK: - Мягкое декодирование: JSON с сайта может содержать числа строками или пропущенные поля.

extension KeyedDecodingContainer {
    func num(_ key: Key, _ fallback: Double = 0) -> Double {
        if let v = try? decodeIfPresent(Double.self, forKey: key) { return v }
        if let v = try? decodeIfPresent(Int.self, forKey: key) { return Double(v) }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Fmt.parse(s) == 0 && s.trimmingCharacters(in: .whitespaces).isEmpty ? fallback : Fmt.parse(s) }
        return fallback
    }
    func int(_ key: Key, _ fallback: Int = 0) -> Int { Int(num(key, Double(fallback)).rounded(.towardZero)) }
    func bool(_ key: Key, _ fallback: Bool = false) -> Bool {
        if let v = try? decodeIfPresent(Bool.self, forKey: key) { return v }
        if let v = try? decodeIfPresent(Int.self, forKey: key) { return v != 0 }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s == "true" || s == "1" }
        return fallback
    }
    func str(_ key: Key, _ fallback: String = "") -> String {
        if let v = try? decodeIfPresent(String.self, forKey: key) { return v }
        if let v = try? decodeIfPresent(Double.self, forKey: key) { return Fmt.input(v) }
        return fallback
    }
    func optStr(_ key: Key) -> String? {
        guard let v = try? decodeIfPresent(String.self, forKey: key), !v.isEmpty else { return nil }
        return v
    }
    func list<T: Decodable>(_ key: Key, _ type: T.Type) -> [T] {
        // Пропускаем битые элементы, а не роняем весь массив.
        guard var c = try? nestedUnkeyedContainer(forKey: key) else { return [] }
        var out: [T] = []
        while !c.isAtEnd {
            let before = c.currentIndex
            if let v = try? c.decode(T.self) { out.append(v) } else { _ = try? c.decode(AnyCodable.self) }
            if c.currentIndex == before { break } // защита от зацикливания на нечитаемом элементе
        }
        return out
    }
}

/// Универсальный контейнер для неизвестных JSON-значений (сохраняем поля, которых iOS не знает).
struct AnyCodable: Codable {
    let value: Any
    init(_ value: Any) { self.value = value }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = NSNull() }
        else if let b = try? c.decode(Bool.self) { value = b }
        else if let i = try? c.decode(Int.self) { value = i }
        else if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self) { value = s }
        else if let a = try? c.decode([AnyCodable].self) { value = a.map { $0.value } }
        else if let o = try? c.decode([String: AnyCodable].self) { value = o.mapValues { $0.value } }
        else { value = NSNull() }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case is NSNull: try c.encodeNil()
        case let b as Bool: try c.encode(b)
        case let i as Int: try c.encode(i)
        case let d as Double: try c.encode(d)
        case let s as String: try c.encode(s)
        case let a as [Any]: try c.encode(a.map { AnyCodable($0) })
        case let o as [String: Any]: try c.encode(o.mapValues { AnyCodable($0) })
        default: try c.encodeNil()
        }
    }
}

func newID(_ prefix: String) -> String {
    let t = String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
    let r = String(UUID().uuidString.prefix(5)).lowercased()
    return "\(prefix)_\(t)\(r)"
}

// MARK: - Настройки расчёта

struct Settings: Codable, Equatable {
    var basePay: Double = 2415
    var holidayPay: Double = 4600
    var casePrice: Double = 7
    var percent: Double = 25
    var scheduleStart: String = DateUtil.todayKey
    var goal: Double = 60000

    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        basePay = max(0, c.num(.basePay, 2415)); holidayPay = max(0, c.num(.holidayPay, 4600)); casePrice = max(0, c.num(.casePrice, 7))
        percent = min(100, max(0, c.num(.percent, 25))); goal = max(0, c.num(.goal, 60000))
        let s = c.str(.scheduleStart); scheduleStart = DateUtil.isKey(s) ? s : DateUtil.todayKey
        correctLegacyTariff()
    }
}

extension Settings {
    mutating func correctLegacyTariff() {
        let legacy = (basePay == 2415 && casePrice == 8.05 && percent == 25)
            || (basePay == 2150 && casePrice == 7 && percent == 20)
            || (basePay == 2627.84 && casePrice == 1.69 && percent == 100)
        if legacy {
            basePay = 2415; casePrice = 7; percent = 25
            if holidayPay == 4050 { holidayPay = 4600 }
        }
    }
}

// MARK: - Смена

struct Shift: Codable, Equatable {
    var cases: Int = 0
    var holiday: Bool = false
    var base: Double = 0
    var piece: Double = 0
    var total: Double = 0
    init() {}
    init(cases: Int, holiday: Bool, base: Double, piece: Double, total: Double) { self.cases = cases; self.holiday = holiday; self.base = base; self.piece = piece; self.total = total }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cases = max(0, c.int(.cases)); holiday = c.bool(.holiday); base = c.num(.base); piece = c.num(.piece); total = c.num(.total)
        self = correctedLegacyTariff()
    }
}

extension Shift {
    // Точное совпадение со старым стандартным расчётом; премии и свои ставки сохраняем.
    func correctedLegacyTariff() -> Shift {
        guard cases >= 0, base == (holiday ? 4050 : 2415), abs(piece - Double(cases) * 2.0125) <= 0.0051 else { return self }
        let bonus = total - base - piece
        guard bonus >= -0.011 else { return self }
        var s = self
        s.base = holiday ? 4600 : 2415; s.piece = Double(cases) * 1.75
        s.total = s.base + s.piece + max(0, (bonus * 100).rounded() / 100)
        return s
    }
}

struct ShiftMeta: Codable, Equatable {
    var hours: Double = 11
    var bonus: Double = 0
    var note: String = ""
    init() {}
    init(hours: Double, bonus: Double, note: String) { self.hours = hours; self.bonus = bonus; self.note = note }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        hours = max(0, c.num(.hours, 11)); bonus = max(0, c.num(.bonus)); note = c.str(.note)
    }
}

struct ShiftTemplate: Codable, Equatable, Identifiable {
    var id: String = newID("tpl")
    var name: String = ""
    var cases: Int = 0
    var hours: Double = 11
    var bonus: Double = 0
    var holiday: Bool = false
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, newID("tpl")); name = c.str(.name); cases = max(0, c.int(.cases)); hours = max(0, c.num(.hours, 11)); bonus = max(0, c.num(.bonus)); holiday = c.bool(.holiday)
    }
    static let standard: ShiftTemplate = { var t = ShiftTemplate(); t.id = "default"; t.name = "Обычная"; return t }()
}

// MARK: - Финансы (общий JSON с сайтом: user_app_data.payload)

enum TxType: String, Codable, CaseIterable { case expense, income, transfer
    var title: String { switch self { case .expense: return "Расход"; case .income: return "Доход"; case .transfer: return "Перевод" } }
}

struct Transaction: Codable, Equatable, Identifiable {
    var id: String = newID("tx")
    var type: TxType = .expense
    var amount: Double = 0
    var category: String = ""
    var accountId: String? = nil
    var toAccountId: String? = nil
    var date: String = DateUtil.todayKey
    var note: String = ""
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, newID("tx")); type = TxType(rawValue: c.str(.type)) ?? .expense; amount = max(0, c.num(.amount)); category = c.str(.category)
        accountId = c.optStr(.accountId); toAccountId = c.optStr(.toAccountId); note = c.str(.note)
        let d = c.str(.date); date = DateUtil.isKey(d) ? d : DateUtil.todayKey
    }
}

enum AccountType: String, Codable, CaseIterable {
    case card, cash, savings, credit
    var title: String { switch self { case .card: return "Карта"; case .cash: return "Наличные"; case .savings: return "Накопительный"; case .credit: return "Кредитка" } }
    var symbol: String { switch self { case .card: return "creditcard.fill"; case .cash: return "banknote.fill"; case .savings: return "building.columns.fill"; case .credit: return "creditcard.trianglebadge.exclamationmark" } }
}

struct Account: Codable, Equatable, Identifiable {
    var id: String = newID("acc")
    var name: String = ""
    var type: AccountType = .card
    var balance: Double = 0 // стартовый остаток; текущий считается по операциям
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, newID("acc")); name = c.str(.name, "Счёт"); type = AccountType(rawValue: c.str(.type)) ?? .card; balance = c.num(.balance)
    }
}

struct Category: Codable, Equatable, Identifiable {
    var id: String = newID("cat")
    var name: String = ""
    var emoji: String = "🏷️"
    var limit: Double = 0
    init() {}
    init(id: String, name: String, emoji: String, limit: Double = 0) { self.id = id; self.name = name; self.emoji = emoji; self.limit = limit }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, newID("cat")); name = c.str(.name, "Другое"); emoji = c.str(.emoji, "🏷️"); limit = max(0, c.num(.limit))
    }
    static let defaults: [Category] = [
        Category(id: "food", name: "Еда", emoji: "🍔"), Category(id: "transport", name: "Транспорт", emoji: "🚌"), Category(id: "home", name: "Жильё", emoji: "🏠"),
        Category(id: "shopping", name: "Покупки", emoji: "🛍️"), Category(id: "health", name: "Здоровье", emoji: "💊"), Category(id: "fun", name: "Развлечения", emoji: "🎮"),
        Category(id: "connect", name: "Связь", emoji: "📱"), Category(id: "family", name: "Семья", emoji: "👨‍👩‍👧"), Category(id: "other", name: "Другое", emoji: "📦")
    ]
    static let incomeNames = ["Аванс", "Зарплата", "Подработка", "Подарок", "Другое"]
}

struct Recurring: Codable, Equatable, Identifiable {
    var id: String = newID("rec")
    var name: String = ""
    var amount: Double = 0
    var category: String = "Жильё"
    var day: Int = 1
    var accountId: String? = nil
    var lastPaid: String? = nil // "yyyy-MM" — месяц последней оплаты
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, newID("rec")); name = c.str(.name, "Платёж"); amount = max(0, c.num(.amount)); category = c.str(.category, "Жильё")
        day = min(31, max(1, c.int(.day, 1))); accountId = c.optStr(.accountId); lastPaid = c.optStr(.lastPaid)
    }
}

enum DebtDirection: String, Codable { case iOwe = "i_owe", owed }

struct Debt: Codable, Equatable, Identifiable {
    var id: String = newID("debt")
    var person: String = ""
    var amount: Double = 0
    var paid: Double = 0
    var due: String? = nil
    var note: String = ""
    var direction: DebtDirection = .iOwe
    var createdAt: String = DateUtil.todayKey
    var left: Double { max(0, amount - paid) }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, newID("debt")); person = c.str(.person, "—"); amount = max(0, c.num(.amount)); paid = max(0, c.num(.paid)); note = c.str(.note)
        let d = c.optStr(.due); due = DateUtil.isKey(d) ? d : nil
        direction = DebtDirection(rawValue: c.str(.direction)) ?? .iOwe; createdAt = c.str(.createdAt, DateUtil.todayKey)
    }
}

struct GoalDeposit: Codable, Equatable, Identifiable {
    var id: String = newID("dep")
    var amount: Double = 0
    var date: String = DateUtil.todayKey
    var note: String = ""
    init() {}
    init(amount: Double, note: String = "") { self.amount = amount; self.note = note }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, newID("dep")); amount = max(0, c.num(.amount)); note = c.str(.note)
        let d = c.str(.date); date = DateUtil.isKey(d) ? d : DateUtil.todayKey
    }
}

struct Goal: Codable, Equatable, Identifiable {
    var id: String = newID("goal")
    var name: String = ""
    var amount: Double = 0
    var saved: Double = 0
    var emoji: String = "🎯"
    var deadline: String? = nil
    var deposits: [GoalDeposit] = []
    var progress: Double { amount > 0 ? min(1, saved / amount) : 0 }
    var isDone: Bool { amount > 0 && saved >= amount }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.str(.id, newID("goal")); name = c.str(.name, "Цель"); amount = max(0, c.num(.amount)); saved = max(0, c.num(.saved)); emoji = c.str(.emoji, "🎯")
        let d = c.optStr(.deadline); deadline = DateUtil.isKey(d) ? d : nil
        deposits = c.list(.deposits, GoalDeposit.self)
    }
    static let emojis = ["🎯", "📱", "✈️", "🚗", "🏠", "💍", "🎓", "🛋️", "🏖️", "💻", "🎁", "🛡️"]
}

struct Payday: Codable, Equatable {
    var advanceDay: Int = 23
    var salaryDay: Int = 8
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        advanceDay = min(31, max(0, c.int(.advanceDay, 23))); salaryDay = min(31, max(0, c.int(.salaryDay, 8)))
        if advanceDay == 25 && salaryDay == 10 { advanceDay = 23; salaryDay = 8 }
    }
}

/// Всё, что сайт хранит в localStorage.myPayExtra / user_app_data.payload.
struct Extra: Codable, Equatable {
    var transactions: [Transaction] = []
    var accounts: [Account] = []
    var categories: [Category] = Category.defaults
    var recurring: [Recurring] = []
    var debts: [Debt] = []
    var goals: [Goal] = []
    var payday: Payday = Payday()
    var templates: [ShiftTemplate] = [.standard]
    var shiftMeta: [String: ShiftMeta] = [:]
    var theme: String = "system"
    var celebratedGoals: [String] = []

    init() {}

    enum CodingKeys: String, CodingKey { case transactions, accounts, categories, recurring, debts, goals, payday, templates, shiftMeta, theme, celebratedGoals, expenses }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        transactions = c.list(.transactions, Transaction.self)
        // Миграция старого списка expenses (до v17) → операции типа «расход».
        struct LegacyExpense: Decodable { let id: String?; let amount: Double?; let category: String?; let date: String?; let note: String? }
        let known = Set(transactions.map { $0.id })
        for e in c.list(.expenses, LegacyExpense.self) {
            guard let id = e.id, !known.contains(id) else { continue }
            var t = Transaction(); t.id = id; t.type = .expense; t.amount = max(0, e.amount ?? 0); t.category = e.category ?? "Другое"; t.note = e.note ?? ""
            t.date = DateUtil.isKey(e.date) ? e.date! : DateUtil.todayKey
            transactions.append(t)
        }
        accounts = c.list(.accounts, Account.self)
        let cats = c.list(.categories, Category.self)
        categories = cats.isEmpty ? Category.defaults : cats
        for t in transactions where t.type == .expense && !t.category.isEmpty && !categories.contains(where: { $0.name == t.category }) {
            categories.append(Category(id: newID("cat"), name: t.category, emoji: "🏷️"))
        }
        recurring = c.list(.recurring, Recurring.self)
        debts = c.list(.debts, Debt.self)
        goals = c.list(.goals, Goal.self)
        payday = (try? c.decodeIfPresent(Payday.self, forKey: .payday)) ?? Payday()
        let tpls = c.list(.templates, ShiftTemplate.self)
        templates = tpls.isEmpty ? [.standard] : tpls
        shiftMeta = (try? c.decodeIfPresent([String: ShiftMeta].self, forKey: .shiftMeta)) ?? [:]
        theme = c.str(.theme, "system")
        celebratedGoals = (try? c.decodeIfPresent([String].self, forKey: .celebratedGoals)) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(transactions, forKey: .transactions); try c.encode(accounts, forKey: .accounts); try c.encode(categories, forKey: .categories)
        try c.encode(recurring, forKey: .recurring); try c.encode(debts, forKey: .debts); try c.encode(goals, forKey: .goals); try c.encode(payday, forKey: .payday)
        try c.encode(templates, forKey: .templates); try c.encode(shiftMeta, forKey: .shiftMeta); try c.encode(theme, forKey: .theme); try c.encode(celebratedGoals, forKey: .celebratedGoals)
    }
}

/// Резервная копия — тот же формат, что экспортирует сайт (можно переносить файлы туда-сюда).
struct Backup: Codable {
    var app: String = "case-place-salary"
    var version: Int = AppConfig.backupVersion
    var exportedAt: String = ISO8601DateFormatter().string(from: Date())
    var settings: Settings
    var shifts: [String: Shift]
    var extra: Extra
}
