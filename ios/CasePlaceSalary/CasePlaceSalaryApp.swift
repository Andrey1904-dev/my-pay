import SwiftUI

@main
struct CasePlaceSalaryApp: App {
    @StateObject private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(scheme)
                .tint(Theme.accent)
                .task { await store.bootstrap() }
                .onOpenURL { url in store.handle(url: url) }
                .onChange(of: scenePhase) { phase in
                    if phase == .active { Task { await store.refreshFromCloud() } }
                }
        }
    }

    private var scheme: ColorScheme? {
        switch store.extra.theme { case "dark": return .dark; case "light": return .light; default: return nil }
    }
}
