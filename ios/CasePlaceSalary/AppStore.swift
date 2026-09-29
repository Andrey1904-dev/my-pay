import Foundation
import SwiftUI
import Combine

enum SyncState: Equatable {
    case local                 // без аккаунта
    case syncing
    case synced(Date)
    case offline
    case error(String)

    var title: String {
        switch self {
        case .local: return "Локальный режим"
        case .syncing: return "Синхронизация…"
        case .synced(let d): return "Синхронизировано " + DateUtil.text(d, "HH:mm")
        case .offline: return "Офлайн — изменения отправятся позже"
        case .error(let m): return "Ошибка синхронизации: \(m)"
        }
    }
}

/// Очередь операций, которые не удалось отправить в облако (нет сети).
struct PendingOps: Codable, Equatable {
    var saveShifts: Set<String> = []
    var deleteShifts: Set<String> = []
    var saveSettings = false
    var saveExtra = false
    var isEmpty: Bool { saveShifts.isEmpty && deleteShifts.isEmpty && !saveSettings && !saveExtra }
}

struct UndoItem: Codable, Equatable { let date: String; let shift: Shift; let meta: ShiftMeta? }

@MainActor
final class AppStore: ObservableObject {
    // Данные
    @Published private(set) var settings = Settings()
    @Published private(set) var shifts: [String: Shift] = [:]
    @Published private(set) var extra = Extra()
    @Published private(set) var undo: UndoItem? = nil

    // Аккаунт и синхронизация
    @Published private(set) var user: CloudService.CloudUser? = nil
    @Published private(set) var profileName: String? = nil
    @Published private(set) var syncState: SyncState = .local
    @Published var skippedAuth: Bool = UserDefaults.standard.bool(forKey: "skippedAuth") { didSet { UserDefaults.standard.set(skippedAuth, forKey: "skippedAuth") } }
    @Published private(set) var isBootstrapped = false
    @Published var telegramStatus: String? = nil
    @Published var notificationsEnabled: Bool = UserDefaults.standard.bool(forKey: "notificationsEnabled") { didSet { UserDefaults.standard.set(notificationsEnabled, forKey: "notificationsEnabled") } }

    // UI
    @Published var toast: String? = nil
    @Published var celebrate = false

    let cloud = CloudService()
    private var pending = PendingOps()
    private var authTask: Task<Void, Never>? = nil
    private var toastTask: Task<Void, Never>? = nil

    var model: PayModel { PayModel(settings: settings) }
    var finance: FinanceEngine { FinanceEngine(settings: settings, shifts: shifts, extra: extra) }
    var isSignedIn: Bool { user != nil }
    var displayName: String { profileName ?? user?.name ?? user?.email ?? "Мой расчёт" }

    init() {
        loadFromDisk()
    }

    // MARK: - Диск

    private static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("CasePlaceSalary", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    private static var stateURL: URL { directory.appendingPathComponent("state.json") }
    private static var pendingURL: URL { directory.appendingPathComponent("pending.json") }

    private func loadFromDisk() {
        if let data = try? Data(contentsOf: AppStore.stateURL), let b = try? JSONDecoder().decode(Backup.self, from: data) {
            settings = b.settings; shifts = b.shifts.filter { DateUtil.isKey($0.key) }; extra = b.extra
        }
        if let data = try? Data(contentsOf: AppStore.pendingURL), let p = try? JSONDecoder().decode(PendingOps.self, from: data) { pending = p }
        if let data = UserDefaults.standard.data(forKey: "undoItem"), let u = try? JSONDecoder().decode(UndoItem.self, from: data) { undo = u }
    }

    private func persist() {
        let backup = Backup(settings: settings, shifts: shifts, extra: extra)
        if let data = try? JSONEncoder().encode(backup) { try? data.write(to: AppStore.stateURL, options: .atomic) }
        if let data = try? JSONEncoder().encode(pending) { try? data.write(to: AppStore.pendingURL, options: .atomic) }
        if let u = undo, let data = try? JSONEncoder().encode(u) { UserDefaults.standard.set(data, forKey: "undoItem") } else { UserDefaults.standard.removeObject(forKey: "undoItem") }
    }

    // MARK: - Тосты

    func showToast(_ text: String, seconds: Double = 2.4) {
        toastTask?.cancel()
        toast = text
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            if !Task.isCancelled { self?.toast = nil }
        }
    }

