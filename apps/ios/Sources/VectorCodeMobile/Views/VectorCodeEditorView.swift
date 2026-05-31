import SwiftUI
#if os(iOS)
import UIKit
#endif

public struct VectorCodeEditorView: View {
    private static let largeEditorCharacterLimit = 240_000

    @ObservedObject var model: VectorCodeMobileWorkspaceModel

    public init(model: VectorCodeMobileWorkspaceModel) {
        self.model = model
    }

    public var body: some View {
        VStack(spacing: 0) {
            if !model.selectedEditors.isEmpty {
                VectorCodePillStrip(
                    items: model.selectedEditors,
                    selectedId: model.selectedEditor?.id,
                    trailingIcon: .close
                ) { editor in
                    model.selectEditor(editor)
                } trailingAction: { editor in
                    model.closeEditor(editor)
                } label: { editor in
                    HStack(spacing: 6) {
                        Text(editor.title)
                            .font(.footnote.weight(.semibold))
                        if editor.isDirty {
                            Circle()
                                .fill(VectorCodeTheme.warning)
                                .frame(width: 6, height: 6)
                        }
                    }
                }
            }

            if let editor = model.selectedEditor {
                let metrics = VectorCodeEditorMetrics(text: model.editorDraft)
                let isLargeEditor = metrics.characterCount > Self.largeEditorCharacterLimit
                VStack(spacing: 0) {
                    HStack {
                        Text(editor.path)
                            .font(.caption)
                            .foregroundStyle(VectorCodeTheme.muted)
                            .lineLimit(1)
                        Spacer()
                        Text(editor.language)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(VectorCodeTheme.subtle)
                        VectorCodeIconButton(icon: .save, size: 32) {
                            model.saveEditor()
                        }
                        .disabled(!editor.isDirty || isLargeEditor)
                        .opacity(editor.isDirty && !isLargeEditor ? 1 : 0.48)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(VectorCodeTheme.elevated)

                    VectorCodeEditorStatusBar(
                        editor: editor,
                        metrics: metrics,
                        isReadOnly: isLargeEditor
                    )

                    if let conflict = model.selectedEditorConflict {
                        VectorCodeEditorConflictPanel(
                            conflict: conflict,
                            localContent: model.editorDraft,
                            keepDesktop: {
                                model.keepDesktopEditorConflict()
                            },
                            overwrite: {
                                model.overwriteEditorConflict()
                            },
                            cancel: {
                                model.dismissEditorConflict()
                            }
                        )
                    }

                    if isLargeEditor {
                        Text("Large file opened read-only on mobile.")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(VectorCodeTheme.warning)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(VectorCodeTheme.raised)
                    }

                    MonacoLikeEditorSurface(
                        text: $model.editorDraft,
                        language: editor.language,
                        isEditable: !isLargeEditor
                    ) {
                        model.markEditorDirty()
                    }
                }
            } else {
                VectorCodeEmptyState(
                    title: "No file open",
                    icon: .file,
                    message: "Open a file from the synced project tree to view or edit it here.",
                    actionTitle: "Browse Files",
                    actionIcon: .files
                ) {
                    model.viewport = .files
                }
            }
        }
        .background(VectorCodeTheme.background)
    }
}

private struct VectorCodeEditorConflictPanel: View {
    let conflict: VectorCodeEditorConflict
    let localContent: String
    let keepDesktop: () -> Void
    let overwrite: () -> Void
    let cancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VectorCodeIconView(icon: .warning, size: 15)
                    .foregroundStyle(VectorCodeTheme.warning)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Desktop changed this file")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(VectorCodeTheme.text)
                    Text(conflict.path)
                        .font(.caption.monospaced())
                        .foregroundStyle(VectorCodeTheme.muted)
                        .lineLimit(1)
                }
                Spacer()
            }

            HStack(alignment: .top, spacing: 8) {
                VectorCodeConflictPreview(title: "Phone draft", content: localContent)
                VectorCodeConflictPreview(title: "Desktop", content: conflict.desktopContent)
            }

            HStack(spacing: 8) {
                Button("Keep Desktop", action: keepDesktop)
                    .buttonStyle(VectorCodeSecondaryButtonStyle())
                Button("Cancel", action: cancel)
                    .buttonStyle(VectorCodeSecondaryButtonStyle())
                Button("Overwrite", action: overwrite)
                    .buttonStyle(VectorCodePrimaryButtonStyle())
            }
        }
        .padding(12)
        .background(VectorCodeTheme.raised)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(VectorCodeTheme.warning.opacity(0.45))
                .frame(height: 1)
        }
    }
}

