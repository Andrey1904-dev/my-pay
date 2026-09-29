import SwiftUI

// MARK: - Карточки и заголовки

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    var background: Color = Theme.surface
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

@MainActor struct Eyebrow: View {
    let text: String
    var color: Color = Theme.accentText
    var body: some View {
        Text(text.uppercased()).font(.system(size: 11.5, weight: .bold)).kerning(1).foregroundColor(color)
    }
}

struct SectionHeader<Trailing: View>: View {
    let eyebrow: String
    let title: String
    @ViewBuilder var trailing: () -> Trailing
    init(_ eyebrow: String, _ title: String, @ViewBuilder trailing: @escaping () -> Trailing) { self.eyebrow = eyebrow; self.title = title; self.trailing = trailing }
    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) { Eyebrow(text: eyebrow); Text(title).font(.system(size: 17, weight: .bold)).foregroundColor(Theme.ink) }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.bottom, 12)
    }
}
extension SectionHeader where Trailing == EmptyView {
    init(_ eyebrow: String, _ title: String) { self.init(eyebrow, title) { EmptyView() } }
}

@MainActor struct StatTile: View {
    let title: String
    let value: String
    var tint: Color = Theme.ink
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.muted)
            Text(value).font(.num(20, weight: .heavy)).foregroundColor(tint).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

@MainActor struct EmptyHint: View {
    let text: String
    var body: some View { Text(text).font(.system(size: 14, weight: .medium)).foregroundColor(Theme.muted).fixedSize(horizontal: false, vertical: true) }
}

// MARK: - Кнопки

struct PrimaryButtonStyle: ButtonStyle {
    var fill: Color = Theme.accent
    var text: Color = Theme.onAccent
    var height: CGFloat = 52
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .bold))
            .foregroundColor(text)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(fill.opacity(configuration.isPressed ? 0.85 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct SoftButtonStyle: ButtonStyle {
    var tint: Color = Theme.ink
    var small = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: small ? 13 : 15, weight: .bold))
            .foregroundColor(tint)
            .padding(.horizontal, small ? 12 : 16)
            .frame(minHeight: small ? 36 : 46)
            .background(Theme.surface3.opacity(configuration.isPressed ? 0.7 : 1))
            .clipShape(RoundedRectangle(cornerRadius: small ? 11 : 13, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

@MainActor struct IconButton: View {
    let system: String
    var accent = false
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: system).font(.system(size: 17, weight: .bold))
                .foregroundColor(accent ? Theme.onAccent : Theme.ink)
                .frame(width: 42, height: 42)
                .background(accent ? Theme.accent : Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(accent ? Color.clear : Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Прогресс

@MainActor struct Track: View {
    let progress: Double
    var color: Color = Theme.accent
    var height: CGFloat = 8
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface3)
                Capsule().fill(color).frame(width: max(0, min(1, progress)) * g.size.width)
            }
        }
        .frame(height: height)
        .animation(.easeOut(duration: 0.4), value: progress)
    }
}

@MainActor struct RingView: View {
    let progress: Double
    let label: String
    let caption: String
    var size: CGFloat = 92
    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.14), lineWidth: 8)
            Circle().trim(from: 0, to: max(0, min(1, progress))).stroke(Theme.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
                .animation(.easeOut(duration: 0.6), value: progress)
            VStack(spacing: 2) {
                Text(label).font(.num(18, weight: .heavy)).foregroundColor(.white)
                Text(caption).font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Чипы, сегменты

@MainActor struct Chip: View {
    let text: String
    var system: String? = nil
    var style: ChipStyle = .accent
    enum ChipStyle { case accent, dark, light, success, danger }
    var body: some View {
        HStack(spacing: 5) {
            if let s = system { Image(systemName: s).font(.system(size: 11, weight: .bold)) }
            Text(text).font(.system(size: 12.5, weight: .bold))
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(bg).foregroundColor(fg)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(border, lineWidth: 1))
    }
    private var bg: Color { switch style { case .accent: return Theme.accentSoft; case .dark: return Theme.graphite; case .light: return .white; case .success: return Theme.successSoft; case .danger: return Theme.dangerSoft } }
    private var fg: Color { switch style { case .accent: return Theme.accentText; case .dark: return .white; case .light: return Color(uiColor: UIColor(hex: 0x16181D)); case .success: return Theme.successText; case .danger: return Theme.dangerText } }
    private var border: Color { style == .accent ? Theme.accentSoftLine : .clear }
}

struct Segmented<T: Hashable>: View {
    let options: [(T, String)]
    @Binding var selection: T
    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.0) { opt in
                Button { withAnimation(.easeOut(duration: 0.15)) { selection = opt.0 } } label: {
                    Text(opt.1).font(.system(size: 14, weight: .bold))
                        .foregroundColor(selection == opt.0 ? Theme.ink : Theme.ink2)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background(selection == opt.0 ? Theme.surface : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .shadow(color: selection == opt.0 ? Color.black.opacity(0.10) : .clear, radius: 3, y: 1)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Theme.surface3)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: - Поля ввода

struct LabeledField<Content: View>: View {
    let label: String
    var hint: String? = nil
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(Theme.ink2)
            content()
                .padding(.horizontal, 14)
                .frame(minHeight: 48)
                .background(Theme.surface2)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(Theme.line, lineWidth: 1))
            if let h = hint { Text(h).font(.system(size: 12)).foregroundColor(Theme.muted) }
        }
    }
}

@MainActor struct MoneyField: View {
    let label: String
    @Binding var text: String
    var placeholder = "0"
    var suffix = "₽"
    var hint: String? = nil
    var autoFocus = false
    @FocusState private var focused: Bool
    var body: some View {
        LabeledField(label: label, hint: hint) {
            HStack {
                TextField(placeholder, text: $text).keyboardType(.decimalPad).font(.num(17)).foregroundColor(Theme.ink).focused($focused)
                if !suffix.isEmpty { Text(suffix).font(.system(size: 15, weight: .bold)).foregroundColor(Theme.muted) }
            }
        }
        .onAppear { if autoFocus { DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { focused = true } } }
    }
}

@MainActor struct TextInputField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var hint: String? = nil
    var body: some View {
        LabeledField(label: label, hint: hint) {
            TextField(placeholder, text: $text).font(.system(size: 16, weight: .semibold)).foregroundColor(Theme.ink)
        }
    }
}

