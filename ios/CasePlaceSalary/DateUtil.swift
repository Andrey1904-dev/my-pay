import Foundation

/// Даты в приложении хранятся строками вида "2026-09-29" (как в облаке и на сайте).
enum DateUtil {
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = AppConfig.timeZone
        c.firstWeekday = 2 // понедельник
        c.locale = Locale(identifier: "ru_RU")
        return c
    }()

    private static let keyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = AppConfig.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func key(_ date: Date) -> String { keyFormatter.string(from: date) }
    static func date(_ key: String) -> Date? { keyFormatter.date(from: String(key.prefix(10))) }
    static func isKey(_ s: String?) -> Bool {
        guard let s = s, s.count == 10, date(s) != nil else { return false }
        return true
    }
    static var todayKey: String { key(Date()) }
    static func monthPrefix(_ date: Date) -> String { String(key(date).prefix(7)) }
    static func startOfDay(_ date: Date) -> Date { calendar.startOfDay(for: date) }
    static func startOfMonth(_ date: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }
    static func addMonths(_ n: Int, to date: Date) -> Date { calendar.date(byAdding: .month, value: n, to: date) ?? date }
    static func addDays(_ n: Int, to date: Date) -> Date { calendar.date(byAdding: .day, value: n, to: date) ?? date }
    static func daysInMonth(_ date: Date) -> Int { calendar.range(of: .day, in: .month, for: date)?.count ?? 30 }
    static func day(_ date: Date) -> Int { calendar.component(.day, from: date) }
    static func month(_ date: Date) -> Int { calendar.component(.month, from: date) }
    static func year(_ date: Date) -> Int { calendar.component(.year, from: date) }
    static func sameMonth(_ a: Date, _ b: Date) -> Bool { monthPrefix(a) == monthPrefix(b) }
    static func daysBetween(_ from: Date, _ to: Date) -> Int {
        calendar.dateComponents([.day], from: startOfDay(from), to: startOfDay(to)).day ?? 0
    }
    /// Дата с указанным числом месяца; если в месяце меньше дней — последний день.
    static func date(year: Int, month: Int, day: Int) -> Date {
        var comps = DateComponents(); comps.year = year; comps.month = month; comps.day = 1
        let first = calendar.date(from: comps) ?? Date()
        let maxDay = daysInMonth(first)
        return addDays(min(day, maxDay) - 1, to: first)
    }

    static func text(_ date: Date, _ format: String) -> String {
        let f = DateFormatter(); f.calendar = calendar; f.timeZone = AppConfig.timeZone; f.locale = Locale(identifier: "ru_RU"); f.dateFormat = format
        return f.string(from: date)
    }
    static func monthTitle(_ date: Date) -> String {
        let s = text(date, "LLLL yyyy")
        return s.prefix(1).uppercased() + s.dropFirst()
    }
    static func shortDay(_ key: String) -> String { date(key).map { text($0, "d MMM") } ?? key }
    static func longDay(_ date: Date) -> String { text(date, "d MMMM, EEEE") }

    static let weekdaySymbols = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
}

func plural(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
    let m = abs(n) % 100, x = m % 10
    if m > 10 && m < 20 { return many }
    if x > 1 && x < 5 { return few }
    if x == 1 { return one }
    return many
}
