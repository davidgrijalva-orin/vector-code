import SwiftUI

public struct VectorCodeTerminalView: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel
    @State private var input = ""
    @State private var showingRenameTerminal = false
    @State private var terminalRenameDraft = ""

    public init(model: VectorCodeMobileWorkspaceModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 0) {
            if !model.selectedTerminals.isEmpty {
                HStack(spacing: 0) {
                    VectorCodePillStrip(
                        items: model.selectedTerminals,
                        selectedId: model.selectedTerminal?.id,
                        showsIndicators: true,
                        trailingIcon: .close
                    ) { terminal in
                        model.selectTerminal(terminal)
                    } trailingAction: { terminal in
                        model.closeTerminal(terminal)
                    } label: { terminal in
                        HStack(spacing: 7) {
                            VectorCodeIconView(icon: .terminal, size: 13)
                            Text(terminal.title)
                                .font(.footnote.weight(.semibold))
                        }
                    }
                    VectorCodeIconButton(icon: .add, size: 32) {
                        model.createTerminal()
                    }
                    .padding(.trailing, 12)
                }
                .background(VectorCodeTheme.background)
            }

            if let terminal = model.selectedTerminal {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(terminal.title)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(VectorCodeTheme.text)
                                .lineLimit(1)
                            Text(terminal.cwd)
                                .font(.caption2)
                                .foregroundStyle(VectorCodeTheme.terminalBlue)
                                .lineLimit(1)
                        }
                        Spacer()
                        VectorCodeIconButton(icon: .edit, size: 31) {
                            terminalRenameDraft = terminal.title
                            showingRenameTerminal = true
                        }
                        VectorCodeIconButton(icon: .refresh, size: 31) {
                            Task {
                                await model.refreshTerminalOutput(projectId: terminal.projectId, terminalId: terminal.id)
                            }
                        }
                        VectorCodeIconButton(icon: .clearAll, size: 31) {
                            model.clearTerminal(terminal)
                        }
                        VectorCodeIconButton(icon: .debugStop, foreground: VectorCodeTheme.warning, size: 31) {
                            model.interruptTerminal(terminal)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(VectorCodeTheme.background)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(VectorCodeTheme.line)
                            .frame(height: 1)
                    }

                    terminalSurface(terminal)

                    HStack(spacing: 8) {
                        TextField("Paste command", text: $input)
                            .textFieldStyle(.plain)
                            .submitLabel(.send)
                            .font(.system(size: 14, design: .monospaced))
                            .padding(10)
                            .background(VectorCodeTheme.raised)
                            .overlay {
                                RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius)
                                    .stroke(VectorCodeTheme.line, lineWidth: 1)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius))
                            .onSubmit {
                                submitInput()
                            }
                        VectorCodeIconButton(icon: .copy, size: 34) {
                            model.sendTerminalInput(input, submit: false)
                            input = ""
                        }
                        VectorCodeIconButton(
                            icon: .send,
                            foreground: Color.black,
                            background: VectorCodeTheme.accent,
                            size: 34
                        ) {
                            submitInput()
                        }
                    }
                    .padding(10)
                    .background(VectorCodeTheme.background)
                }
                .task(id: terminal.id) {
                    await model.pollTerminalOutput(projectId: terminal.projectId, terminalId: terminal.id)
                }
            } else {
                if model.selectedProject == nil {
                    VectorCodeEmptyState(
                        title: "No project selected",
                        icon: .projects,
                        message: "Pair your desktop or choose a project before opening terminals.",
                        actionTitle: "Projects",
                        actionIcon: .projects
                    ) {
                        model.viewport = .projects
                    }
                } else {
                    VectorCodeEmptyState(
                        title: "No terminal open",
                        icon: .terminal,
                        message: "Create a terminal for the selected project. Desktop terminals stay scoped to each project.",
                        actionTitle: "New Terminal",
                        actionIcon: .add
                    ) {
                        model.createTerminal()
                    }
                }
            }
        }
        .background(VectorCodeTheme.background)
        .alert("Rename terminal", isPresented: $showingRenameTerminal) {
            TextField("Name", text: $terminalRenameDraft)
            Button("Rename") {
                if let terminal = model.selectedTerminal {
                    model.renameTerminal(terminal, title: terminalRenameDraft)
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func submitInput() {
        let command = input
        guard !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        model.sendTerminalInput(command, submit: true)
        input = ""
    }

    private func terminalLineColor(_ line: String) -> Color {
        let lowercased = line.lowercased()
        if line.hasPrefix("$") {
            return VectorCodeTheme.terminalGreen
        }
        if lowercased.contains("error") || lowercased.contains("failed") {
            return VectorCodeTheme.danger
        }
        if lowercased.contains("warn") {
            return VectorCodeTheme.terminalYellow
        }
        return VectorCodeTheme.text
    }

    private func terminalRenderedLines(_ terminal: VectorCodeTerminalTab) -> [AttributedString] {
        if let rawOutput = terminal.rawOutput, !rawOutput.isEmpty {
            return VectorCodeAnsiRenderer.lines(from: rawOutput)
        }
        return terminal.output.map { line in
            var attributes = AttributeContainer()
            attributes.foregroundColor = terminalLineColor(line)
            return AttributedString(line, attributes: attributes)
        }
    }

    @ViewBuilder
    private func terminalSurface(_ terminal: VectorCodeTerminalTab) -> some View {
        #if os(iOS)
        VectorCodeNativeTerminalSurface(
            terminal: terminal,
            fallbackText: terminal.output.joined(separator: "\r\n"),
            onInput: { data in
                model.sendTerminalData(data, terminal: terminal)
            },
            onResize: { cols, rows in
                model.resizeTerminal(terminal, cols: cols, rows: rows)
            },
            onTitleChange: { title in
                model.updateTerminalHostTitle(terminal, title: title)
            }
        )
        .background(VectorCodeTheme.terminalBackground)
        #else
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(terminalRenderedLines(terminal).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .textSelection(.enabled)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id("terminal-bottom")
                }
                .font(.system(size: 13, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
            }
            .background(VectorCodeTheme.terminalBackground)
            .onChange(of: terminal.output.count) {
                proxy.scrollTo("terminal-bottom", anchor: .bottom)
            }
            .onChange(of: terminal.id) {
                proxy.scrollTo("terminal-bottom", anchor: .bottom)
            }
        }
        #endif
    }
}

private enum VectorCodeAnsiRenderer {
    static func lines(from rawOutput: String) -> [AttributedString] {
        let sanitized = rawOutput
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = sanitized.split(separator: "\n", omittingEmptySubsequences: false)
        if lines.isEmpty {
            return [AttributedString("")]
        }
        return lines.map { line in
            parse(String(line))
        }
    }

    private static func parse(_ input: String) -> AttributedString {
        var result = AttributedString()
        var index = input.startIndex
        var color = VectorCodeTheme.text
        var bold = false

        func append(_ text: String) {
            guard !text.isEmpty else {
                return
            }
            var attributes = AttributeContainer()
            attributes.foregroundColor = color
            if bold {
                attributes.font = .system(size: 13, weight: .semibold, design: .monospaced)
            }
            result.append(AttributedString(text, attributes: attributes))
        }

        while index < input.endIndex {
            if input[index] == "\u{001B}" {
                let next = input.index(after: index)
                guard next < input.endIndex else {
                    break
                }
                if input[next] == "[" {
                    let sequenceStart = input.index(after: next)
                    var sequenceEnd = sequenceStart
                    while sequenceEnd < input.endIndex, !isCSIFinalByte(input[sequenceEnd]) {
                        sequenceEnd = input.index(after: sequenceEnd)
                    }
                    guard sequenceEnd < input.endIndex else {
                        break
                    }
                    if input[sequenceEnd] == "m" {
                        applySGR(String(input[sequenceStart..<sequenceEnd]), color: &color, bold: &bold)
                    }
                    index = input.index(after: sequenceEnd)
                    continue
                }
                if input[next] == "]" {
                    index = skipOSC(input, from: next)
                    continue
                }
            }

            let textStart = index
            while index < input.endIndex, input[index] != "\u{001B}" {
                index = input.index(after: index)
            }
            append(String(input[textStart..<index]))
        }

        return result
    }

    private static func skipOSC(_ input: String, from index: String.Index) -> String.Index {
        var cursor = input.index(after: index)
        while cursor < input.endIndex {
            if input[cursor] == "\u{0007}" {
                return input.index(after: cursor)
            }
            if input[cursor] == "\u{001B}" {
                let next = input.index(after: cursor)
                if next < input.endIndex, input[next] == "\\" {
                    return input.index(after: next)
                }
            }
            cursor = input.index(after: cursor)
        }
        return input.endIndex
    }

    private static func isCSIFinalByte(_ character: Character) -> Bool {
        guard let scalar = character.unicodeScalars.first else {
            return false
        }
        return scalar.value >= 0x40 && scalar.value <= 0x7E
    }

    private static func applySGR(_ sequence: String, color: inout Color, bold: inout Bool) {
        let values = sequence.isEmpty ? [0] : sequence.split(separator: ";").compactMap { Int($0) }
        for value in values {
            switch value {
            case 0:
                color = VectorCodeTheme.text
                bold = false
            case 1:
                bold = true
            case 22:
                bold = false
            case 30:
                color = Color(red: 0.45, green: 0.48, blue: 0.48)
            case 31:
                color = VectorCodeTheme.danger
            case 32:
                color = VectorCodeTheme.terminalGreen
            case 33:
                color = VectorCodeTheme.terminalYellow
            case 34:
                color = VectorCodeTheme.terminalBlue
            case 35:
                color = Color(red: 0.83, green: 0.58, blue: 0.97)
            case 36:
                color = VectorCodeTheme.accentMuted
            case 37:
                color = VectorCodeTheme.text
            case 90:
                color = VectorCodeTheme.subtle
            case 91:
                color = VectorCodeTheme.danger
            case 92:
                color = VectorCodeTheme.terminalGreen
            case 93:
                color = VectorCodeTheme.terminalYellow
            case 94:
                color = VectorCodeTheme.terminalBlue
            case 95:
                color = Color(red: 0.89, green: 0.67, blue: 1.0)
            case 96:
                color = VectorCodeTheme.accent
            case 97:
                color = .white
            default:
                continue
            }
        }
    }
}