    // MARK: - Смены

    func meta(for date: String) -> ShiftMeta { extra.shiftMeta[date] ?? ShiftMeta() }

    func saveShift(date: String, cases: Int, holiday: Bool, hours: Double = 11, bonus: Double = 0, note: String = "") {
        guard DateUtil.isKey(date) else { return }
        let shift = model.makeShift(cases: cases, holiday: holiday, bonus: bonus)
        shifts[date] = shift
        extra.shiftMeta[date] = ShiftMeta(hours: hours, bonus: bonus, note: note)
        undo = nil
        persist()
        Task { await pushShift(date: date, shift: shift); await pushExtra() }
        Notifications.reschedule(store: self)
    }

    func deleteShift(date: String) {
        guard let s = shifts[date] else { return }
        undo = UndoItem(date: date, shift: s, meta: extra.shiftMeta[date])
        shifts[date] = nil
        extra.shiftMeta[date] = nil
        persist()
        Task { await pushDeleteShift(date: date); await pushExtra() }
        showToast("Смена удалена · можно отменить в «Ещё»")
    }

    func undoDelete() {
        guard let u = undo else { return }
        shifts[u.date] = u.shift
        if let m = u.meta { extra.shiftMeta[u.date] = m }
        undo = nil
        persist()
        Task { await pushShift(date: u.date, shift: u.shift); await pushExtra() }
        showToast("Смена восстановлена")
    }

    func clearMonth(_ month: Date) {
        let keys = PayModel.monthEntries(shifts, month: month).map { $0.key }
        for k in keys { shifts[k] = nil; extra.shiftMeta[k] = nil }
        undo = nil
        persist()
        Task { for k in keys { await pushDeleteShift(date: k) }; await pushExtra() }
    }

    func updateSettings(_ new: Settings) {
        settings = new
        persist()
        Task { await pushSettings() }
        Notifications.reschedule(store: self)
    }

    // MARK: - Финансы

    private func mutateExtra(_ change: (inout Extra) -> Void) {
        var e = extra; change(&e); extra = e
        persist()
        Task { await pushExtra() }
    }

    func addTransaction(_ t: Transaction) { mutateExtra { $0.transactions.append(t) } }
    func deleteTransaction(id: String) { mutateExtra { $0.transactions.removeAll { $0.id == id } } }

    func saveAccount(_ a: Account, desiredBalance: Double?) {
        mutateExtra { e in
            if let i = e.accounts.firstIndex(where: { $0.id == a.id }) {
                var updated = a
                if let wanted = desiredBalance {
                    let current = FinanceEngine(settings: settings, shifts: shifts, extra: e).balance(of: e.accounts[i])
                    updated.balance = e.accounts[i].balance + (wanted - current)
                }
                e.accounts[i] = updated
            } else {
                var created = a
                if let wanted = desiredBalance { created.balance = wanted }
                e.accounts.append(created)
            }
        }
    }
    func deleteAccount(id: String) {
        mutateExtra { e in
            e.accounts.removeAll { $0.id == id }
            for i in e.transactions.indices {
                if e.transactions[i].accountId == id { e.transactions[i].accountId = nil }
                if e.transactions[i].toAccountId == id { e.transactions[i].toAccountId = nil }
            }
        }
    }

    func saveCategories(_ cats: [Category]) { mutateExtra { $0.categories = cats } }
    func addCategory(name: String) -> Bool {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, !extra.categories.contains(where: { $0.name == n }) else { return false }
        mutateExtra { $0.categories.append(Category(id: newID("cat"), name: n, emoji: "🏷️")) }
        return true
    }
    func deleteCategory(id: String) -> Bool {
        guard let c = extra.categories.first(where: { $0.id == id }) else { return false }
        if extra.transactions.contains(where: { $0.type == .expense && $0.category == c.name }) { return false }
        mutateExtra { $0.categories.removeAll { $0.id == id } }
        return true
    }

    func saveRecurring(_ r: Recurring) {
        mutateExtra { e in
            if let i = e.recurring.firstIndex(where: { $0.id == r.id }) { e.recurring[i] = r } else { e.recurring.append(r) }
        }
    }
    func deleteRecurring(id: String) { mutateExtra { $0.recurring.removeAll { $0.id == id } } }
    func payRecurring(id: String) {
        guard let r = extra.recurring.first(where: { $0.id == id }) else { return }
        mutateExtra { e in
            var t = Transaction(); t.type = .expense; t.amount = r.amount; t.category = r.category.isEmpty ? "Другое" : r.category; t.accountId = r.accountId; t.note = r.name
            e.transactions.append(t)
            if let i = e.recurring.firstIndex(where: { $0.id == id }) { e.recurring[i].lastPaid = DateUtil.monthPrefix(Date()) }
        }
        showToast("\(r.name): \(Fmt.money(r.amount)) записано в расходы")
    }

