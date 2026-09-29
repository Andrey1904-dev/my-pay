import SwiftUI
import Charts

@MainActor struct StatsView: View {
    @EnvironmentObject var store: AppStore
    @State private var month = DateUtil.startOfMonth(Date())
    @State private var editing: String? = nil

    private struct EditingDate: Identifiable { let key: String; var id: String { key } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    PageHead(eyebrow: "Аналитика", title: "Статистика") {
                        HStack(spacing: 8) {
                            IconButton(system: "chevron.left") { withAnimation { month = DateUtil.addMonths(-1, to: month) } }
                            IconButton(system: "chevron.right") { withAnimation { month = DateUtil.addMonths(1, to: month) } }
                        }
                    }
                    let a = store.model.analytics(store.shifts, month: month)
                    hero(a)
                    tiles(a)
                    chart(a)
                    records(a)
                    yearCard
                    history(a)
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .screenBackground()
            .navigationBarHidden(true)
            .sheet(item: Binding(get: { editing.map { EditingDate(key: $0) } }, set: { editing = $0?.key })) { item in ShiftEditorView(dateKey: item.key) }
        }
    }

    private func hero(_ a: MonthAnalytics) -> some View {
        let pct = a.goal > 0 ? min(1, a.sum / a.goal) : 0
        let forecast = DateUtil.sameMonth(month, Date()) ? store.model.forecast(store.shifts, month: month) : nil
        return VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Theme.accent).frame(height: 3).clipShape(Capsule()).padding(.horizontal, 6)
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Button { withAnimation { month = DateUtil.startOfMonth(Date()) } } label: {
                        Text(DateUtil.monthTitle(month).uppercased()).font(.system(size: 11.5, weight: .bold)).kerning(1).foregroundColor(Theme.onGraphiteMuted)
                    }.buttonStyle(.plain)
                    Text(Fmt.money(a.sum)).font(.num(36, weight: .heavy)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.6)
                    Text("\(a.entries.count) \(plural(a.entries.count, "смена", "смены", "смен")) · \(Fmt.integer(a.cases)) \(plural(a.cases, "чехол", "чехла", "чехлов"))").font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted)
                    if let f = forecast { Text("Прогноз месяца \(Fmt.money(f))").font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.accent) }
                }
                Spacer(minLength: 0)
                RingView(progress: pct, label: "\(Int((pct * 100).rounded()))%", caption: "цели")
            }
            .padding(18)
        }
        .background(Theme.graphite)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
    }

    private func tiles(_ a: MonthAnalytics) -> some View {
        let bs = a.entries.reduce(0) { $0 + $1.shift.base }, ps = a.entries.reduce(0) { $0 + $1.shift.piece }
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            StatTile(title: "Средняя смена", value: Fmt.money(a.avg))
            StatTile(title: "Чехлов за смену", value: a.entries.isEmpty ? "0" : Fmt.integer(Double(a.cases) / Double(a.entries.count)))
            StatTile(title: "Сделка за месяц", value: Fmt.money(ps), tint: Theme.accentText)
            StatTile(title: "Ставки за месяц", value: Fmt.money(bs))
        }
    }

    private func chart(_ a: MonthAnalytics) -> some View {
        Card {
            SectionHeader("Динамика", "Заработок по сменам") {
                if let b = a.best { Chip(text: "Лучшая \(Fmt.money(b.shift.total))", style: .accent) }
            }
            if a.entries.isEmpty {
                EmptyHint(text: "Здесь появится график после первой смены.")
            } else {
                let last = Array(a.entries.suffix(16))
                Chart(last) { e in
                    BarMark(x: .value("День", DateUtil.shortDay(e.key)), y: .value("₽", e.shift.total))
                        .foregroundStyle(a.best?.key == e.key ? Theme.accent : Theme.graphite)
                        .cornerRadius(5)
                        .annotation(position: .top, alignment: .center) {
                            if last.count <= 10 { Text(shortMoney(e.shift.total)).font(.num(9, weight: .bold)).foregroundColor(Theme.muted) }
                        }
                }
                .chartYAxis { AxisMarks(position: .leading) { v in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel { if let d = v.as(Double.self) { Text(shortMoney(d)).font(.system(size: 10, weight: .semibold)).foregroundColor(Theme.muted) } } } }
                .chartXAxis { AxisMarks { _ in AxisValueLabel().font(.system(size: 9.5, weight: .semibold)).foregroundStyle(Theme.muted) } }
                .frame(height: 190)
                .padding(.top, 4)
            }
        }
    }

    private func records(_ a: MonthAnalytics) -> some View {
        Card {
            SectionHeader("Рекорды месяца", a.goal > 0 && a.remaining <= 0 ? "Цель выполнена 🎉" : (a.avg > 0 && a.goal > 0 ? "Ещё \(Fmt.money(a.remaining)) до цели" : "Внеси первую смену"))
            if a.goal > 0 && a.remaining > 0 && a.avg > 0 {
                Text("≈ \(a.shiftsNeeded) \(plural(a.shiftsNeeded, "смена", "смены", "смен")) при средней \(Fmt.money(a.avg))").font(.system(size: 13.5, weight: .semibold)).foregroundColor(Theme.muted).padding(.bottom, 10)
            }
            HStack(spacing: 10) {
                StatTile(title: "Лучшая смена", value: Fmt.money(a.best?.shift.total ?? 0))
                StatTile(title: "Серия смен", value: "\(a.bestStreak)")
            }
            HStack(spacing: 10) {
                StatTile(title: "Лучший день", value: a.best.map { DateUtil.shortDay($0.key) } ?? "—")
                StatTile(title: "Праздничных", value: "\(a.holidays)")
            }.padding(.top, 10)
        }
    }

    private var yearCard: some View {
        let year = DateUtil.year(month)
        let months: [(Date, Double)] = (1...12).map { m -> (Date, Double) in
            let d = DateUtil.date(year: year, month: m, day: 1)
            return (d, PayModel.monthEntries(store.shifts, month: d).reduce(0) { $0 + $1.shift.total })
        }
        let total = months.reduce(0) { $0 + $1.1 }
        let activeMonths = months.filter { $0.1 > 0 }.count
        let avgText = "в среднем \(Fmt.money(total / Double(max(1, activeMonths))))/мес"
        return Card {
            SectionHeader("Год", "\(year): \(Fmt.money(total))") { if total > 0 { Chip(text: avgText, style: .accent) } }
            if total == 0 { EmptyHint(text: "За \(year) год смен пока нет.") } else {
                Chart(months, id: \.0) { item in
                    BarMark(x: .value("Месяц", DateUtil.text(item.0, "LLL")), y: .value("₽", item.1))
                        .foregroundStyle(DateUtil.sameMonth(item.0, month) ? Theme.accent : Theme.graphite.opacity(0.85))
                        .cornerRadius(4)
                }
                .chartYAxis { AxisMarks(position: .leading) { v in AxisGridLine().foregroundStyle(Theme.line); AxisValueLabel { if let d = v.as(Double.self) { Text(shortMoney(d)).font(.system(size: 10, weight: .semibold)).foregroundColor(Theme.muted) } } } }
                .chartXAxis { AxisMarks { _ in AxisValueLabel().font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.muted) } }
                .frame(height: 150)
            }
        }
    }

    private func history(_ a: MonthAnalytics) -> some View {
        Card {
            SectionHeader("История", "Смены месяца")
            if a.entries.isEmpty { EmptyHint(text: "Пока нет сохранённых смен за этот месяц.") }
            ForEach(a.entries.reversed()) { e in
                Button { editing = e.key } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(DateUtil.date(e.key).map { DateUtil.text($0, "E, d MMMM").capitalizingFirst } ?? e.key).font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink)
                            Text("\(Fmt.integer(e.shift.cases)) \(plural(e.shift.cases, "чехол", "чехла", "чехлов")) · сделка \(Fmt.money(e.shift.piece))\(e.shift.holiday ? " · праздник" : "")").font(.system(size: 12.5, weight: .medium)).foregroundColor(Theme.muted)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(Fmt.money(e.shift.total)).font(.num(15, weight: .heavy)).foregroundColor(Theme.ink)
                            Text(e.shift.holiday ? "Праздничная" : "Обычная").font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.muted)
                        }
                    }
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .contextMenu { Button(role: .destructive) { store.deleteShift(date: e.key) } label: { Label("Удалить смену", systemImage: "trash") } }
                Divider().background(Theme.line)
            }
        }
    }

    private func shortMoney(_ v: Double) -> String {
        if v >= 1000 { let s = String(format: "%.1f", v / 1000).replacingOccurrences(of: ".0", with: "").replacingOccurrences(of: ".", with: ","); return s + "к" }
        return String(Int(v.rounded()))
    }
}
