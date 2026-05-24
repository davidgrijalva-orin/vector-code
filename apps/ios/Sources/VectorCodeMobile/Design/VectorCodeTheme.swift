import SwiftUI

public enum VectorCodeTheme {
    public static let background = Color(hex: "#0b0f12")
    public static let panel = Color(hex: "#101514")
    public static let raised = Color(hex: "#151b1d")
    public static let elevated = Color(hex: "#192022")
    public static let line = Color(hex: "#f4efe6").opacity(0.11)
    public static let text = Color(hex: "#eef4f2")
    public static let muted = Color(hex: "#9aa8a3")
    public static let subtle = Color(hex: "#69756f")
    public static let accent = Color(hex: "#1fd0ca")
    public static let accentMuted = Color(hex: "#0f8f8c")
    public static let accentSoft = Color(hex: "#1fd0ca").opacity(0.12)
    public static let hover = Color(hex: "#f4efe6").opacity(0.07)
    public static let warning = Color(hex: "#e3c469")
    public static let danger = Color(hex: "#ff6b6b")
    public static let terminalBackground = Color(hex: "#05080a")
    public static let terminalGreen = Color(hex: "#9be28f")
    public static let terminalBlue = Color(hex: "#77aaff")
    public static let terminalYellow = Color(hex: "#f4dd9d")
    public static let cornerRadius: CGFloat = 8
    public static let compactRadius: CGFloat = 6
}

public extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&value)

        let red: UInt64
        let green: UInt64
        let blue: UInt64
        switch hex.count {
        case 3:
            red = ((value >> 8) & 0xF) * 17
            green = ((value >> 4) & 0xF) * 17
            blue = (value & 0xF) * 17
        default:
            red = (value >> 16) & 0xFF
            green = (value >> 8) & 0xFF
            blue = value & 0xFF
        }

        self.init(
            .sRGB,
            red: Double(red) / 255,
            green: Double(green) / 255,
            blue: Double(blue) / 255,
            opacity: 1
        )
    }
}

public struct VectorCodeMark: Shape {
    public init() {}

    public func path(in rect: CGRect) -> Path {
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(
                x: rect.minX + rect.width * x / 64,
                y: rect.minY + rect.height * y / 64
            )
        }

        var path = Path()
        path.move(to: point(29, 13))
        path.addQuadCurve(to: point(35, 13), control: point(32, 7))
        path.addLine(to: point(54, 47))
        path.addQuadCurve(to: point(50, 53), control: point(57, 53))
        path.addLine(to: point(14, 53))
        path.addQuadCurve(to: point(10, 47), control: point(7, 53))
        path.closeSubpath()

        path.move(to: point(30, 30))
        path.addQuadCurve(to: point(34, 30), control: point(32, 26))
        path.addLine(to: point(44, 47))
        path.addQuadCurve(to: point(42, 50), control: point(46, 50))
        path.addLine(to: point(22, 50))
        path.addQuadCurve(to: point(20, 47), control: point(18, 50))
        path.closeSubpath()

        return path
    }
}
