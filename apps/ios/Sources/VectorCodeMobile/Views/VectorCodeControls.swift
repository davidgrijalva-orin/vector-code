import SwiftUI

struct VectorCodeIconButton: View {
    let icon: VectorCodeIcon
    let foreground: Color
    let background: Color
    let size: CGFloat
    let action: () -> Void

    init(
        icon: VectorCodeIcon,
        foreground: Color = VectorCodeTheme.muted,
        background: Color = .clear,
        size: CGFloat = 34,
        action: @escaping () -> Void
    ) {
        self.icon = icon
        self.foreground = foreground
        self.background = background
        self.size = size
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            VectorCodeIconView(icon: icon, size: 17)
                .frame(width: size, height: size)
        }
        .buttonStyle(.plain)
        .foregroundStyle(foreground)
        .vectorCodeOutlinedSurface(background: background, cornerRadius: VectorCodeTheme.compactRadius)
    }
}

struct VectorCodeIconTile: View {
    let icon: VectorCodeIcon
    var iconSize: CGFloat = 26
    var tileSize: CGFloat = 54
    var foreground: Color = VectorCodeTheme.accent
    var background: Color = VectorCodeTheme.accentSoft
    var cornerRadius: CGFloat = VectorCodeTheme.cornerRadius

    var body: some View {
        VectorCodeIconView(icon: icon, size: iconSize)
            .foregroundStyle(foreground)
            .frame(width: tileSize, height: tileSize)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }
}

struct VectorCodeSheetHeader: View {
    var title: String?
    var titleColor: Color = VectorCodeTheme.muted
    var closeForeground: Color = VectorCodeTheme.muted
    var closeBackground: Color = .clear
    var closeSize: CGFloat = 32
    var showsDivider: Bool = false
    var topPadding: CGFloat = 12
    var bottomPadding: CGFloat = 12
    var closeAction: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    init(
        title: String? = nil,
        titleColor: Color = VectorCodeTheme.muted,
        closeForeground: Color = VectorCodeTheme.muted,
        closeBackground: Color = .clear,
        closeSize: CGFloat = 32,
        showsDivider: Bool = false,
        topPadding: CGFloat = 12,
        bottomPadding: CGFloat = 12,
        closeAction: (() -> Void)? = nil
    ) {
        self.title = title
        self.titleColor = titleColor
        self.closeForeground = closeForeground
        self.closeBackground = closeBackground
        self.closeSize = closeSize
        self.showsDivider = showsDivider
        self.topPadding = topPadding
        self.bottomPadding = bottomPadding
        self.closeAction = closeAction
    }

    var body: some View {
        HStack(spacing: 10) {
            VectorCodeBrandWordmark()
            if let title {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(titleColor)
            }
            Spacer()
            VectorCodeIconButton(icon: .close, foreground: closeForeground, background: closeBackground, size: closeSize) {
                if let closeAction {
                    closeAction()
                } else {
                    dismiss()
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, topPadding)
        .padding(.bottom, bottomPadding)
        .overlay(alignment: .bottom) {
            if showsDivider {
                Rectangle()
                    .fill(VectorCodeTheme.line)
                    .frame(height: 1)
            }
        }
    }
}

public struct VectorCodePrimaryButtonStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        VectorCodeButtonChrome(
            configuration: configuration,
            foreground: VectorCodeTheme.accent,
            pressedForeground: VectorCodeTheme.text,
            background: VectorCodeTheme.raised,
            pressedBackground: VectorCodeTheme.accentSoft,
            stroke: VectorCodeTheme.accent.opacity(0.36),
            pressedStroke: VectorCodeTheme.accent.opacity(0.62)
        )
    }
}

public struct VectorCodeSecondaryButtonStyle: ButtonStyle {
    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        VectorCodeButtonChrome(
            configuration: configuration,
            foreground: VectorCodeTheme.text,
            pressedForeground: VectorCodeTheme.text,
            background: .clear,
            pressedBackground: VectorCodeTheme.hover,
            stroke: VectorCodeTheme.line,
            pressedStroke: VectorCodeTheme.line
        )
    }
}