private struct VectorCodeConflictPreview: View {
    let title: String
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(VectorCodeTheme.muted)
            Text(preview)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(VectorCodeTheme.text)
                .lineLimit(5)
                .frame(maxWidth: .infinity, minHeight: 72, alignment: .topLeading)
                .padding(8)
                .background(VectorCodeTheme.terminalBackground)
                .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius))
        }
    }

    private var preview: String {
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).prefix(6)
        let value = lines.joined(separator: "\n")
        return value.isEmpty ? "Empty file" : value
    }
}

private struct VectorCodeEditorMetrics {
    let lineCount: Int
    let characterCount: Int

    init(text: String) {
        lineCount = max(text.split(separator: "\n", omittingEmptySubsequences: false).count, 1)
        characterCount = text.count
    }
}

private struct VectorCodeEditorStatusBar: View {
    let editor: VectorCodeEditorTab
    let metrics: VectorCodeEditorMetrics
    let isReadOnly: Bool

    var body: some View {
        HStack(spacing: 10) {
            statusLabel
            if let version = editor.version, !version.isEmpty {
                Text("Version \(version)")
            }
            Spacer(minLength: 8)
            Text("\(metrics.lineCount) lines")
            Text("\(metrics.characterCount) chars")
        }
        .font(.caption2.monospacedDigit())
        .foregroundStyle(VectorCodeTheme.subtle)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(VectorCodeTheme.background)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(VectorCodeTheme.line)
                .frame(height: 1)
        }
    }

    @ViewBuilder
    private var statusLabel: some View {
        if isReadOnly {
            Text("Read-only")
                .foregroundStyle(VectorCodeTheme.warning)
        } else if editor.isDirty {
            Text("Unsaved")
                .foregroundStyle(VectorCodeTheme.warning)
        } else {
            Text("Saved")
        }
    }
}

private struct MonacoLikeEditorSurface: View {
    @Binding var text: String
    let language: String
    let isEditable: Bool
    let onChange: () -> Void

    var body: some View {
        #if os(iOS)
        VectorCodeTextKitEditor(text: $text, isEditable: isEditable, onChange: onChange)
            .background(VectorCodeTheme.terminalBackground)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(VectorCodeTheme.line)
                    .frame(height: 1)
            }
        #else
        ScrollView(.horizontal, showsIndicators: true) {
            HStack(alignment: .top, spacing: 0) {
                let lineCount = max(text.split(separator: "\n", omittingEmptySubsequences: false).count, 1)
                VStack(alignment: .trailing, spacing: 0) {
                    ForEach(Array(1...lineCount), id: \.self) { lineNumber in
                        Text("\(lineNumber)")
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(VectorCodeTheme.subtle)
                            .frame(height: 20, alignment: .trailing)
                    }
                }
                .frame(width: max(36, CGFloat(String(lineCount).count) * 9 + 18), alignment: .trailing)
                .padding(.top, 15)
                .padding(.trailing, 9)
                .background(VectorCodeTheme.terminalBackground)

                Rectangle()
                    .fill(VectorCodeTheme.line)
                    .frame(width: 1)

                TextEditor(text: Binding(
                    get: { text },
                    set: { value in
                        text = value
                        onChange()
                    }
                ))
                .font(.system(size: 14, design: .monospaced))
                .lineSpacing(3)
                .scrollContentBackground(.hidden)
                .foregroundStyle(VectorCodeTheme.text)
                .tint(VectorCodeTheme.accentMuted)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(minWidth: 620, maxWidth: .infinity, maxHeight: .infinity)
                .background(VectorCodeTheme.terminalBackground)
                .disabled(!isEditable)
            }
            .frame(maxHeight: .infinity)
        }
        .background(VectorCodeTheme.terminalBackground)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(VectorCodeTheme.line)
                .frame(height: 1)
        }
        #endif
    }
}

