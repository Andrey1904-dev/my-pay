import Foundation
import Supabase

/// Тонкая обёртка над Supabase: те же таблицы и RPC, что использует сайт.
/// settings / shifts / profiles / user_app_data / telegram_links / create_telegram_link_code / delete_own_account.
final class CloudService {
    let client: SupabaseClient

    init() {
        client = SupabaseClient(
            supabaseURL: AppConfig.supabaseURL,
            supabaseKey: AppConfig.supabaseAnonKey,
            options: SupabaseClientOptions(auth: .init(redirectToURL: AppConfig.oauthRedirectURL, flowType: .pkce))
        )
    }

    struct CloudUser: Equatable {
        let id: UUID
        let email: String?
        let name: String?
        let provider: String?
    }

    static func cloudUser(from user: User) -> CloudUser {
        let meta = user.userMetadata
        let name = meta["full_name"]?.stringValue ?? meta["name"]?.stringValue
            ?? [meta["given_name"]?.stringValue, meta["family_name"]?.stringValue].compactMap { $0 }.joined(separator: " ")
        let provider = user.appMetadata["provider"]?.stringValue
        return CloudUser(id: user.id, email: user.email, name: name?.isEmpty == false ? name : nil, provider: provider)
    }

    // MARK: - Auth

    func currentUser() async -> CloudUser? {
        guard let session = try? await client.auth.session else { return nil }
        return CloudService.cloudUser(from: session.user)
    }

    func signIn(email: String, password: String) async throws -> CloudUser {
        let session = try await client.auth.signIn(email: email, password: password)
        return CloudService.cloudUser(from: session.user)
    }

    func signUp(email: String, password: String, name: String) async throws -> CloudUser? {
        let response = try await client.auth.signUp(email: email, password: password, data: ["name": .string(name)])
        guard let session = response.session else { return nil } // требуется подтверждение email
        return CloudService.cloudUser(from: session.user)
    }

