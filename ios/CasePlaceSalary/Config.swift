import Foundation

/// Общие константы приложения. Значения совпадают с веб-версией (script.js),
/// поэтому iPhone, сайт и Telegram-бот работают с одним аккаунтом и одними данными.
enum AppConfig {
    static let appName = "CASE.PLACE SALARY"
    static let appVersion = 17

    static let supabaseURL = URL(string: "https://dyixwxxpjmyycgigcbtx.supabase.co")!
    /// Публичный (publishable) ключ — безопасен для клиента, права ограничены RLS-политиками.
    static let supabaseAnonKey = "sb_publishable_NFxxL8WDGpG-ASXo2LasmQ_wskniL6r"
    static let extraTable = "user_app_data"

    /// URL-схема для возврата из OAuth (Google). Должна совпадать с CFBundleURLSchemes в Info.plist
    /// и быть добавлена в Supabase → Authentication → URL Configuration → Redirect URLs.
    static let urlScheme = "caseplace"
    static let oauthRedirectURL = URL(string: "caseplace://auth-callback")!

    static let webAppURL = URL(string: "https://andrey1904-dev.github.io/my-pay/")!
    static let privacyURL = URL(string: "https://andrey1904-dev.github.io/my-pay/privacy.html")!
    static let supportURL = URL(string: "https://github.com/Andrey1904-dev/my-pay/issues")!
    static let telegramSetupURL = URL(string: "https://github.com/Andrey1904-dev/my-pay/blob/main/telegram_bot_setup.md")!

    /// Часовой пояс расчётов — как на сайте и в боте.
    static let timeZone = TimeZone(identifier: "Asia/Yekaterinburg") ?? .current
    static let workStartMinutes = 8 * 60   // 08:00
    static let workEndMinutes = 19 * 60    // 19:00
}