    func saveDebt(_ d: Debt) {
        mutateExtra { e in
            if let i = e.debts.firstIndex(where: { $0.id == d.id }) { e.debts[i] = d } else { e.debts.append(d) }
        }
    }
    func deleteDebt(id: String) { mutateExtra { $0.debts.removeAll { $0.id == id } } }
    func payDebt(id: String, amount: Double) {
        guard amount > 0, let d = extra.debts.first(where: { $0.id == id }) else { return }
        mutateExtra { e in
            if let i = e.debts.firstIndex(where: { $0.id == id }) { e.debts[i].paid = min(e.debts[i].amount, e.debts[i].paid + amount) }
        }
        if d.amount - (d.paid + amount) <= 0.001 { showToast("Долг закрыт ✓"); celebrate = true }
    }

    func saveGoal(_ g: Goal) {
        mutateExtra { e in
            if let i = e.goals.firstIndex(where: { $0.id == g.id }) { e.goals[i] = g } else { e.goals.append(g) }
        }
        checkGoalCelebration()
    }
    func deleteGoal(id: String) { mutateExtra { $0.goals.removeAll { $0.id == id } } }
    func topUpGoal(id: String, amount: Double, note: String = "") {
        guard amount > 0 else { return }
        mutateExtra { e in
            if let i = e.goals.firstIndex(where: { $0.id == id }) {
                e.goals[i].saved += amount
                e.goals[i].deposits.append(GoalDeposit(amount: amount, note: note))
            }
        }
        showToast("+\(Fmt.money(amount)) в копилку")
        checkGoalCelebration()
    }
    private func checkGoalCelebration() {
        for g in extra.goals where g.isDone && !extra.celebratedGoals.contains(g.id) {
            mutateExtra { $0.celebratedGoals.append(g.id) }
            celebrate = true
            showToast("Цель «\(g.name)» выполнена! 🎉")
            break
        }
    }

    func setPayday(_ p: Payday) { mutateExtra { $0.payday = p } }
    func setTheme(_ theme: String) { mutateExtra { $0.theme = theme } }

    func addTemplate(_ t: ShiftTemplate) { mutateExtra { $0.templates.append(t) } }
    func deleteTemplate(id: String) { mutateExtra { $0.templates.removeAll { $0.id == id } } }

    // MARK: - Облако: запуск и слушатель сессии

    func bootstrap() async {
        if let u = await cloud.currentUser() {
            user = u
            await afterLogin()
        }
        isBootstrapped = true
        if authTask == nil {
            authTask = Task { [weak self] in
                guard let self = self else { return }
                for await change in self.cloud.client.auth.authStateChanges {
                    guard !Task.isCancelled else { return }
                    switch change.event {
                    case .signedIn, .initialSession, .tokenRefreshed, .userUpdated:
                        if let s = change.session {
                            let u = CloudService.cloudUser(from: s.user)
                            if self.user == nil { self.user = u; await self.afterLogin() } else if self.user != u { self.user = u }
                        }
                    case .signedOut:
                        if self.user != nil { self.resetLocal(keepTheme: true); self.user = nil; self.profileName = nil; self.syncState = .local }
                    default: break
                    }
                }
            }
        }
    }

    func handle(url: URL) { cloud.handle(url: url) }

    // MARK: - Вход

    func signIn(email: String, password: String) async throws {
        user = try await cloud.signIn(email: email, password: password)
        await afterLogin()
    }

    /// Возвращает true, если сессия создана сразу; false — нужно подтвердить email.
    func signUp(email: String, password: String, name: String) async throws -> Bool {
        guard let u = try await cloud.signUp(email: email, password: password, name: name) else { return false }
        user = u
        await afterLogin()
        if !name.isEmpty { try? await cloud.saveProfileName(userID: u.id, name); profileName = name }
        return true
    }

