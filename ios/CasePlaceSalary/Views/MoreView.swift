import SwiftUI
import UniformTypeIdentifiers

@MainActor struct MoreView: View {
    @EnvironmentObject var store: AppStore
    @State private var showSettings = false
    @State private var showTelegram = false
    @State private var showTemplates = false
    @State private var showImporter = false
    @State private var showAuth = false
    @State private var confirmLogout = false
    @State private var confirmDelete = false
    @State private var deleteCode = ""
    @State private var showDeleteCode = false
    @State private var shareItem: ShareItem? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    PageHead("Профиль и настройки", "Ещё")
                    profileCard
                    if store.undo != nil { undoCard }
                    Card(padding: 6) {
                        Group {
                            Button { showSettings = true } label: { MenuRow(system: "slider.horizontal.3", title: "Настройки расчёта", subtitle: "Ставки, доля от сделки, график, цель, дни выплат") }
                            Divider().padding(.leading, 56)
                            Button { showTemplates = true } label: { MenuRow(system: "square.on.square", title: "Шаблоны смен", subtitle: "\(store.extra.templates.count) \(plural(store.extra.templates.count, "шаблон", "шаблона", "шаблонов")) для быстрого ввода") }
                            Divider().padding(.leading, 56)
                            Button { showTelegram = true } label: { MenuRow(system: "paperplane.fill", title: "Telegram-бот", subtitle: store.telegramStatus ?? "Ввод чехлов прямо из чата и напоминания") }
                            Divider().padding(.leading, 56)
                            Button { Task { await toggleNotifications() } } label: { MenuRow(system: "bell.fill", title: "Напоминания", subtitle: store.notificationsEnabled ? "Включены: 19:05 внести смену, 21:00 накануне, платежи за день" : "Выключены — нажми, чтобы включить") }
                        }
                        .buttonStyle(.plain).padding(.horizontal, 10)
                    }
                    Card(padding: 6) {
                        Group {
                            Button { exportBackup() } label: { MenuRow(system: "square.and.arrow.up", title: "Резервная копия", subtitle: "JSON-файл, совместим с сайтом") }
                            Divider().padding(.leading, 56)
                            Button { showImporter = true } label: { MenuRow(system: "square.and.arrow.down", title: "Восстановить из копии", subtitle: "Заменит текущие смены и настройки") }
                            Divider().padding(.leading, 56)
                            Button { exportCSV() } label: { MenuRow(system: "tablecells", title: "Экспорт в CSV", subtitle: "Открывается в Numbers и Excel") }
                            Divider().padding(.leading, 56)
                            themeRow
                        }
                        .buttonStyle(.plain).padding(.horizontal, 10)
                    }
                    Card(padding: 6) {
                        Group {
                            Link(destination: AppConfig.webAppURL) { MenuRow(system: "safari", title: "Веб-версия", subtitle: "Те же данные в браузере") }
                            Divider().padding(.leading, 56)
                            Link(destination: AppConfig.privacyURL) { MenuRow(system: "checkmark.shield.fill", title: "Конфиденциальность", subtitle: "Какие данные хранятся и зачем") }
                            Divider().padding(.leading, 56)
                            Link(destination: AppConfig.supportURL) { MenuRow(system: "questionmark.circle.fill", title: "Поддержка", subtitle: "Написать разработчику") }
                            if store.isSignedIn {
                                Divider().padding(.leading, 56)
                                Button { confirmLogout = true } label: { MenuRow(system: "rectangle.portrait.and.arrow.right", title: "Выйти из аккаунта", subtitle: "Данные останутся в облаке") }
                                Divider().padding(.leading, 56)
                                Button { confirmDelete = true } label: { MenuRow(system: "trash.fill", title: "Удалить аккаунт", subtitle: "Стереть аккаунт и все данные в облаке", danger: true) }
                            }
                        }
                        .buttonStyle(.plain).padding(.horizontal, 10)
                    }
                    Text("CASE.PLACE SALARY · v\(AppConfig.appVersion) · iOS").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.muted).padding(.top, 4)
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .screenBackground()
            .navigationBarHidden(true)
            .sheet(isPresented: $showSettings) { SettingsSheet() }
            .sheet(isPresented: $showTelegram) { TelegramSheet() }
            .sheet(isPresented: $showTemplates) { TemplatesSheet() }
            .sheet(isPresented: $showAuth) { AuthView() }
            .sheet(item: $shareItem) { item in ShareSheet(items: [item.url]) }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json, .plainText, .data]) { result in
                guard case .success(let url) = result else { return }
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                do { try store.importBackup(try Data(contentsOf: url)); hapticSuccess(); store.showToast("Данные восстановлены из копии") }
                catch { store.showToast("Не удалось прочитать файл: \(error.localizedDescription)", seconds: 4) }
            }
            .alert("Выйти из аккаунта?", isPresented: $confirmLogout) {
                Button("Выйти", role: .destructive) { Task { await store.signOut() } }
                Button("Отмена", role: .cancel) {}
            } message: { Text("Данные останутся в облаке. На этом устройстве они будут очищены.") }
            .alert("Удалить аккаунт навсегда?", isPresented: $confirmDelete) {
                Button("Продолжить", role: .destructive) { deleteCode = ""; showDeleteCode = true }
                Button("Отмена", role: .cancel) {}
            } message: { Text("Будут стёрты профиль, смены, настройки, финансы и привязка Telegram. Это действие нельзя отменить.") }
            .alert("Подтверждение", isPresented: $showDeleteCode) {
                TextField("Введи 1904", text: $deleteCode).keyboardType(.numberPad)
                Button("Удалить аккаунт", role: .destructive) { Task { await deleteAccount() } }
                Button("Отмена", role: .cancel) {}
            } message: { Text("Чтобы подтвердить удаление, введи число 1904.") }
        }
    }

    private var profileCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                Text(String(store.displayName.prefix(1)).uppercased()).font(.display(22)).foregroundColor(.white).frame(width: 54, height: 54).background(Theme.accent).clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(store.displayName).font(.system(size: 18, weight: .heavy)).foregroundColor(.white).lineLimit(1)
                    Text(store.isSignedIn ? "\(store.user?.email ?? "")\(providerText)" : "Локальный режим: данные только на этом iPhone").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted).lineLimit(2)
                }
                Spacer()
            }
            HStack(spacing: 8) {
                Image(systemName: syncIcon).font(.system(size: 12, weight: .bold))
                Text(store.syncState.title).font(.system(size: 12.5, weight: .semibold))
                Spacer()
                if store.isSignedIn { Button("Обновить") { Task { await store.refreshFromCloud() } }.font(.system(size: 12.5, weight: .bold)).foregroundColor(Theme.accent) }
            }
            .foregroundColor(Theme.onGraphiteMuted).padding(.top, 14)
            if !store.isSignedIn {
                Button("Войти или создать аккаунт") { showAuth = true }.buttonStyle(PrimaryButtonStyle(height: 46)).padding(.top, 14)
            }
        }
        .padding(18).background(Theme.graphite).clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
    }
    private var providerText: String {
        switch store.user?.provider ?? "" { case "apple": return " · вход через Apple"; case "google": return " · вход через Google"; default: return "" }
    }
    private var syncIcon: String {
        switch store.syncState { case .local: return "iphone"; case .syncing: return "arrow.triangle.2.circlepath"; case .synced: return "checkmark.icloud.fill"; case .offline: return "wifi.slash"; case .error: return "exclamationmark.icloud.fill" }
    }

    private var undoCard: some View {
        Card(background: Theme.accentSoft) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Удалена смена \(DateUtil.shortDay(store.undo?.date ?? ""))").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink)
                    Text("\(Fmt.money(store.undo?.shift.total ?? 0)) — можно вернуть").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.accentText)
                }
                Spacer()
                Button("Вернуть") { store.undoDelete() }.buttonStyle(SoftButtonStyle(small: true))
            }
        }
    }

    private var themeRow: some View {
        Menu {
            Button("Как в системе") { store.setTheme("system") }
            Button("Светлая") { store.setTheme("light") }
            Button("Тёмная") { store.setTheme("dark") }
        } label: {
            MenuRow(system: "moon.fill", title: "Тема оформления", subtitle: store.extra.theme == "dark" ? "Тёмная" : store.extra.theme == "light" ? "Светлая" : "Как в системе")
        }
    }

    private func toggleNotifications() async {
        if store.notificationsEnabled { store.notificationsEnabled = false; Notifications.reschedule(store: store); store.showToast("Напоминания выключены"); return }
        let ok = await Notifications.requestPermission()
        if ok { store.notificationsEnabled = true; Notifications.reschedule(store: store); store.showToast("Напоминания включены") }
        else { store.showToast("Разреши уведомления в Настройках iPhone → CASE.PLACE SALARY", seconds: 4) }
    }

    private func exportBackup() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("case-place-salary-\(DateUtil.todayKey).json")
        do { try store.backupData().write(to: url, options: .atomic); shareItem = ShareItem(url: url) } catch { store.showToast("Не удалось создать файл") }
    }
    private func exportCSV() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("case-place-salary-\(DateUtil.todayKey).csv")
        do { try store.csvData().write(to: url, options: .atomic); shareItem = ShareItem(url: url) } catch { store.showToast("Не удалось создать файл") }
    }

    private func deleteAccount() async {
        guard deleteCode.trimmingCharacters(in: .whitespaces) == "1904" else { store.showToast("Код не совпал — ничего не удалено"); return }
        do { try await store.deleteAccount(); store.showToast("Аккаунт удалён. Спасибо, что был с нами.", seconds: 4) }
        catch { store.showToast("Не удалось удалить аккаунт: \(CloudService.humanError(error))", seconds: 5) }
    }
}