private struct VectorCodeButtonChrome: View {
    let configuration: ButtonStyle.Configuration
    let foreground: Color
    let pressedForeground: Color
    let background: Color
    let pressedBackground: Color
    let stroke: Color
    let pressedStroke: Color

    var body: some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .foregroundStyle(configuration.isPressed ? pressedForeground : foreground)
            .vectorCodeOutlinedSurface(
                background: configuration.isPressed ? pressedBackground : background,
                stroke: configuration.isPressed ? pressedStroke : stroke
            )
    }
}

struct VectorCodePillStrip<Item: Identifiable, Label: View>: View where Item.ID: Equatable {
    let items: [Item]
    let selectedId: Item.ID?
    let showsIndicators: Bool
    let trailingIcon: VectorCodeIcon?
    let action: (Item) -> Void
    let trailingAction: ((Item) -> Void)?
    @ViewBuilder let label: (Item) -> Label

    init(
        items: [Item],
        selectedId: Item.ID?,
        showsIndicators: Bool = false,
        trailingIcon: VectorCodeIcon? = nil,
        action: @escaping (Item) -> Void,
        trailingAction: ((Item) -> Void)? = nil,
        @ViewBuilder label: @escaping (Item) -> Label
    ) {
        self.items = items
        self.selectedId = selectedId
        self.showsIndicators = showsIndicators
        self.trailingIcon = trailingIcon
        self.action = action
        self.trailingAction = trailingAction
        self.label = label
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: showsIndicators) {
            HStack(spacing: 8) {
                ForEach(items) { item in
                    let isSelected = item.id == selectedId
                    HStack(spacing: 0) {
                        Button {
                            action(item)
                        } label: {
                            label(item)
                                .padding(.leading, 11)
                                .padding(.trailing, trailingAction == nil ? 11 : 4)
                                .padding(.vertical, 7)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if let trailingIcon, let trailingAction {
                            Button {
                                trailingAction(item)
                            } label: {
                                VectorCodeIconView(icon: trailingIcon, size: 12)
                                    .frame(width: 25, height: 28)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(VectorCodeTheme.subtle)
                        }
                    }
                    .foregroundStyle(isSelected ? VectorCodeTheme.text : VectorCodeTheme.muted)
                    .vectorCodeOutlinedSurface(
                        background: isSelected ? VectorCodeTheme.accentSoft : Color.clear,
                        stroke: isSelected ? VectorCodeTheme.accent.opacity(0.42) : VectorCodeTheme.line,
                        cornerRadius: VectorCodeTheme.compactRadius
                    )
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }
}

struct VectorCodeProjectIdentity: View {
    let project: VectorCodeProjectSummary
    var dotSize: CGFloat = 8
    var titleFont: Font = .headline.weight(.semibold)
    var pathFont: Font = .footnote
    var showsPath: Bool = true

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(project.isOnline ? VectorCodeTheme.accent : VectorCodeTheme.muted)
                .frame(width: dotSize, height: dotSize)
            VStack(alignment: .leading, spacing: 4) {
                Text(project.name)
                    .font(titleFont)
                if showsPath {
                    Text(project.path)
                        .font(pathFont)
                        .foregroundStyle(VectorCodeTheme.muted)
                        .lineLimit(1)
                }
            }
        }
    }
}

struct VectorCodeBrandWordmark: View {
    var body: some View {
        HStack(spacing: 8) {
            VectorCodeMark()
                .fill(VectorCodeTheme.accent, style: FillStyle(eoFill: true))
                .frame(width: 23, height: 23)
            HStack(spacing: 0) {
                Text("Vector")
                    .foregroundStyle(VectorCodeTheme.text)
                    .fontWeight(.bold)
                Text("Code")
                    .foregroundStyle(VectorCodeTheme.accent)
                    .fontWeight(.semibold)
            }
            .font(.system(size: 19, weight: .semibold, design: .default))
        }
    }
}

struct VectorCodeSectionSurface<Content: View>: View {
    let content: Content
    let contentPadding: CGFloat

    init(contentPadding: CGFloat = 0, @ViewBuilder content: () -> Content) {
        self.content = content()
        self.contentPadding = contentPadding
    }

    var body: some View {
        content
            .padding(contentPadding)
            .vectorCodeOutlinedSurface()
    }
}

struct VectorCodeEmptyState: View {
    let title: String
    let icon: VectorCodeIcon
    var message: String?
    var actionTitle: String?
    var actionIcon: VectorCodeIcon?
    var action: (() -> Void)?
    var secondaryActionTitle: String?
    var secondaryActionIcon: VectorCodeIcon?
    var secondaryAction: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            VectorCodeIconTile(
                icon: icon,
                foreground: VectorCodeTheme.subtle,
                background: VectorCodeTheme.raised.opacity(0.72)
            )
            Text(title)
                .font(.callout.weight(.medium))
                .foregroundStyle(VectorCodeTheme.text)
            if let message {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(VectorCodeTheme.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 280)
            }
            if let actionTitle, let action {
                VectorCodeEmptyStateActionButton(title: actionTitle, icon: actionIcon, action: action)
                .padding(.top, 2)
            }
            if let secondaryActionTitle, let secondaryAction {
                VectorCodeEmptyStateActionButton(title: secondaryActionTitle, icon: secondaryActionIcon, action: secondaryAction)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct VectorCodeEmptyStateActionButton: View {
    let title: String
    let icon: VectorCodeIcon?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let icon {
                    VectorCodeIconView(icon: icon, size: 15)
                }
                Text(title)
            }
            .frame(maxWidth: 220)
        }
        .buttonStyle(VectorCodeSecondaryButtonStyle())
    }
}

struct VectorCodeOutlinedTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .textFieldStyle(.plain)
            .font(.system(size: 14, design: .monospaced))
            .padding(10)
            .vectorCodeOutlinedSurface(background: VectorCodeTheme.raised, cornerRadius: VectorCodeTheme.compactRadius)
    }
}