#if os(iOS)
private struct VectorCodeTextKitEditor: UIViewRepresentable {
    @Binding var text: String
    let isEditable: Bool
    let onChange: () -> Void

    func makeUIView(context: Context) -> VectorCodeTextKitEditorView {
        let view = VectorCodeTextKitEditorView()
        view.textView.delegate = context.coordinator
        view.textView.isEditable = isEditable
        view.setText(text)
        return view
    }

    func updateUIView(_ uiView: VectorCodeTextKitEditorView, context: Context) {
        if uiView.textView.text != text {
            uiView.setText(text)
        }
        uiView.textView.isEditable = isEditable
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, onChange: onChange)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        @Binding private var text: String
        private let onChange: () -> Void

        init(text: Binding<String>, onChange: @escaping () -> Void) {
            _text = text
            self.onChange = onChange
        }

        func textViewDidChange(_ textView: UITextView) {
            text = textView.text
            onChange()
            if let editorView = textView.superview as? VectorCodeTextKitEditorView {
                editorView.updateLineNumbers()
                editorView.setNeedsLayout()
            }
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            (scrollView.superview as? VectorCodeTextKitEditorView)?.syncGutterScroll()
        }
    }
}

private final class VectorCodeTextKitEditorView: UIView {
    let textView = UITextView()
    private let gutterView = UITextView()
    private let divider = UIView()
    private let font = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
    private let gutterFont = UIFont.monospacedDigitSystemFont(ofSize: 13, weight: .regular)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(VectorCodeTheme.terminalBackground)

        gutterView.isEditable = false
        gutterView.isSelectable = false
        gutterView.isScrollEnabled = false
        gutterView.backgroundColor = UIColor(VectorCodeTheme.terminalBackground)
        gutterView.textColor = UIColor(VectorCodeTheme.subtle)
        gutterView.font = gutterFont
        gutterView.textAlignment = .right
        gutterView.textContainerInset = UIEdgeInsets(top: 11, left: 0, bottom: 12, right: 8)
        gutterView.textContainer.lineFragmentPadding = 0

        textView.backgroundColor = UIColor(VectorCodeTheme.terminalBackground)
        textView.textColor = UIColor(VectorCodeTheme.text)
        textView.tintColor = UIColor(VectorCodeTheme.accentMuted)
        textView.font = font
        textView.autocorrectionType = .no
        textView.autocapitalizationType = .none
        textView.smartQuotesType = .no
        textView.smartDashesType = .no
        textView.textContainerInset = UIEdgeInsets(top: 11, left: 10, bottom: 12, right: 12)
        textView.textContainer.lineFragmentPadding = 0
        textView.alwaysBounceVertical = true
        textView.alwaysBounceHorizontal = true
        textView.isDirectionalLockEnabled = false

        divider.backgroundColor = UIColor(VectorCodeTheme.line)

        addSubview(gutterView)
        addSubview(divider)
        addSubview(textView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let lineCount = max(textView.text.split(separator: "\n", omittingEmptySubsequences: false).count, 1)
        let gutterWidth = max(42, CGFloat(String(lineCount).count) * 9 + 24)
        gutterView.frame = CGRect(x: 0, y: 0, width: gutterWidth, height: bounds.height)
        divider.frame = CGRect(x: gutterWidth, y: 0, width: 1, height: bounds.height)
        textView.frame = CGRect(x: gutterWidth + 1, y: 0, width: max(0, bounds.width - gutterWidth - 1), height: bounds.height)
        updateLineNumbers()
    }

    func setText(_ text: String) {
        textView.text = text
        updateLineNumbers()
        setNeedsLayout()
    }

    func updateLineNumbers() {
        let lineCount = max(textView.text.split(separator: "\n", omittingEmptySubsequences: false).count, 1)
        gutterView.text = (1...lineCount).map(String.init).joined(separator: "\n")
        syncGutterScroll()
    }

    func syncGutterScroll() {
        gutterView.contentOffset.y = textView.contentOffset.y
    }
}
#endif
