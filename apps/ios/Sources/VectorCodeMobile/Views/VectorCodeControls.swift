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
        .background(background)
        .overlay {
            RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius)
                .stroke(VectorCodeTheme.line, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius))
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
                    .background(isSelected ? VectorCodeTheme.accentSoft : Color.clear)
                    .overlay {
                        RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius)
                            .stroke(isSelected ? VectorCodeTheme.accent.opacity(0.42) : VectorCodeTheme.line, lineWidth: 1)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius))
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

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .background(VectorCodeTheme.panel)
            .overlay {
                RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius)
                    .stroke(VectorCodeTheme.line, lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius))
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
            VectorCodeIconView(icon: icon, size: 26)
                .foregroundStyle(VectorCodeTheme.subtle)
                .frame(width: 54, height: 54)
                .background(VectorCodeTheme.raised.opacity(0.72))
                .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius))
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
                Button(action: action) {
                    HStack(spacing: 8) {
                        if let actionIcon {
                            VectorCodeIconView(icon: actionIcon, size: 15)
                        }
                        Text(actionTitle)
                    }
                    .frame(maxWidth: 220)
                }
                .buttonStyle(VectorCodeSecondaryButtonStyle())
                .padding(.top, 2)
            }
            if let secondaryActionTitle, let secondaryAction {
                Button(action: secondaryAction) {
                    HStack(spacing: 8) {
                        if let secondaryActionIcon {
                            VectorCodeIconView(icon: secondaryActionIcon, size: 15)
                        }
                        Text(secondaryActionTitle)
                    }
                    .frame(maxWidth: 220)
                }
                .buttonStyle(VectorCodeSecondaryButtonStyle())
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