struct ShareItem: Identifiable { let url: URL; var id: String { url.absoluteString } }

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Настройки расчёта

@MainActor struct SettingsSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var base = ""
    @State private var holiday = ""
    @State private var price = ""
    @State private var percent = ""
    @State private var goal = ""
    @State private var start = Date()
    @State private var advance = ""
    @State private var salary = ""
    @State private var loaded = false

    var body: some View {
        SheetScaffold(eyebrow: "Параметры", title: "Настройки расчёта") {
            Text("Если условия на работе поменяются — обнови их здесь. Уже сохранённые смены пересчитываться не будут.").font(.system(size: 14, weight: .medium)).foregroundColor(Theme.ink2)
            HStack(spacing: 10) {
                MoneyField(label: "Обычная ставка", text: $base)
                MoneyField(label: "Праздничная ставка", text: $holiday)
            }
            HStack(spacing: 10) {
                MoneyField(label: "Цена одного чехла", text: $price)
                MoneyField(label: "Твоя доля от сделки", text: $percent, suffix: "%")
            }
            DateField(label: "Первый рабочий день графика 2/2", date: $start)
            Text("Любой день, с которого начинаются два рабочих дня подряд.").font(.system(size: 12)).foregroundColor(Theme.muted)
            MoneyField(label: "Цель на месяц", text: $goal)
            HStack(spacing: 10) {
                MoneyField(label: "Аванс — число месяца", text: $advance, placeholder: "25", suffix: "")
                MoneyField(label: "Зарплата — число месяца", text: $salary, placeholder: "10", suffix: "")
            }
            Button("Сохранить настройки") {
                var s = store.settings
                s.basePay = max(0, Fmt.parse(base)); s.holidayPay = max(0, Fmt.parse(holiday)); s.casePrice = max(0, Fmt.parse(price))
                s.percent = min(100, max(0, Fmt.parse(percent))); s.goal = max(0, Fmt.parse(goal)); s.scheduleStart = DateUtil.key(start)
                store.updateSettings(s)
                var p = Payday(); p.advanceDay = min(31, max(0, Int(Fmt.parse(advance)))); p.salaryDay = min(31, max(0, Int(Fmt.parse(salary))))
                if p != store.extra.payday { store.setPayday(p) }
                hapticSuccess(); store.showToast("Настройки сохранены"); dismiss()
            }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            let s = store.settings
            base = Fmt.input(s.basePay); holiday = Fmt.input(s.holidayPay); price = Fmt.input(s.casePrice); percent = Fmt.input(s.percent); goal = Fmt.input(s.goal)
            start = DateUtil.date(s.scheduleStart) ?? Date()
            advance = String(store.extra.payday.advanceDay); salary = String(store.extra.payday.salaryDay)
        }
        .presentationDetents([.large])
    }
}

