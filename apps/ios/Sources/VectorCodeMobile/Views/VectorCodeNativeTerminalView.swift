import SwiftUI

#if os(iOS)
import SwiftTerm
import UIKit

struct VectorCodeNativeTerminalSurface: UIViewRepresentable {
    let terminal: VectorCodeTerminalTab
    let fallbackText: String
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    let onTitleChange: (String) -> Void

    func makeUIView(context: Context) -> VectorCodeSwiftTermHostView {
        let view = VectorCodeSwiftTermHostView(frame: .zero)
        view.terminalDelegate = context.coordinator
        view.configureVectorCodeTheme()
        return view
    }

    func updateUIView(_ uiView: VectorCodeSwiftTermHostView, context: Context) {
        context.coordinator.onInput = onInput
        context.coordinator.onResize = onResize
        context.coordinator.onTitleChange = onTitleChange
        uiView.terminalDelegate = context.coordinator
        uiView.configureVectorCodeTheme()
        uiView.applyTerminalSnapshot(
            terminalId: terminal.id,
            rawOutput: terminal.rawOutput,
            fallbackText: fallbackText
        )
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onInput: onInput, onResize: onResize, onTitleChange: onTitleChange)
    }

    final class Coordinator: NSObject, TerminalViewDelegate {
        var onInput: (String) -> Void
        var onResize: (Int, Int) -> Void
        var onTitleChange: (String) -> Void
        private var lastReportedSize: (cols: Int, rows: Int)?
        private var lastSentSize: (cols: Int, rows: Int)?
        private var pendingResize: DispatchWorkItem?

        init(
            onInput: @escaping (String) -> Void,
            onResize: @escaping (Int, Int) -> Void,
            onTitleChange: @escaping (String) -> Void
        ) {
            self.onInput = onInput
            self.onResize = onResize
            self.onTitleChange = onTitleChange
        }

        func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
            guard newCols > 0, newRows > 0 else {
                return
            }
            guard lastReportedSize?.cols != newCols || lastReportedSize?.rows != newRows else {
                return
            }
            lastReportedSize = (newCols, newRows)
            // Debounce so transient sizes from keyboard and layout animations never
            // reach the desktop PTY; every PTY resize forces full-screen apps to
            // repaint, which stacks duplicate frames into the scrollback.
            pendingResize?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self else {
                    return
                }
                self.pendingResize = nil
                guard self.lastSentSize?.cols != newCols || self.lastSentSize?.rows != newRows else {
                    return
                }
                self.lastSentSize = (newCols, newRows)
                self.onResize(newCols, newRows)
            }
            pendingResize = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
        }

        func setTerminalTitle(source: TerminalView, title: String) {
            onTitleChange(title)
        }

        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}

        func send(source: TerminalView, data: ArraySlice<UInt8>) {
            guard !data.isEmpty else {
                return
            }
            onInput(String(decoding: data, as: UTF8.self))
        }

        func scrolled(source: TerminalView, position: Double) {}
        func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {}
        func bell(source: TerminalView) {}
        func clipboardCopy(source: TerminalView, content: Data) {
            UIPasteboard.general.setData(content, forPasteboardType: "public.utf8-plain-text")
        }
        func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
        func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
    }
}

final class VectorCodeSwiftTermHostView: TerminalView {
    private var renderedTerminalId: String?
    private var renderedSnapshot: String?
    private var themeConfigured = false

    func configureVectorCodeTheme() {
        guard !themeConfigured else {
            return
        }
        themeConfigured = true
        backgroundColor = UIColor(VectorCodeTheme.terminalBackground)
        nativeBackgroundColor = UIColor(VectorCodeTheme.terminalBackground)
        nativeForegroundColor = UIColor(VectorCodeTheme.text)
        caretColor = UIColor(VectorCodeTheme.accent)
        selectedTextBackgroundColor = UIColor(VectorCodeTheme.accentSoft)
        font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        keyboardAppearance = .dark
        autocorrectionType = .no
        autocapitalizationType = .none
        spellCheckingType = .no
        smartQuotesType = .no
        smartDashesType = .no
        installColors(Self.vectorCodeAnsiPalette)
    }

    func applyTerminalSnapshot(terminalId: String, rawOutput: String?, fallbackText: String) {
        let snapshot = rawOutput?.isEmpty == false ? rawOutput! : fallbackText
        guard renderedTerminalId != terminalId || renderedSnapshot != snapshot else {
            return
        }

        // The snapshot is a serialized terminal buffer, not an append-only output
        // stream: it embeds cursor, erase, and mode sequences that are only valid
        // when replayed into a reset terminal, so feeding a suffix of it corrupts
        // the screen. Always replay the full snapshot from a clean state.
        renderedTerminalId = terminalId
        getTerminal().resetToInitialState()
        if !snapshot.isEmpty {
            feed(text: snapshot)
        }
        renderedSnapshot = snapshot
        setNeedsLayout()
    }

    private static let vectorCodeAnsiPalette: [SwiftTerm.Color] = [
        terminalColor("#05080a"),
        terminalColor("#ff6b6b"),
        terminalColor("#9be28f"),
        terminalColor("#f4dd9d"),
        terminalColor("#77aaff"),
        terminalColor("#d69aff"),
        terminalColor("#66d7d2"),
        terminalColor("#eef4f2"),
        terminalColor("#69756f"),
        terminalColor("#ff8c8c"),
        terminalColor("#b7f3ad"),
        terminalColor("#ffe9b5"),
        terminalColor("#9fc2ff"),
        terminalColor("#e6b9ff"),
        terminalColor("#88eee8"),
        terminalColor("#ffffff"),
    ]

    private static func terminalColor(_ hex: String) -> SwiftTerm.Color {
        let value = UInt32(hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted), radix: 16) ?? 0
        return SwiftTerm.Color(
            red: UInt16((value >> 16) & 0xFF) * 257,
            green: UInt16((value >> 8) & 0xFF) * 257,
            blue: UInt16(value & 0xFF) * 257
        )
    }
}
#endif