    func signInWithApple(idToken: String, nonce: String, fullName: String?) async throws -> CloudUser {
        let session = try await client.auth.signInWithIdToken(credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce))
        var user = CloudService.cloudUser(from: session.user)
        // Apple отдаёт имя только при первом входе — сохраняем его в метаданные и профиль.
        if let fullName = fullName, !fullName.isEmpty, user.name == nil {
            _ = try? await client.auth.update(user: UserAttributes(data: ["full_name": .string(fullName)]))
            user = CloudUser(id: user.id, email: user.email, name: fullName, provider: user.provider)
        }
        return user
    }

    func signInWithGoogle() async throws -> CloudUser {
        let session = try await client.auth.signInWithOAuth(
            provider: .google,
            redirectTo: AppConfig.oauthRedirectURL,
            scopes: "email profile",
            queryParams: [(name: "prompt", value: "select_account")]
        )
        return CloudService.cloudUser(from: session.user)
    }

    func handle(url: URL) { client.auth.handle(url) }

    func signOut() async {
        try? await client.auth.signOut()
    }

    func resetPassword(email: String) async throws {
        try await client.auth.resetPasswordForEmail(email, redirectTo: AppConfig.webAppURL)
    }

    func deleteAccount() async throws {
        _ = try await client.rpc("delete_own_account").execute()
        try? await client.auth.signOut(scope: .local)
    }

    // MARK: - Таблицы

    struct SettingsRow: Codable {
        var user_id: String
        var base_pay: Double
        var holiday_pay: Double
        var case_price: Double
        var piece_percent: Double
        var schedule_start: String
        var monthly_goal: Double

        init(userID: UUID, settings: Settings) {
            user_id = userID.uuidString.lowercased(); base_pay = settings.basePay; holiday_pay = settings.holidayPay; case_price = settings.casePrice
            piece_percent = settings.percent; schedule_start = settings.scheduleStart; monthly_goal = settings.goal
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            user_id = c.str(.user_id); base_pay = c.num(.base_pay, 2627.84); holiday_pay = c.num(.holiday_pay, 4050); case_price = c.num(.case_price, 1.69)
            piece_percent = c.num(.piece_percent, 100); schedule_start = String(c.str(.schedule_start).prefix(10)); monthly_goal = c.num(.monthly_goal, 60000)
        }
        var settings: Settings {
            var s = Settings()
            // Старая тройка 2150 / 7 / 20 — мигрируем на актуальные значения, как делает сайт.
            let legacy = base_pay == 2150 && case_price == 7 && piece_percent == 20
            s.basePay = legacy ? 2627.84 : base_pay; s.holidayPay = holiday_pay; s.casePrice = legacy ? 1.69 : case_price; s.percent = legacy ? 100 : piece_percent
            s.scheduleStart = DateUtil.isKey(schedule_start) ? schedule_start : DateUtil.todayKey; s.goal = monthly_goal
            return s
        }
    }

    struct ShiftRow: Codable {
        var user_id: String
        var work_date: String
        var cases: Int
        var is_holiday: Bool
        var base_pay: Double
        var piece_pay: Double
        var total_pay: Double

        init(userID: UUID, date: String, shift: Shift) {
            user_id = userID.uuidString.lowercased(); work_date = date; cases = shift.cases; is_holiday = shift.holiday
            base_pay = shift.base; piece_pay = shift.piece; total_pay = shift.total
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            user_id = c.str(.user_id); work_date = String(c.str(.work_date).prefix(10)); cases = c.int(.cases); is_holiday = c.bool(.is_holiday)
            base_pay = c.num(.base_pay); piece_pay = c.num(.piece_pay); total_pay = c.num(.total_pay)
        }
    }

    struct ProfileRow: Codable { var id: String; var name: String? }
    struct ExtraRow: Decodable { var payload: Extra? }
    struct ExtraUpsert: Encodable { var user_id: String; var payload: Extra; var updated_at: String }
    struct TelegramLink: Decodable { var username: String?; var first_name: String?; var linked_at: String? }

    func fetchSettings(userID: UUID) async throws -> Settings? {
        let rows: [SettingsRow] = try await client.from("settings").select().eq("user_id", value: userID.uuidString).execute().value
        return rows.first?.settings
    }

    func saveSettings(userID: UUID, _ settings: Settings) async throws {
        _ = try await client.from("settings").upsert(SettingsRow(userID: userID, settings: settings), onConflict: "user_id").execute()
    }

    func fetchShifts(userID: UUID, model: PayModel) async throws -> [String: Shift] {
        let rows: [ShiftRow] = try await client.from("shifts").select().eq("user_id", value: userID.uuidString).order("work_date").execute().value
        var out: [String: Shift] = [:]
        for r in rows where DateUtil.isKey(r.work_date) {
            var s = model.makeShift(cases: r.cases, holiday: r.is_holiday)
            if r.total_pay > 0 { s.total = r.total_pay } // total в облаке включает премию
            out[r.work_date] = s
        }
        return out
    }

    func saveShift(userID: UUID, date: String, shift: Shift) async throws {
        _ = try await client.from("shifts").upsert(ShiftRow(userID: userID, date: date, shift: shift), onConflict: "user_id,work_date").execute()
    }

    func deleteShift(userID: UUID, date: String) async throws {
        _ = try await client.from("shifts").delete().eq("user_id", value: userID.uuidString).eq("work_date", value: date).execute()
    }

    func fetchProfileName(userID: UUID) async throws -> String? {
        let rows: [ProfileRow] = try await client.from("profiles").select("id,name").eq("id", value: userID.uuidString).execute().value
        return rows.first?.name
    }

    func saveProfileName(userID: UUID, _ name: String) async throws {
        _ = try await client.from("profiles").upsert(ProfileRow(id: userID.uuidString.lowercased(), name: name), onConflict: "id").execute()
    }

    func fetchExtra(userID: UUID) async throws -> Extra? {
        let rows: [ExtraRow] = try await client.from(AppConfig.extraTable).select("payload").eq("user_id", value: userID.uuidString).execute().value
        return rows.first?.payload
    }

    func saveExtra(userID: UUID, _ extra: Extra) async throws {
        let row = ExtraUpsert(user_id: userID.uuidString.lowercased(), payload: extra, updated_at: ISO8601DateFormatter().string(from: Date()))
        _ = try await client.from(AppConfig.extraTable).upsert(row, onConflict: "user_id").execute()
    }

    func fetchTelegramLink(userID: UUID) async throws -> TelegramLink? {
        let rows: [TelegramLink] = try await client.from("telegram_links").select("username,first_name,linked_at").eq("user_id", value: userID.uuidString).execute().value
        return rows.first
    }

    func createTelegramCode() async throws -> String {
        let code: String = try await client.rpc("create_telegram_link_code").execute().value
        return code
    }

    // MARK: - Ошибки

    static func isNetworkError(_ error: Error) -> Bool {
        let e = error as NSError
        if e.domain == NSURLErrorDomain { return true }
        let m = error.localizedDescription.lowercased()
        return m.contains("network") || m.contains("offline") || m.contains("internet") || m.contains("timed out")
    }

    static func humanError(_ error: Error) -> String {
        let m = error.localizedDescription
        if isNetworkError(error) { return "Нет соединения с интернетом" }
        if m.localizedCaseInsensitiveContains("Invalid login credentials") { return "Неверный email или пароль" }
        if m.localizedCaseInsensitiveContains("Email not confirmed") { return "Подтверди email — письмо уже отправлено" }
        if m.localizedCaseInsensitiveContains("already registered") || m.localizedCaseInsensitiveContains("already been registered") { return "Такой email уже зарегистрирован — войди" }
        if m.localizedCaseInsensitiveContains("Password should be") { return "Пароль слишком простой: минимум 6 символов" }
        if m.localizedCaseInsensitiveContains("rate limit") { return "Слишком много попыток — подожди минуту" }
        if m.localizedCaseInsensitiveContains("provider is not enabled") || m.localizedCaseInsensitiveContains("Unsupported provider") { return "Этот способ входа не включён в Supabase" }
        if m.localizedCaseInsensitiveContains("canceled") || m.localizedCaseInsensitiveContains("cancelled") { return "Вход отменён" }
        return m.isEmpty ? "Что-то пошло не так" : m
    }
}