    func signInWithApple(idToken: String, nonce: String, fullName: String?) async throws {
        user = try await cloud.signInWithApple(idToken: idToken, nonce: nonce, fullName: fullName)
        await afterLogin()
    }

    func signInWithGoogle() async throws {
        user = try await cloud.signInWithGoogle()
        await afterLogin()
    }

    func resetPassword(email: String) async throws { try await cloud.resetPassword(email: email) }

    func signOut() async {
        await cloud.signOut()
        resetLocal(keepTheme: true)
        user = nil; profileName = nil; syncState = .local; telegramStatus = nil
        showToast("Ты вышел из аккаунта")
    }

    func deleteAccount() async throws {
        try await cloud.deleteAccount()
        resetLocal(keepTheme: false)
        user = nil; profileName = nil; syncState = .local; telegramStatus = nil
        skippedAuth = false
    }

    private func resetLocal(keepTheme: Bool) {
        let theme = extra.theme
        settings = Settings(); shifts = [:]; extra = Extra(); undo = nil; pending = PendingOps()
        if keepTheme { extra.theme = theme }
        persist()
        Notifications.reschedule(store: self)
    }

    /// После входа: облако — источник истины. Исключение — пустой новый аккаунт при непустых локальных данных:
    /// тогда локальные данные отправляем в облако, чтобы ничего не потерять.
    private func afterLogin() async {
        guard let u = user else { return }
        syncState = .syncing
        do {
            let cloudSettings = try await cloud.fetchSettings(userID: u.id)
            let cloudShifts = try await cloud.fetchShifts(userID: u.id, model: PayModel(settings: cloudSettings ?? settings))
            let cloudExtra = try await cloud.fetchExtra(userID: u.id)
            let cloudEmpty = cloudSettings == nil && cloudShifts.isEmpty && (cloudExtra == nil || cloudExtra! == Extra())
            let localHasData = !shifts.isEmpty || !extra.transactions.isEmpty || !extra.goals.isEmpty || !extra.accounts.isEmpty
            if cloudEmpty && localHasData {
                try await cloud.saveSettings(userID: u.id, settings)
                for (k, s) in shifts { try await cloud.saveShift(userID: u.id, date: k, shift: s) }
                try await cloud.saveExtra(userID: u.id, extra)
            } else {
                let hadPending = !pending.isEmpty
                if hadPending { await flushPending() } // сначала доталкиваем офлайн-правки, иначе облако их перетрёт
                if let cs = cloudSettings, !hadPending { settings = cs } else { try await cloud.saveSettings(userID: u.id, settings) }
                if hadPending {
                    shifts = try await cloud.fetchShifts(userID: u.id, model: model)
                    if let ce = try await cloud.fetchExtra(userID: u.id) { extra = ce }
                } else {
                    shifts = cloudShifts
                    if let ce = cloudExtra { var e = ce; if e.theme.isEmpty { e.theme = extra.theme }; extra = e }
                    else { try await cloud.saveExtra(userID: u.id, extra) }
                }
            }
            // Имя профиля: из таблицы profiles или из Apple/Google-метаданных (сохраняем один раз).
            if let name = try? await cloud.fetchProfileName(userID: u.id), !name.isEmpty { profileName = name }
            else if let n = u.name { try? await cloud.saveProfileName(userID: u.id, n); profileName = n }
            persist()
            syncState = .synced(Date())
            await loadTelegramStatus()
        } catch {
            syncState = CloudService.isNetworkError(error) ? .offline : .error(CloudService.humanError(error))
        }
        Notifications.reschedule(store: self)
    }

    /// Повторная загрузка из облака (pull-to-refresh, возврат в приложение).
    func refreshFromCloud() async {
        guard user != nil else { return }
        await flushPending()
        await afterLogin()
    }

    // MARK: - Облако: отправка изменений

