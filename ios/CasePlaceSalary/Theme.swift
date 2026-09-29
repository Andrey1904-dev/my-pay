import SwiftUI
import UIKit

/// Палитра CASE.PLACE: графит + оранжевый акцент + светлые нейтральные. Совпадает с токенами style.css.
enum Theme {
    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { trait in trait.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
    static let bg = dynamic(0xEEEEEA, 0x0A0C0F)
    static let surface = dynamic(0xFFFFFF, 0x171B21)
    static let surface2 = dynamic(0xF5F5F2, 0x1E232A)
    static let surface3 = dynamic(0xE9E9E5, 0x293039)
    static let ink = dynamic(0x111318, 0xF4F5F7)
    static let ink2 = dynamic(0x40454E, 0xC9CDD4)
    static let muted = dynamic(0x646972, 0x979DA7)
    static let line = dynamic(0xDCDCD7, 0x2F3540)
    static let lineStrong = dynamic(0xC3C4BE, 0x434A56)
    static let graphite = dynamic(0x14161A, 0x1D2128)
    static let graphite2 = dynamic(0x23262D, 0x2C323B)
    static let onGraphite = Color.white
    static let onGraphiteMuted = dynamic(0xB9BEC8, 0xB7BDC7)
    static let accent = dynamic(0xFF5A1F, 0xFF6A33)
    static let accentText = dynamic(0xB5370A, 0xFF9A70)
    static let accentSoft = dynamic(0xFFF0E8, 0x33201A)
    static let accentSoftLine = dynamic(0xFFCDB5, 0x5C3423)
    static let onAccent = Color(uiColor: UIColor(hex: 0x111318))
    static let success = dynamic(0x1F9D55, 0x34C070)
    static let successText = dynamic(0x136B3A, 0x7FE0A7)
    static let successSoft = dynamic(0xE3F5EA, 0x163022)
    static let danger = dynamic(0xD92D20, 0xF2584C)
    static let dangerText = dynamic(0xB1231A, 0xFF9088)
    static let dangerSoft = dynamic(0xFDECEA, 0x3B1C19)
    static let warn = dynamic(0xD97706, 0xF59E0B)
    static let warnText = dynamic(0x8A4200, 0xFFC861)
    static let warnSoft = dynamic(0xFEF1DC, 0x3A2A12)

    static let radiusXL: CGFloat = 26
    static let radiusLG: CGFloat = 22
    static let radiusMD: CGFloat = 16
    static let radiusSM: CGFloat = 12
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension Font {
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .heavy, design: .rounded) }
    static func num(_ size: CGFloat, weight: Font.Weight = .bold) -> Font { .system(size: size, weight: weight, design: .rounded).monospacedDigit() }
}
