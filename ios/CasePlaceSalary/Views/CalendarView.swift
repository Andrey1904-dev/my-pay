import SwiftUI

@MainActor struct CalendarView: View {
    @EnvironmentObject var store: AppStore
    @State private var month = DateUtil.startOfMonth(Date())
    @State private var selected = DateUtil.todayKey
    @State private var editing: String? = nil
    @State private var confirmClear = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    PageHead(eyebrow: "График 2/2", title: "Календарь") {
                        HStack(spacing: 8) {
                            IconButton(system: "chevron.left") { withAnimation { month = DateUtil.addMonths(-1, to: month) } }
                            IconButton(system: "chevron.right") { withAnimation { month = DateUtil.addMonths(1, to: month) } }
                        }
                    }
                    monthSummary
                    grid
                    selectedCard
                    legend
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .screenBackground()
            .navigationBarHidden(true)
            .sheet(item: Binding(get: { editing.map { EditingDate(key: $0) } }, set: { editing = $0?.key })) { item in
                ShiftEditorView(dateKey: item.key)
            }
            .alert("Очистить месяц?", isPresented: $confirmClear) {
                Button("Удалить все смены", role: .destructive) { store.clearMonth(month); store.showToast("Месяц очищен") }
                Button("Отмена", role: .cancel) {}
            } message: { Text("Будут удалены все смены за \(DateUtil.monthTitle(month)). Это действие нельзя отменить.") }
        }
    }

    private struct EditingDate: Identifiable { let key: String; var id: String { key } }

    private var monthSummary: some View {
        let a = store.model.analytics(store.shifts, month: month)
        return HStack(spacing: 10) {
            Button { withAnimation { month = DateUtil.startOfMonth(Date()); selected = DateUtil.todayKey } } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(DateUtil.monthTitle(month)).font(.system(size: 20, weight: .heavy)).foregroundColor(Theme.ink)
                    Text("\(a.entries.count) \(plural(a.entries.count, "смена", "смены", "смен")) · \(Fmt.integer(a.cases)) \(plural(a.cases, "чехол", "чехла", "чехлов"))").font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.muted)
                }
            }.buttonStyle(.plain)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Fmt.money(a.sum)).font(.num(20, weight: .heavy)).foregroundColor(Theme.ink)
                Text("заработано").font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.muted)
            }
        }
        .padding(.horizontal, 4)
    }

    private var grid: some View {
        let first = DateUtil.startOfMonth(month)
        let days = DateUtil.daysInMonth(month)
        let weekday = (DateUtil.calendar.component(.weekday, from: first) + 5) % 7 // 0 = Пн
        let cells: [Int?] = Array(repeating: nil, count: weekday) + (1...days).map { Optional($0) }
        let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 7)
        let today = DateUtil.todayKey
        return Card(padding: 12) {
            LazyVGrid(columns: columns, spacing: 6) {
                ForEach(DateUtil.weekdaySymbols, id: \.self) { w in
                    Text(w).font(.system(size: 11.5, weight: .bold)).foregroundColor(w == "Сб" || w == "Вс" ? Theme.accentText : Theme.muted).frame(height: 18)
                }
                ForEach(Array(cells.enumerated()), id: \.offset) { _, day in
                    if let d = day {
                        let date = DateUtil.addDays(d - 1, to: first)
                        let key = DateUtil.key(date)
                        DayCell(day: d, isWork: store.model.isWorkDay(date), shift: store.shifts[key], isToday: key == today, isSelected: key == selected)
                            .onTapGesture { selected = key; hapticTap() }
                            .onLongPressGesture { selected = key; editing = key }
                    } else {
                        Color.clear.frame(height: 52)
                    }
                }
            }
        }
    }

    private var selectedCard: some View {
        let date = DateUtil.date(selected) ?? Date()
        let shift = store.shifts[selected]
        let meta = store.meta(for: selected)
        let work = store.model.isWorkDay(date)
        return Card {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Eyebrow(text: work ? "Рабочий день" : "Выходной")
                    Text(DateUtil.longDay(date).capitalizingFirst).font(.system(size: 18, weight: .heavy)).foregroundColor(Theme.ink)
                }
                Spacer()
                if let s = shift { Chip(text: s.holiday ? "Праздничная" : "Смена", style: s.holiday ? .accent : .success) }
            }
            if let s = shift {
                Text(Fmt.money(s.total)).font(.num(32, weight: .heavy)).foregroundColor(Theme.ink).padding(.top, 8)
                HStack(spacing: 10) {
                    StatTile(title: "Чехлов", value: Fmt.integer(s.cases))
                    StatTile(title: "Ставка", value: Fmt.money(s.base))
                    StatTile(title: "Сделка", value: Fmt.money(s.piece + meta.bonus))
                }.padding(.top, 10)
                if !meta.note.isEmpty { Text(meta.note).font(.system(size: 14, weight: .medium)).foregroundColor(Theme.ink2).padding(.top, 8) }
                HStack(spacing: 10) {
                    Button { editing = selected } label: { Label("Изменить", systemImage: "pencil") }.buttonStyle(PrimaryButtonStyle(height: 46))
                    Button { store.deleteShift(date: selected) } label: { Image(systemName: "trash").font(.system(size: 16, weight: .bold)).foregroundColor(Theme.dangerText).frame(width: 52, height: 46).background(Theme.dangerSoft).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous)) }.buttonStyle(.plain)
                }.padding(.top, 12)
            } else {
                Text(work ? "Смена ещё не внесена." : "По графику выходной, но смену можно добавить — например, подработку.").font(.system(size: 14, weight: .medium)).foregroundColor(Theme.muted).padding(.top, 6)
                Button { editing = selected } label: { Label("Добавить смену", systemImage: "plus") }.buttonStyle(PrimaryButtonStyle(height: 46)).padding(.top, 12)
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            legendItem(color: Theme.accentSoft, border: Theme.accentSoftLine, text: "рабочий")
            legendItem(color: Theme.success, border: .clear, text: "внесена")
            Spacer()
            Button("Очистить месяц") { confirmClear = true }.font(.system(size: 13, weight: .bold)).foregroundColor(Theme.dangerText)
        }
        .padding(.horizontal, 6)
    }
    private func legendItem(color: Color, border: Color, text: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 4).fill(color).frame(width: 14, height: 14).overlay(RoundedRectangle(cornerRadius: 4).stroke(border, lineWidth: 1))
            Text(text).font(.system(size: 12.5, weight: .semibold)).foregroundColor(Theme.muted)
        }
    }
}

