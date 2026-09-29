import SwiftUI

@MainActor struct HomeView: View {
    @EnvironmentObject var store: AppStore
    @State private var casesText = ""
    @State private var holiday = false
    @State private var userEdited = false
    @State private var showSettings = false
    @State private var now = Date()
    @State private var loadedFor = ""
    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    private var cases: Int { max(0, Int(Fmt.parse(casesText).rounded(.towardZero))) }
    private var todayKey: String { DateUtil.key(now) }
    private var saved: Shift? { store.shifts[todayKey] }
    private var savedCasesText: String { (saved?.cases ?? 0) > 0 ? String(saved!.cases) : "" }
    /// Есть ли несохранённые правки (сравниваем с сохранённой сменой, а не ловим каждое изменение).
    private var dirty: Bool { userEdited && (casesText != savedCasesText || holiday != (saved?.holiday ?? false)) }
    private var casesBinding: Binding<String> { Binding(get: { casesText }, set: { casesText = $0; userEdited = true }) }
    private var holidayBinding: Binding<Bool> { Binding(get: { holiday }, set: { holiday = $0; userEdited = true }) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    PageHead(eyebrow: "Расчёт смены", title: "Сегодня") {
                        IconButton(system: "slider.horizontal.3") { showSettings = true }
                    }
                    header
                    hero
                    inputCard
                    shiftCard
                    monthCard
                    if !store.extra.templates.isEmpty { templatesCard }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .screenBackground()
            .navigationBarHidden(true)
            .refreshable { await store.refreshFromCloud() }
            .onAppear { syncInputs(force: false) }
            .onReceive(timer) { now = $0 }
            .onChange(of: store.shifts) { _ in syncInputs(force: false) }
            .sheet(isPresented: $showSettings) { SettingsSheet() }
        }
    }

    private func syncInputs(force: Bool) {
        if !force && userEdited && loadedFor == todayKey { return }
        loadedFor = todayKey
        if let s = saved { casesText = s.cases > 0 ? String(s.cases) : ""; holiday = s.holiday } else if force { casesText = ""; holiday = false }
        userEdited = false
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(DateUtil.text(now, "EEEE, d MMMM").capitalizingFirst).font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink)
                Text(store.model.isWorkDay(now) ? "Рабочий день по графику 2/2" : "Выходной по графику 2/2").font(.system(size: 13, weight: .medium)).foregroundColor(Theme.muted)
            }
            Spacer()
            Chip(text: store.model.isWorkDay(now) ? "РАБОТА" : "ВЫХОДНОЙ", style: store.model.isWorkDay(now) ? .success : .dark)
        }
        .padding(.horizontal, 2)
    }

    private var hero: some View {
        let m = store.model
        let b = m.base(holiday: holiday), p = m.piece(cases)
        return VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Theme.accent).frame(height: 3).clipShape(Capsule()).padding(.horizontal, 6)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("ЗАРАБОТОК ЗА СМЕНУ").font(.system(size: 11.5, weight: .bold)).kerning(1).foregroundColor(Theme.onGraphiteMuted)
                    Spacer()
                    if holiday { Chip(text: "Праздничная", system: "star.fill", style: .accent) }
                }
                Text(Fmt.money(b + p)).font(.num(44, weight: .heavy)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.6)
                HStack(spacing: 18) {
                    VStack(alignment: .leading, spacing: 2) { Text("Ставка").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted); Text(Fmt.money(b)).font(.num(15)).foregroundColor(.white) }
                    VStack(alignment: .leading, spacing: 2) { Text("Сделка").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted); Text(Fmt.money(p)).font(.num(15)).foregroundColor(.white) }
                    VStack(alignment: .leading, spacing: 2) { Text("За чехол").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted); Text(Fmt.money(m.piece(1))).font(.num(15)).foregroundColor(.white) }
                    Spacer()
                }
                if let s = saved, !dirty {
                    Label("Смена за сегодня сохранена: \(Fmt.money(s.total))", systemImage: "checkmark.circle.fill").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.successText).padding(.top, 2)
                } else if dirty {
                    Label("Есть несохранённые изменения", systemImage: "exclamationmark.circle.fill").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.accent).padding(.top, 2)
                }
            }
            .padding(18)
        }
        .background(Theme.graphite)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
    }

    private var inputCard: some View {
        Card {
            SectionHeader("Ввод", "Сколько чехлов упаковал")
            HStack(spacing: 10) {
                stepButton("minus") { setCases(cases - 100) }
                TextField("0", text: casesBinding)
                    .keyboardType(.numberPad).multilineTextAlignment(.center)
                    .font(.num(34, weight: .heavy)).foregroundColor(Theme.ink)
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
                stepButton("plus") { setCases(cases + 100) }
            }
            HStack(spacing: 8) {
                ForEach([100, 500, 1000, 1500], id: \.self) { n in
                    Button { setCases(cases + n); hapticTap() } label: {
                        Text("+\(n)").font(.num(14, weight: .bold)).foregroundColor(Theme.accentText).frame(maxWidth: .infinity, minHeight: 40)
                            .background(Theme.accentSoft).clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Theme.accentSoftLine, lineWidth: 1))
                    }.buttonStyle(.plain)
                }
            }
            .padding(.top, 10)
            Toggle(isOn: holidayBinding) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Праздничный день").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink)
                    Text("Ставка \(Fmt.money(store.settings.holidayPay)) вместо \(Fmt.money(store.settings.basePay))").font(.system(size: 12.5)).foregroundColor(Theme.muted)
                }
            }
            .tint(Theme.accent).padding(.top, 12)
            Button {
                store.saveShift(date: todayKey, cases: cases, holiday: holiday, hours: store.meta(for: todayKey).hours, bonus: store.meta(for: todayKey).bonus, note: store.meta(for: todayKey).note)
                userEdited = false; hapticSuccess(); store.showToast("Смена сохранена: \(Fmt.money(store.model.total(cases: cases, holiday: holiday)))")
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            } label: { Label(saved == nil ? "Сохранить смену" : "Обновить смену", systemImage: "checkmark") }
            .buttonStyle(PrimaryButtonStyle()).padding(.top, 14)
        }
    }

    private func setCases(_ n: Int) { casesText = n <= 0 ? "" : String(min(20000, n)); userEdited = true }

    private func stepButton(_ system: String, action: @escaping () -> Void) -> some View {
        Button(action: { action(); hapticTap() }) {
            Image(systemName: system).font(.system(size: 18, weight: .bold)).foregroundColor(Theme.ink).frame(width: 52, height: 64)
                .background(Theme.surface3).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }.buttonStyle(.plain)
    }

    private var shiftCard: some View {
        let m = store.model
        let minutes = DateUtil.calendar.component(.hour, from: now) * 60 + DateUtil.calendar.component(.minute, from: now)
        let inShift = m.isWorkDay(now) && minutes >= AppConfig.workStartMinutes && minutes < AppConfig.workEndMinutes
        return Card(background: inShift ? Theme.accentSoft : Theme.surface) {
            if inShift {
                let left = AppConfig.workEndMinutes - minutes
                Eyebrow(text: "Смена идёт")
                Text("До конца \(left / 60) ч \(String(format: "%02d", left % 60)) мин").font(.system(size: 18, weight: .heavy)).foregroundColor(Theme.ink).padding(.top, 3)
                Text("Рабочее время 08:00–19:00 · заработано к этому часу ≈ \(Fmt.money(m.total(cases: cases, holiday: holiday) * m.shiftProgress(now: now)))").font(.system(size: 13, weight: .medium)).foregroundColor(Theme.ink2).padding(.top, 2)
                Track(progress: m.shiftProgress(now: now), color: Theme.accent).padding(.top, 10)
            } else {
                Eyebrow(text: "Ближайшая смена")
                let next = nextShift(m)
                Text(next.0).font(.system(size: 18, weight: .heavy)).foregroundColor(Theme.ink).padding(.top, 3)
                Text(next.1).font(.system(size: 13, weight: .medium)).foregroundColor(Theme.muted).padding(.top, 2)
                HStack(spacing: 6) {
                    ForEach(m.nextWorkDays(from: DateUtil.addDays(1, to: now), count: 4), id: \.self) { d in
                        Text(DateUtil.text(d, "E d").capitalizingFirst).font(.system(size: 12.5, weight: .bold)).foregroundColor(Theme.ink2)
                            .padding(.horizontal, 10).padding(.vertical, 6).background(Theme.surface3).clipShape(Capsule())
                    }
                }.padding(.top, 10)
            }
        }
    }

    private func nextShift(_ m: PayModel) -> (String, String) {
        let minutes = DateUtil.calendar.component(.hour, from: now) * 60 + DateUtil.calendar.component(.minute, from: now)
        if m.isWorkDay(now) && minutes < AppConfig.workStartMinutes { return ("Сегодня", "Начало в 08:00") }
        for i in 1...60 {
            let d = DateUtil.addDays(i, to: now)
            if m.isWorkDay(d) {
                return (i == 1 ? "Завтра" : DateUtil.text(d, "EEEE, d MMMM").capitalizingFirst, i == 1 ? "Начало в 08:00" : "Через \(i) \(plural(i, "день", "дня", "дней")) · в 08:00")
            }
        }
        return ("Нет смен", "Проверь дату начала графика в настройках")
    }

    private var monthCard: some View {
        let a = store.model.analytics(store.shifts, month: now)
        let pct = a.goal > 0 ? min(1, a.sum / a.goal) : 0
        let forecast = store.model.forecast(store.shifts, month: now, now: now)
        return Card {
            SectionHeader("Этот месяц", DateUtil.monthTitle(now)) { Chip(text: "\(Int((pct * 100).rounded()))% цели", style: pct >= 1 ? .success : .accent) }
            Text(Fmt.money(a.sum)).font(.num(30, weight: .heavy)).foregroundColor(Theme.ink)
            Track(progress: pct, color: pct >= 1 ? Theme.success : Theme.accent).padding(.top, 10)
            HStack {
                Text("Цель \(Fmt.money(a.goal))").font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.muted)
                Spacer()
                if let f = forecast { Text("Прогноз \(Fmt.money(f))").font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.muted) }
            }.padding(.top, 8)
            HStack(spacing: 10) {
                StatTile(title: "Смен", value: "\(a.entries.count)")
                StatTile(title: "Чехлов", value: Fmt.integer(a.cases))
                StatTile(title: "Средняя", value: Fmt.money(a.avg))
            }.padding(.top, 12)
            if a.goal > 0 && a.remaining > 0 && a.avg > 0 {
                Text("Ещё ≈ \(a.shiftsNeeded) \(plural(a.shiftsNeeded, "смена", "смены", "смен")) до цели").font(.system(size: 13.5, weight: .semibold)).foregroundColor(Theme.accentText).padding(.top, 10)
            }
        }
    }

    private var templatesCard: some View {
        Card {
            SectionHeader("Быстрый ввод", "Шаблоны смен")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(store.extra.templates) { t in
                        Button {
                            casesText = t.cases > 0 ? String(t.cases) : ""; holiday = t.holiday; userEdited = true; hapticTap()
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.name).font(.system(size: 14, weight: .bold)).foregroundColor(Theme.ink)
                                Text("\(t.cases) шт · \(Fmt.input(t.hours).isEmpty ? "0" : Fmt.input(t.hours)) ч\(t.bonus > 0 ? " · +" + Fmt.money(t.bonus) : "")\(t.holiday ? " · праздник" : "")").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.muted)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(Theme.surface2).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line, lineWidth: 1))
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

extension String {
    var capitalizingFirst: String { prefix(1).uppercased() + dropFirst() }
}