@MainActor struct DateField: View {
    let label: String
    @Binding var date: Date
    var body: some View {
        LabeledField(label: label) {
            DatePicker("", selection: $date, displayedComponents: .date).labelsHidden().environment(\.locale, Locale(identifier: "ru_RU"))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

@MainActor struct OptionalDateField: View {
    let label: String
    @Binding var date: Date?
    var hint: String? = nil
    var body: some View {
        LabeledField(label: label, hint: hint) {
            HStack {
                if let d = date {
                    DatePicker("", selection: Binding(get: { d }, set: { date = $0 }), displayedComponents: .date).labelsHidden().environment(\.locale, Locale(identifier: "ru_RU"))
                    Spacer()
                    Button { date = nil } label: { Image(systemName: "xmark.circle.fill").foregroundColor(Theme.muted) }.buttonStyle(.plain)
                } else {
                    Button("Указать дату") { date = DateUtil.addMonths(3, to: Date()) }.font(.system(size: 15, weight: .bold)).foregroundColor(Theme.accentText)
                    Spacer()
                }
            }
        }
    }
}

struct PickerField<T: Hashable>: View {
    let label: String
    @Binding var selection: T
    let options: [(T, String)]
    var body: some View {
        LabeledField(label: label) {
            Menu {
                ForEach(options, id: \.0) { o in Button(o.1) { selection = o.0 } }
            } label: {
                HStack {
                    Text(options.first { $0.0 == selection }?.1 ?? "—").font(.system(size: 16, weight: .semibold)).foregroundColor(Theme.ink).lineLimit(1)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(Theme.muted)
                }
                .contentShape(Rectangle())
            }
        }
    }
}

// MARK: - Шапка листа (модалки)

@MainActor struct SheetHeader: View {
    let eyebrow: String
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Capsule().fill(Theme.line).frame(width: 44, height: 5).frame(maxWidth: .infinity).padding(.bottom, 8)
            Eyebrow(text: eyebrow)
            Text(title).font(.display(24)).foregroundColor(Theme.ink)
        }
        .padding(.bottom, 8)
    }
}

/// Универсальная обёртка для модальных форм: прокрутка, отступы, фон, клавиатура.
struct SheetScaffold<Content: View>: View {
    let eyebrow: String
    let title: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                SheetHeader(eyebrow: eyebrow, title: title)
                content()
            }
            .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 32)
        }
        .background(Theme.bg.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }
}

// MARK: - Тост и конфетти

@MainActor struct ToastView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16).padding(.vertical, 11)
            .background(Theme.graphite)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: .black.opacity(0.25), radius: 14, y: 6)
            .padding(.horizontal, 24)
    }
}

@MainActor struct ConfettiView: View {
    @State private var fall = false
    private let colors: [Color] = [Theme.accent, Theme.graphite, Theme.success, Color(uiColor: UIColor(hex: 0xFFB38A)), Color(uiColor: UIColor(hex: 0xFFD166))]
    var body: some View {
        GeometryReader { g in
            ZStack {
                ForEach(0..<60, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(colors[i % colors.count])
                        .frame(width: 8, height: 14)
                        .rotationEffect(.degrees(Double(i * 37 % 360)))
                        .position(x: CGFloat(i * 53 % Int(max(1, g.size.width))), y: fall ? g.size.height + 40 : -40)
                        .animation(.easeIn(duration: 1.6 + Double(i % 7) * 0.12).delay(Double(i % 9) * 0.05), value: fall)
                }
            }
        }
        .allowsHitTesting(false)
        .onAppear { fall = true }
    }
}

// MARK: - Строки списков

@MainActor struct MenuRow: View {
    let system: String
    let title: String
    var subtitle: String? = nil
    var danger = false
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: system).font(.system(size: 16, weight: .bold))
                .foregroundColor(danger ? Theme.dangerText : Theme.accentText)
                .frame(width: 38, height: 38)
                .background(danger ? Theme.dangerSoft : Theme.accentSoft)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(danger ? Theme.dangerText : Theme.ink)
                if let s = subtitle { Text(s).font(.system(size: 12.5, weight: .medium)).foregroundColor(Theme.muted).lineLimit(2) }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(Theme.muted)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

extension View {
    func screenBackground() -> some View { background(Theme.bg.ignoresSafeArea()) }
    func hapticSuccess() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    func hapticTap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}