@MainActor struct DayCell: View {
    let day: Int
    let isWork: Bool
    let shift: Shift?
    let isToday: Bool
    let isSelected: Bool
    var body: some View {
        VStack(spacing: 3) {
            Text("\(day)").font(.system(size: 15, weight: isToday ? .heavy : .bold)).foregroundColor(textColor)
            if let s = shift {
                Text(short(s.total)).font(.num(10, weight: .bold)).foregroundColor(isSelected ? .white : Theme.successText).lineLimit(1).minimumScaleFactor(0.7)
            } else if isWork {
                Circle().fill(isSelected ? Color.white.opacity(0.7) : Theme.accent).frame(width: 5, height: 5)
            } else {
                Color.clear.frame(height: 5)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 52)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(isToday && !isSelected ? Theme.accent : (isWork && shift == nil && !isSelected ? Theme.accentSoftLine : .clear), lineWidth: isToday ? 2 : 1))
        .contentShape(Rectangle())
    }
    private var bg: Color {
        if isSelected { return Theme.graphite }
        if shift != nil { return Theme.successSoft }
        if isWork { return Theme.accentSoft }
        return Theme.surface2
    }
    private var textColor: Color { isSelected ? .white : Theme.ink }
    private func short(_ v: Double) -> String { v >= 1000 ? String(format: "%.1fк", v / 1000).replacingOccurrences(of: ".0к", with: "к").replacingOccurrences(of: ".", with: ",") : String(Int(v)) }
}

