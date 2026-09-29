import Foundation
import UserNotifications

/// Локальные напоминания (без сервера): «внеси смену» в 19:05 в рабочие дни и «завтра рабочий день» в 21:00 накануне.
enum Notifications {
    static let enterCasesHour = 19, enterCasesMinute = 5
    static let tomorrowHour = 21

    @MainActor
    static func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .denied: return false
        default:
            return (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        }
    }

    @MainActor
    static func reschedule(store: AppStore) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: pendingIDs)
        guard store.notificationsEnabled else { return }
        let model = store.model
        var requests: [UNNotificationRequest] = []
        let today = DateUtil.startOfDay(Date())
        for offset in 0..<14 {
            let day = DateUtil.addDays(offset, to: today)
            let key = DateUtil.key(day)
            let comps = DateUtil.calendar.dateComponents([.year, .month, .day], from: day)
            if model.isWorkDay(day) && store.shifts[key] == nil {
                var c = comps; c.hour = enterCasesHour; c.minute = enterCasesMinute
                let content = UNMutableNotificationContent()
                content.title = "Смена закончилась?"
                content.body = "Внеси количество чехлов за сегодня — расчёт займёт 10 секунд."
                content.sound = .default
                requests.append(UNNotificationRequest(identifier: "enter_\(key)", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: c, repeats: false)))
            }
            let tomorrow = DateUtil.addDays(1, to: day)
            if model.isWorkDay(tomorrow) && !model.isWorkDay(day) {
                var c = comps; c.hour = tomorrowHour; c.minute = 0
                let content = UNMutableNotificationContent()
                content.title = "Завтра рабочий день"
                content.body = "Смена 08:00–19:00. Хорошего вечера и до завтра!"
                content.sound = .default
                requests.append(UNNotificationRequest(identifier: "tomorrow_\(key)", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: c, repeats: false)))
            }
        }
        // Регулярные платежи: за день до срока в 10:00.
        let engine = store.finance
        for r in engine.unpaidRecurring() {
            let due = engine.nextDate(of: r)
            let remind = DateUtil.addDays(-1, to: due)
            guard remind >= today, DateUtil.daysBetween(today, remind) <= 14 else { continue }
            var c = DateUtil.calendar.dateComponents([.year, .month, .day], from: remind); c.hour = 10; c.minute = 0
            let content = UNMutableNotificationContent()
            content.title = "Завтра платёж: \(r.name)"
            content.body = "\(Fmt.money(r.amount)) — проверь, что на счёте хватает."
            content.sound = .default
            requests.append(UNNotificationRequest(identifier: "rec_\(r.id)_\(DateUtil.key(remind))", content: content, trigger: UNCalendarNotificationTrigger(dateMatching: c, repeats: false)))
        }
        var ids: [String] = []
        for r in requests.prefix(60) { center.add(r); ids.append(r.identifier) }
        UserDefaults.standard.set(ids, forKey: "notificationIDs")
    }

    private static var pendingIDs: [String] { UserDefaults.standard.stringArray(forKey: "notificationIDs") ?? [] }
}
