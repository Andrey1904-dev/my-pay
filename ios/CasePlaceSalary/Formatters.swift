import Foundation

enum Fmt {
    private static let ru = Locale(identifier: "ru_RU")

    private static let moneyWhole: NumberFormatter = {
        let f = NumberFormatter(); f.locale = ru; f.numberStyle = .decimal; f.maximumFractionDigits = 0; f.groupingSeparator = "\u{2009}"
        return f
    }()
    private static let moneyFrac: NumberFormatter = {
        let f = NumberFormatter(); f.locale = ru; f.numberStyle = .decimal; f.minimumFractionDigits = 2; f.maximumFractionDigits = 2; f.groupingSeparator = "\u{2009}"
        return f
    }()
    private static let integerFmt: NumberFormatter = {
        let f = NumberFormatter(); f.locale = ru; f.numberStyle = .decimal; f.maximumFractionDigits = 0; f.groupingSeparator = "\u{2009}"
        return f
    }()

    /// 1 690 ₽ / 3 219,34 ₽ — как на сайте: копейки показываем только когда они есть.
    static func money(_ v: Double) -> String {
        let r = (v * 100).rounded() / 100
        let isWhole = abs(r - r.rounded()) < 0.005
        let s = (isWhole ? moneyWhole : moneyFrac).string(from: NSNumber(value: r)) ?? "\(r)"
        return s + "\u{00a0}₽"
    }
    static func signedMoney(_ v: Double) -> String { v < 0 ? "−" + money(abs(v)) : money(v) }
    static func integer(_ v: Double) -> String { integerFmt.string(from: NSNumber(value: v.rounded())) ?? "\(Int(v))" }
    static func integer(_ v: Int) -> String { integer(Double(v)) }
    static func percent(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }
    static func input(_ v: Double) -> String {
        if v == 0 { return "" }
        if abs(v - v.rounded()) < 0.0001 { return String(Int(v.rounded())) }
        return String(format: "%.2f", v).replacingOccurrences(of: ".", with: ",")
    }
    /// Разбор пользовательского ввода: "1 250,50" → 1250.5
    static func parse(_ s: String) -> Double {
        let cleaned = s.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{00a0}", with: "").replacingOccurrences(of: ",", with: ".")
        return Double(cleaned) ?? 0
    }
}