// MARK: - Редактор смены

@MainActor struct ShiftEditorView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let dateKey: String
    @State private var casesText = ""
    @State private var holiday = false
    @State private var hoursText = "11"
    @State private var bonusText = ""
    @State private var note = ""
    @State private var loaded = false
    @State private var confirmDelete = false

    private var cases: Int { max(0, Int(Fmt.parse(casesText).rounded(.towardZero))) }
    private var bonus: Double { max(0, Fmt.parse(bonusText)) }
    private var date: Date { DateUtil.date(dateKey) ?? Date() }

    var body: some View {
        SheetScaffold(eyebrow: DateUtil.longDay(date).capitalizingFirst, title: store.shifts[dateKey] == nil ? "Новая смена" : "Смена") {
            let m = store.model
            VStack(alignment: .leading, spacing: 6) {
                Text("ИТОГО ЗА СМЕНУ").font(.system(size: 11.5, weight: .bold)).kerning(1).foregroundColor(Theme.onGraphiteMuted)
                Text(Fmt.money(m.total(cases: cases, holiday: holiday, bonus: bonus))).font(.num(36, weight: .heavy)).foregroundColor(.white)
                Text("ставка \(Fmt.money(m.base(holiday: holiday))) + сделка \(Fmt.money(m.piece(cases)))\(bonus > 0 ? " + премия " + Fmt.money(bonus) : "")").font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.onGraphiteMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(18).background(Theme.graphite).clipShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))

            if store.extra.templates.count > 0 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(store.extra.templates) { t in
                            Button { casesText = t.cases > 0 ? String(t.cases) : ""; hoursText = Fmt.input(t.hours).isEmpty ? "0" : Fmt.input(t.hours); bonusText = Fmt.input(t.bonus); holiday = t.holiday; hapticTap() } label: {
                                Text(t.name).font(.system(size: 13, weight: .bold)).foregroundColor(Theme.ink).padding(.horizontal, 12).padding(.vertical, 8).background(Theme.surface3).clipShape(Capsule())
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
            MoneyField(label: "Чехлов упаковано", text: $casesText, placeholder: "0", suffix: "шт")
            HStack(spacing: 10) {
                MoneyField(label: "Часов", text: $hoursText, placeholder: "11", suffix: "ч")
                MoneyField(label: "Премия / доплата", text: $bonusText, placeholder: "0")
            }
            Toggle(isOn: $holiday) { Text("Праздничный день").font(.system(size: 15, weight: .bold)).foregroundColor(Theme.ink) }.tint(Theme.accent).padding(.vertical, 4)
            TextInputField(label: "Заметка", text: $note, placeholder: "Например: помогал на другой линии")
            Button {
                store.saveShift(date: dateKey, cases: cases, holiday: holiday, hours: max(0, Fmt.parse(hoursText)), bonus: bonus, note: note.trimmingCharacters(in: .whitespaces))
                hapticSuccess(); store.showToast("Смена сохранена"); dismiss()
            } label: { Text("Сохранить") }.buttonStyle(PrimaryButtonStyle()).padding(.top, 6)
            if store.shifts[dateKey] != nil {
                Button("Удалить смену", role: .destructive) { confirmDelete = true }.font(.system(size: 15, weight: .bold)).foregroundColor(Theme.dangerText).frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let s = store.shifts[dateKey] { casesText = s.cases > 0 ? String(s.cases) : ""; holiday = s.holiday }
            let meta = store.meta(for: dateKey)
            hoursText = Fmt.input(meta.hours).isEmpty ? "0" : Fmt.input(meta.hours); bonusText = Fmt.input(meta.bonus); note = meta.note
        }
        .alert("Удалить смену?", isPresented: $confirmDelete) {
            Button("Удалить", role: .destructive) { store.deleteShift(date: dateKey); dismiss() }
            Button("Отмена", role: .cancel) {}
        } message: { Text("Смену можно будет восстановить в разделе «Ещё» до следующего изменения.") }
        .presentationDetents([.large])
    }
}