// MARK: - Шаблоны смен

@MainActor struct TemplatesSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var cases = ""
    @State private var hours = "11"
    @State private var bonus = ""
    @State private var holiday = false

    var body: some View {
        SheetScaffold(eyebrow: "Быстрый ввод", title: "Шаблоны смен") {
            if store.extra.templates.isEmpty { EmptyHint(text: "Шаблонов пока нет.") }
            ForEach(store.extra.templates) { t in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t.name).font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink)
                        Text("\(t.cases) шт · \(Fmt.input(t.hours).isEmpty ? "0" : Fmt.input(t.hours)) ч\(t.bonus > 0 ? " · +" + Fmt.money(t.bonus) : "")\(t.holiday ? " · праздник" : "")").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.muted)
                    }
                    Spacer()
                    Button { store.deleteTemplate(id: t.id) } label: { Image(systemName: "trash").font(.system(size: 13, weight: .bold)).foregroundColor(Theme.dangerText).frame(width: 36, height: 36).background(Theme.dangerSoft).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous)) }.buttonStyle(.plain)
                }
                .padding(.vertical, 6)
                Divider().background(Theme.line)
            }
            Text("Новый шаблон").font(.system(size: 17, weight: .bold)).foregroundColor(Theme.ink).padding(.top, 8)
            TextInputField(label: "Название", text: $name, placeholder: "Например: Обычная / Ночная")
            HStack(spacing: 10) {
                MoneyField(label: "Чехлов", text: $cases, suffix: "шт")
                MoneyField(label: "Часов", text: $hours, suffix: "ч")
            }
            MoneyField(label: "Премия", text: $bonus)
            Toggle(isOn: $holiday) { Text("Праздничная").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink) }.tint(Theme.accent)
            Button("Сохранить шаблон") {
                let n = name.trimmingCharacters(in: .whitespaces)
                guard !n.isEmpty else { store.showToast("Укажи название шаблона"); return }
                var t = ShiftTemplate(); t.name = n; t.cases = max(0, Int(Fmt.parse(cases))); t.hours = max(0, Fmt.parse(hours)); t.bonus = max(0, Fmt.parse(bonus)); t.holiday = holiday
                store.addTemplate(t); name = ""; cases = ""; bonus = ""; holiday = false; hapticSuccess(); store.showToast("Шаблон сохранён")
            }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
        }
        .presentationDetents([.large])
    }
}

