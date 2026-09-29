import Foundation

/// Формулы расчёта — один в один с сайтом и Telegram-ботом:
/// total = ставка (обычная или праздничная) + чехлы × цена × доля% + премия.
struct PayModel {
    var settings: Settings

    func piece(_ cases: Int) -> Double { Double(max(0, cases)) * settings.casePrice * settings.percent / 100 }
    func base(holiday: Bool) -> Double { holiday ? settings.holidayPay : settings.basePay }
    func total(cases: Int, holiday: Bool, bonus: Double = 0) -> Double { base(holiday: holiday) + piece(cases) + max(0, bonus) }

    func makeShift(cases: Int, holiday: Bool, bonus: Double = 0) -> Shift {
        Shift(cases: max(0, cases), holiday: holiday, base: base(holiday: holiday), piece: piece(cases), total: total(cases: cases, holiday: holiday, bonus: bonus))
    }

    /// График 2/2 от даты `scheduleStart`: два рабочих, два выходных.
    func isWorkDay(_ date: Date) -> Bool {
        guard let start = DateUtil.date(settings.scheduleStart) else { return false }
        let diff = DateUtil.daysBetween(start, date)
        return ((diff % 4) + 4) % 4 < 2
    }

    /// Прогресс смены 08:00–19:00 в [0; 1] и заработок «на сейчас».
    func shiftProgress(now: Date = Date()) -> Double {
        let c = DateUtil.calendar
        let minutes = c.component(.hour, from: now) * 60 + c.component(.minute, from: now)
        let span = Double(AppConfig.workEndMinutes - AppConfig.workStartMinutes)
        return min(1, max(0, Double(minutes - AppConfig.workStartMinutes) / span))
    }
}

/// Сводки по месяцу — общие для экранов «Сегодня», «Статистика» и «Финансы».
struct MonthEntry: Identifiable { let key: String; let shift: Shift; var id: String { key } }

struct MonthAnalytics {
    var entries: [MonthEntry] = []
    var sum: Double = 0
    var goal: Double = 0
    var best: MonthEntry? = nil
    var remaining: Double = 0
    var avg: Double = 0
    var shiftsNeeded: Int = 0
    var bestStreak: Int = 0
    var cases: Int = 0
    var holidays: Int = 0
}

extension PayModel {
    static func monthEntries(_ shifts: [String: Shift], month: Date) -> [MonthEntry] {
        let p = DateUtil.monthPrefix(month)
        return shifts.filter { $0.key.hasPrefix(p) }.map { MonthEntry(key: $0.key, shift: $0.value) }.sorted { $0.key < $1.key }
    }

    func analytics(_ shifts: [String: Shift], month: Date) -> MonthAnalytics {
        let es = PayModel.monthEntries(shifts, month: month)
        var a = MonthAnalytics()
        a.entries = es
        a.sum = es.reduce(0) { $0 + $1.shift.total }
        a.goal = settings.goal
        a.best = es.max { $0.shift.total < $1.shift.total }
        a.remaining = max(0, a.goal - a.sum)
        a.avg = es.isEmpty ? 0 : a.sum / Double(es.count)
        a.shiftsNeeded = a.remaining > 0 && a.avg > 0 ? Int(ceil(a.remaining / a.avg)) : 0
        a.cases = es.reduce(0) { $0 + $1.shift.cases }
        a.holidays = es.filter { $0.shift.holiday }.count
        var streak = 0, best = 0
        var prev: Date? = nil
        for e in es {
            guard let d = DateUtil.date(e.key) else { continue }
            if let p = prev, DateUtil.daysBetween(p, d) <= 3 { streak += 1 } else { streak = 1 }
            best = max(best, streak); prev = d
        }
        a.bestStreak = best
        return a
    }

    /// Прогноз месяца: заработано + средняя смена × оставшиеся рабочие дни по графику (не внесённые).
    func forecast(_ shifts: [String: Shift], month: Date, now: Date = Date()) -> Double? {
        let es = PayModel.monthEntries(shifts, month: month)
        guard !es.isEmpty else { return nil }
        let sum = es.reduce(0) { $0 + $1.shift.total }
        guard DateUtil.sameMonth(month, now) else { return sum.rounded() }
        let avg = sum / Double(es.count)
        var remaining = 0
        let days = DateUtil.daysInMonth(month)
        for n in DateUtil.day(now)...max(DateUtil.day(now), days) where n <= days {
            let d = DateUtil.date(year: DateUtil.year(month), month: DateUtil.month(month), day: n)
            if isWorkDay(d) && shifts[DateUtil.key(d)] == nil { remaining += 1 }
        }
        return (sum + avg * Double(remaining)).rounded()
    }

    /// Ближайшие рабочие дни по графику (для «Сегодня» и уведомлений).
    func nextWorkDays(from: Date = Date(), count: Int = 4) -> [Date] {
        var out: [Date] = []
        var d = DateUtil.startOfDay(from)
        var guardCounter = 0
        while out.count < count && guardCounter < 60 {
            if isWorkDay(d) { out.append(d) }
            d = DateUtil.addDays(1, to: d); guardCounter += 1
        }
        return out
    }
}