struct VectorCodeRenamePrompt<Item> {
    let item: Item
    var draft: String

    init(item: Item, draft: String) {
        self.item = item
        self.draft = draft
    }
}

extension View {
    nonisolated func vectorCodeOutlinedSurface(
        background: Color = VectorCodeTheme.panel,
        stroke: Color = VectorCodeTheme.line,
        cornerRadius: CGFloat = VectorCodeTheme.cornerRadius
    ) -> some View {
        modifier(VectorCodeOutlinedSurfaceModifier(background: background, stroke: stroke, cornerRadius: cornerRadius))
    }

    func vectorCodeRenameAlert<Item>(
        _ title: String,
        prompt: Binding<VectorCodeRenamePrompt<Item>?>,
        action: @escaping (Item, String) -> Void
    ) -> some View {
        modifier(VectorCodeRenameAlertModifier(title: title, prompt: prompt, action: action))
    }
}

private struct VectorCodeOutlinedSurfaceModifier: ViewModifier {
    let background: Color
    let stroke: Color
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content
            .background(background)
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(stroke, lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }
}

private struct VectorCodeRenameAlertModifier<Item>: ViewModifier {
    let title: String
    @Binding var prompt: VectorCodeRenamePrompt<Item>?
    let action: (Item, String) -> Void

    func body(content: Content) -> some View {
        content.alert(title, isPresented: isPresented) {
            TextField("Name", text: draft)
            Button("Rename") {
                if let prompt {
                    action(prompt.item, prompt.draft)
                }
                prompt = nil
            }
            Button("Cancel", role: .cancel) {
                prompt = nil
            }
        }
    }

    private var isPresented: Binding<Bool> {
        Binding(
            get: { prompt != nil },
            set: { isPresented in
                if !isPresented {
                    prompt = nil
                }
            }
        )
    }

    private var draft: Binding<String> {
        Binding(
            get: { prompt?.draft ?? "" },
            set: { value in
                var nextPrompt = prompt
                nextPrompt?.draft = value
                prompt = nextPrompt
            }
        )
    }
}