    private func pushShift(date: String, shift: Shift) async {
        guard let u = user else { return }
        do { try await cloud.saveShift(userID: u.id, date: date, shift: shift); pending.saveShifts.remove(date); syncState = .synced(Date()) }
        catch { pending.saveShifts.insert(date); pending.deleteShifts.remove(date); syncState = CloudService.isNetworkError(error) ? .offline : .error(CloudService.humanError(error)) }
        persist()
    }
    private func pushDeleteShift(date: String) async {
        guard let u = user else { return }
        do { try await cloud.deleteShift(userID: u.id, date: date); pending.deleteShifts.remove(date); syncState = .synced(Date()) }
        catch { pending.deleteShifts.insert(date); pending.saveShifts.remove(date); syncState = CloudService.isNetworkError(error) ? .offline : .error(CloudService.humanError(error)) }
        persist()
    }
    private func pushSettings() async {
        guard let u = user else { return }
        do { try await cloud.saveSettings(userID: u.id, settings); pending.saveSettings = false; syncState = .synced(Date()) }
        catch { pending.saveSettings = true; syncState = CloudService.isNetworkError(error) ? .offline : .error(CloudService.humanError(error)) }
        persist()
    }
    private func pushExtra() async {
        guard let u = user else { return }
        do { try await cloud.saveExtra(userID: u.id, extra); pending.saveExtra = false; syncState = .synced(Date()) }
        catch { pending.saveExtra = true; syncState = CloudService.isNetworkError(error) ? .offline : .error(CloudService.humanError(error)) }
        persist()
    }

    func flushPending() async {
        guard user != nil, !pending.isEmpty else { return }
        for d in pending.saveShifts { if let s = shifts[d] { await pushShift(date: d, shift: s) } else { pending.saveShifts.remove(d) } }
        for d in pending.deleteShifts { await pushDeleteShift(date: d) }
        if pending.saveSettings { await pushSettings() }
        if pending.saveExtra { await pushExtra() }
        persist()
    }

    // MARK: - Telegram

    func loadTelegramStatus() async {
        guard let u = user else { telegramStatus = nil; return }
        if let link = try? await cloud.fetchTelegramLink(userID: u.id) {
            let who = link.username.map { "@" + $0 } ?? link.first_name ?? "аккаунт"
            telegramStatus = "Привязан: \(who)"
        } else { telegramStatus = nil }
    }

    func createTelegramCode() async -> String? {
        guard user != nil else { showToast("Сначала войди в аккаунт"); return nil }
        do { return try await cloud.createTelegramCode() }
        catch { showToast("Не удалось получить код: " + CloudService.humanError(error)); return nil }
    }

    // MARK: - Резервные копии

    func backupData() -> Data {
        let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? enc.encode(Backup(settings: settings, shifts: shifts, extra: extra))) ?? Data()
    }

    func importBackup(_ data: Data) throws {
        struct RawBackup: Decodable { let settings: Settings?; let shifts: [String: RawShift]?; let extra: Extra? }
        struct RawShift: Decodable {
            let cases: Int; let holiday: Bool; let bonus: Double
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                cases = max(0, c.int(.cases)); holiday = c.bool(.holiday); bonus = max(0, c.num(.bonus))
            }
            enum CodingKeys: String, CodingKey { case cases, holiday, bonus }
        }
        let raw = try JSONDecoder().decode(RawBackup.self, from: data)
        guard let s = raw.settings, let rawShifts = raw.shifts else { throw NSError(domain: "backup", code: 1, userInfo: [NSLocalizedDescriptionKey: "Файл не похож на резервную копию CASE.PLACE SALARY"]) }
        settings = s
        let m = PayModel(settings: s)
        var newShifts: [String: Shift] = [:]
        for (k, v) in rawShifts where DateUtil.isKey(k) { newShifts[k] = m.makeShift(cases: v.cases, holiday: v.holiday, bonus: v.bonus) }
        shifts = newShifts
        if let e = raw.extra { extra = e }
        undo = nil
        persist()
        Task {
            await pushSettings()
            for (k, sh) in newShifts { await pushShift(date: k, shift: sh) }
            await pushExtra()
        }
        Notifications.reschedule(store: self)
    }

    func csvData() -> Data {
        var lines = ["Дата;Чехлы;Праздник;Ставка;Сделка;Премия;Итого;Часы;Заметка"]
        for (k, s) in shifts.sorted(by: { $0.key < $1.key }) {
            let m = meta(for: k)
            func f(_ v: Double) -> String { String(format: "%.2f", v).replacingOccurrences(of: ".", with: ",") }
            let note = m.note.replacingOccurrences(of: ";", with: ",").replacingOccurrences(of: "\n", with: " ")
            lines.append("\(k);\(s.cases);\(s.holiday ? "да" : "нет");\(f(s.base));\(f(s.piece));\(f(m.bonus));\(f(s.total));\(f(m.hours));\(note)")
        }
        return ("\u{FEFF}" + lines.joined(separator: "\n")).data(using: .utf8) ?? Data()
    }
}
