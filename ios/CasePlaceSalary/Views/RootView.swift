import SwiftUI

@MainActor struct RootView: View {
    @EnvironmentObject var store: AppStore
    @State private var tab = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $tab) {
                HomeView().tabItem { Label("Сегодня", systemImage: "sun.max.fill") }.tag(0)
                CalendarView().tabItem { Label("Календарь", systemImage: "calendar") }.tag(1)
                StatsView().tabItem { Label("Статистика", systemImage: "chart.bar.fill") }.tag(2)
                FinanceView().tabItem { Label("Финансы", systemImage: "creditcard.fill") }.tag(3)
                MoreView().tabItem { Label("Ещё", systemImage: "ellipsis.circle.fill") }.tag(4)
            }
            .onAppear { configureTabBar() }

            if let t = store.toast {
                ToastView(text: t).padding(.bottom, 64).transition(.move(edge: .bottom).combined(with: .opacity)).zIndex(10)
            }
            if store.celebrate {
                ConfettiView().ignoresSafeArea().zIndex(9)
                    .task { try? await Task.sleep(nanoseconds: 2_600_000_000); store.celebrate = false }
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: store.toast)
        .fullScreenCover(isPresented: Binding(get: { store.isBootstrapped && !store.isSignedIn && !store.skippedAuth }, set: { _ in })) {
            AuthView()
        }
    }

    private func configureTabBar() {
        let a = UITabBarAppearance()
        a.configureWithOpaqueBackground()
        a.backgroundColor = UIColor(Theme.surface)
        a.shadowColor = UIColor(Theme.line)
        UITabBar.appearance().standardAppearance = a
        UITabBar.appearance().scrollEdgeAppearance = a
    }
}

/// Общий заголовок экрана в стиле сайта: маленькая подпись + крупный заголовок + действие справа.
struct PageHead<Trailing: View>: View {
    let eyebrow: String
    let title: String
    @ViewBuilder var trailing: () -> Trailing
    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 4) {
                Eyebrow(text: eyebrow)
                Text(title).font(.display(30)).foregroundColor(Theme.ink)
            }
            Spacer()
            trailing()
        }
        .padding(.top, 8).padding(.bottom, 14)
    }
}
extension PageHead where Trailing == EmptyView {
    init(_ eyebrow: String, _ title: String) { self.init(eyebrow: eyebrow, title: title) { EmptyView() } }
}
