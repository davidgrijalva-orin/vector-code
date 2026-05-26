import SwiftUI

public struct VectorCodeMobileRootView: View {
    @StateObject private var model: VectorCodeMobileWorkspaceModel
    @State private var showingPairing = false

    public init(model: VectorCodeMobileWorkspaceModel = VectorCodeMobileWorkspaceModel()) {
        _model = StateObject(wrappedValue: model)
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VectorCodeMobileHeader(model: model) {
                    showingPairing = true
                }
                VectorCodeProjectStrip(model: model)
                Divider().overlay(VectorCodeTheme.line)
                selectedViewport
                if !model.snapshot.projects.isEmpty {
                    VectorCodeMobileTabBar(model: model)
                }
            }
            .background(VectorCodeTheme.background.ignoresSafeArea())
            .foregroundStyle(VectorCodeTheme.text)
            #if os(iOS)
            .toolbar(.hidden, for: .navigationBar)
            #endif
        }
        .sheet(isPresented: $showingPairing) {
            VectorCodePairingView(model: model)
        }
        .task {
            model.connectToDesktopIfPaired()
        }
    }

    @ViewBuilder
    private var selectedViewport: some View {
        switch model.viewport {
        case .projects:
            VectorCodeProjectsView(model: model) {
                showingPairing = true
            }
        case .files:
            VectorCodeFilesView(model: model)
        case .editor:
            VectorCodeEditorView(model: model)
        case .terminal:
            VectorCodeTerminalView(model: model)
        }
    }
}

private struct VectorCodeMobileHeader: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel
    let openPairing: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VectorCodeBrandWordmark()
            Spacer()
            HStack(spacing: 6) {
                Circle()
                    .fill(model.isRemoteConnected ? VectorCodeTheme.accent : VectorCodeTheme.subtle)
                    .frame(width: 6, height: 6)
                Text(model.statusText)
                    .font(.caption2.weight(.medium))
                    .lineLimit(1)
            }
            .foregroundStyle(VectorCodeTheme.muted)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(VectorCodeTheme.raised.opacity(0.72))
            .clipShape(Capsule())
            VectorCodeIconButton(icon: .deviceMobile) {
                openPairing()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(VectorCodeTheme.background)
    }
}

private struct VectorCodeProjectStrip: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel

    var body: some View {
        Group {
            if !model.snapshot.projects.isEmpty {
                VectorCodePillStrip(
                    items: model.snapshot.projects,
                    selectedId: model.selectedProject?.id
                ) { project in
                    model.switchProject(project)
                } label: { project in
                    VectorCodeProjectIdentity(
                        project: project,
                        dotSize: 6,
                        titleFont: .caption.weight(.semibold),
                        pathFont: .caption2,
                        showsPath: false
                    )
                    .frame(minWidth: 104, alignment: .leading)
                }
            } else {
                EmptyView()
            }
        }
        .background(VectorCodeTheme.background)
    }
}

private struct VectorCodeMobileTabBar: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel

    var body: some View {
        HStack(spacing: 0) {
            ForEach(VectorCodeMobileWorkspaceModel.Viewport.allCases) { viewport in
                Button {
                    model.viewport = viewport
                } label: {
                    VStack(spacing: 5) {
                        VectorCodeIconView(icon: viewport.icon, size: 16)
                        Text(viewport.rawValue)
                            .font(.caption2.weight(.medium))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .foregroundStyle(model.viewport == viewport ? VectorCodeTheme.accent : VectorCodeTheme.muted)
                }
                .buttonStyle(.plain)
            }
        }
        .background(VectorCodeTheme.background)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(VectorCodeTheme.line)
                .frame(height: 1)
        }
    }
}

extension VectorCodeMobileWorkspaceModel.Viewport {
    var icon: VectorCodeIcon {
        switch self {
        case .projects:
            return .projects
        case .files:
            return .files
        case .editor:
            return .file
        case .terminal:
            return .terminal
        }
    }
}