// MARK: - Telegram

@MainActor struct TelegramSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var code: String? = nil
    @State private var busy = false

    var body: some View {
        SheetScaffold(eyebrow: "Telegram", title: "Бот для ввода смен") {
            Text("Пиши боту «+350» или «1000» — смена сохранится в аккаунт. Команды: /today, /month, /forecast, /undo, /holiday, /notify_on. Чтобы привязать чат, получи код и отправь боту команду /start КОД.")
                .font(.system(size: 14, weight: .medium)).foregroundColor(Theme.ink2)
            if let status = store.telegramStatus {
                Label(status, systemImage: "checkmark.circle.fill").font(.system(size: 14, weight: .bold)).foregroundColor(Theme.successText).padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.successSoft).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            VStack(spacing: 6) {
                Text("КОД ПРИВЯЗКИ").font(.system(size: 11.5, weight: .bold)).kerning(1).foregroundColor(Theme.onGraphiteMuted)
                Text(code ?? "— — — — — —").font(.system(size: 30, weight: .heavy, design: .monospaced)).foregroundColor(.white)
                Text("действует 15 минут").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted)
            }
            .frame(maxWidth: .infinity).padding(18).background(Theme.graphite).clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
            Button {
                Task { busy = true; code = await store.createTelegramCode(); busy = false; if let c = code { UIPasteboard.general.string = "/start \(c)"; store.showToast("Код готов · команда /start скопирована") } }
            } label: { if busy { ProgressView().tint(Theme.onAccent) } else { Text(store.isSignedIn ? "Получить код" : "Войди в аккаунт, чтобы получить код") } }
            .buttonStyle(PrimaryButtonStyle()).disabled(busy || !store.isSignedIn)
            Link(destination: AppConfig.telegramSetupURL) { Label("Как настроить бота", systemImage: "book.fill") }.font(.system(size: 14, weight: .bold)).foregroundColor(Theme.accentText).frame(maxWidth: .infinity, minHeight: 44)
        }
        .presentationDetents([.large])
        .task { await store.loadTelegramStatus() }
    }
}
