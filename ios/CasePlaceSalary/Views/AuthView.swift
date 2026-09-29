import SwiftUI
import AuthenticationServices
import CryptoKit
import Security

@MainActor struct AuthView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.colorScheme) private var colorScheme

    enum Mode { case welcome, login, signup, reset }
    @State private var mode: Mode = .welcome
    @State private var email = ""
    @State private var password = ""
    @State private var password2 = ""
    @State private var name = ""
    @State private var busy = false
    @State private var status: String? = nil
    @State private var statusIsError = true
    @State private var nonce = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                brand
                Group {
                    switch mode {
                    case .welcome: welcome
                    default: form
                    }
                }
                .padding(20)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).stroke(Theme.line, lineWidth: 1))
                .padding(.horizontal, 16)
                .animation(.easeOut(duration: 0.2), value: mode)
                HStack(spacing: 6) {
                    Image(systemName: "lock.fill").font(.system(size: 12, weight: .bold))
                    Text("Данные видны только тебе").font(.system(size: 13, weight: .semibold))
                }
                .foregroundColor(Theme.muted).padding(.top, 16)
                Link("Политика конфиденциальности", destination: AppConfig.privacyURL).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.accentText).padding(.top, 6).padding(.bottom, 28)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.bg.ignoresSafeArea())
        .interactiveDismissDisabled(true)
    }

    private var brand: some View {
        VStack(spacing: 10) {
            Text("₽").font(.display(30)).foregroundColor(.white).frame(width: 64, height: 64).background(Theme.graphite).clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            Eyebrow(text: "Личный кабинет")
            (Text("CASE.PLACE ").font(.display(26)).foregroundColor(Theme.ink) + Text("SALARY").font(.display(26)).foregroundColor(Theme.accent))
            Text("Смены, заработок и бюджет сохраняются в облаке и доступны на iPhone, сайте и в Telegram.")
                .font(.system(size: 14.5, weight: .medium)).foregroundColor(Theme.ink2).multilineTextAlignment(.center).padding(.horizontal, 28)
        }
        .padding(.bottom, 22)
    }

    // MARK: Экран приветствия

    private var welcome: some View {
        VStack(spacing: 10) {
            SignInWithAppleButton(.continue) { request in
                nonce = AuthView.randomNonce()
                request.requestedScopes = [.fullName, .email]
                request.nonce = AuthView.sha256(nonce)
            } onCompletion: { result in
                handleApple(result)
            }
            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
            .frame(height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .disabled(busy)

            Button { Task { await run { try await store.signInWithGoogle() } } } label: {
                HStack(spacing: 10) { GoogleMark(); Text("Продолжить с Google") }
            }
            .buttonStyle(PrimaryButtonStyle(fill: Theme.surface3, text: Theme.ink))
            .disabled(busy)

            HStack { Rectangle().fill(Theme.line).frame(height: 1); Text("ИЛИ ПО EMAIL").font(.system(size: 11.5, weight: .bold)).kerning(0.8).foregroundColor(Theme.muted); Rectangle().fill(Theme.line).frame(height: 1) }.padding(.vertical, 6)

            Button("Войти") { switchMode(.login) }.buttonStyle(PrimaryButtonStyle())
            Button("Создать аккаунт") { switchMode(.signup) }.buttonStyle(PrimaryButtonStyle(fill: Theme.surface2, text: Theme.ink))
            Button("Продолжить без аккаунта") { store.skippedAuth = true }
                .font(.system(size: 14, weight: .bold)).foregroundColor(Theme.muted).padding(.top, 6)
            if let s = status { statusView(s) }
            if busy { ProgressView().padding(.top, 6) }
        }
    }

    // MARK: Формы

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { switchMode(.welcome) } label: {
                HStack(spacing: 4) { Image(systemName: "chevron.left").font(.system(size: 13, weight: .bold)); Text("Назад") }.font(.system(size: 14, weight: .bold)).foregroundColor(Theme.accentText)
            }
            Text(mode == .login ? "С возвращением" : mode == .signup ? "Новый аккаунт" : "Восстановление пароля").font(.display(24)).foregroundColor(Theme.ink)
            if mode == .signup {
                TextInputField(label: "Как тебя зовут", text: $name, placeholder: "Имя").textContentType(.name)
            }
            LabeledField(label: "Email") {
                TextField("you@example.com", text: $email).keyboardType(.emailAddress).textContentType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().font(.system(size: 16, weight: .semibold)).foregroundColor(Theme.ink)
            }
            if mode != .reset {
                LabeledField(label: "Пароль", hint: mode == .signup ? "Минимум 6 символов" : nil) {
                    SecureField("••••••••", text: $password).textContentType(mode == .signup ? .newPassword : .password).font(.system(size: 16, weight: .semibold)).foregroundColor(Theme.ink)
                }
            }
            if mode == .signup {
                LabeledField(label: "Повтори пароль") {
                    SecureField("••••••••", text: $password2).textContentType(.newPassword).font(.system(size: 16, weight: .semibold)).foregroundColor(Theme.ink)
                }
            }
            if let s = status { statusView(s) }
            Button { Task { await submit() } } label: {
                if busy { ProgressView().tint(Theme.onAccent) } else { Text(mode == .login ? "Войти" : mode == .signup ? "Создать аккаунт" : "Отправить ссылку") }
            }
            .buttonStyle(PrimaryButtonStyle()).disabled(busy).padding(.top, 4)
            if mode == .login {
                Button("Забыл пароль?") { switchMode(.reset) }.font(.system(size: 14, weight: .bold)).foregroundColor(Theme.muted).frame(maxWidth: .infinity)
            }
        }
    }

    private func statusView(_ s: String) -> some View {
        Text(s).font(.system(size: 13.5, weight: .semibold))
            .foregroundColor(statusIsError ? Theme.dangerText : Theme.successText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(statusIsError ? Theme.dangerSoft : Theme.successSoft)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func switchMode(_ m: Mode) { status = nil; mode = m }

    private func run(_ op: () async throws -> Void) async {
        busy = true; status = nil
        do { try await op(); hapticSuccess() }
        catch { statusIsError = true; status = CloudService.humanError(error) }
        busy = false
    }

    private func submit() async {
        let e = email.trimmingCharacters(in: .whitespaces).lowercased()
        guard e.contains("@"), e.contains(".") else { statusIsError = true; status = "Введи корректный email"; return }
        switch mode {
        case .login:
            guard password.count >= 6 else { statusIsError = true; status = "Пароль — минимум 6 символов"; return }
            await run { try await store.signIn(email: e, password: password) }
        case .signup:
            guard password.count >= 6 else { statusIsError = true; status = "Пароль — минимум 6 символов"; return }
            guard password == password2 else { statusIsError = true; status = "Пароли не совпадают"; return }
            await run {
                let created = try await store.signUp(email: e, password: password, name: name.trimmingCharacters(in: .whitespaces))
                if !created { statusIsError = false; status = "Проверь почту: мы отправили письмо для подтверждения. После этого войди." ; mode = .login }
            }
        case .reset:
            await run { try await store.resetPassword(email: e); statusIsError = false; status = "Ссылка для смены пароля отправлена на \(e)" }
        case .welcome: break
        }
    }

    // MARK: Apple

    private func handleApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let error):
            if (error as? ASAuthorizationError)?.code == .canceled { return }
            statusIsError = true; status = "Вход через Apple не удался: \(error.localizedDescription)"
        case .success(let auth):
            guard let cred = auth.credential as? ASAuthorizationAppleIDCredential, let data = cred.identityToken, let token = String(data: data, encoding: .utf8) else {
                statusIsError = true; status = "Apple не вернула токен — попробуй ещё раз"; return
            }
            let fullName = [cred.fullName?.givenName, cred.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
            let n = nonce
            Task { await run { try await store.signInWithApple(idToken: token, nonce: n, fullName: fullName.isEmpty ? nil : fullName) } }
        }
    }

    static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remaining = length
        while remaining > 0 {
            var random: UInt8 = 0
            let status = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
            if status != errSecSuccess { random = UInt8.random(in: 0...255) }
            if Int(random) < charset.count { result.append(charset[Int(random)]); remaining -= 1 }
        }
        return result
    }

    static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Цветной знак Google (без сторонних ресурсов).
@MainActor struct GoogleMark: View {
    var body: some View {
        ZStack {
            Circle().trim(from: 0.05, to: 0.30).stroke(Color(red: 0.26, green: 0.52, blue: 0.96), lineWidth: 4)
            Circle().trim(from: 0.30, to: 0.55).stroke(Color(red: 0.20, green: 0.66, blue: 0.33), lineWidth: 4)
            Circle().trim(from: 0.55, to: 0.80).stroke(Color(red: 0.98, green: 0.74, blue: 0.02), lineWidth: 4)
            Circle().trim(from: 0.80, to: 1.0).stroke(Color(red: 0.92, green: 0.26, blue: 0.21), lineWidth: 4)
            Rectangle().fill(Color(red: 0.26, green: 0.52, blue: 0.96)).frame(width: 9, height: 4).offset(x: 5, y: 0)
        }
        .frame(width: 20, height: 20)
    }
}
