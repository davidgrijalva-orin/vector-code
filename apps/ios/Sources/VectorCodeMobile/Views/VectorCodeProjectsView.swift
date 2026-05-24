import SwiftUI

public struct VectorCodeProjectsView: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel
    let openPairing: () -> Void

    public init(model: VectorCodeMobileWorkspaceModel, openPairing: @escaping () -> Void = {}) {
        self.model = model
        self.openPairing = openPairing
    }

    public var body: some View {
        Group {
            if model.snapshot.projects.isEmpty {
                emptyProjectsState
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        HStack {
                            Text("\(model.snapshot.projects.count) projects")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(VectorCodeTheme.muted)
                            Spacer()
                            VectorCodeIconButton(icon: .refresh, size: 30) {
                                model.refreshWorkspace()
                            }
                        }
                        .padding(.horizontal, 2)
                        .padding(.bottom, 2)

                        ForEach(model.snapshot.projects) { project in
                            Button {
                                model.switchProject(project)
                            } label: {
                                HStack(spacing: 12) {
                                    Rectangle()
                                        .fill(project.id == model.selectedProject?.id ? VectorCodeTheme.accent : Color.clear)
                                        .frame(width: 2)
                                        .clipShape(Capsule())
                                    VectorCodeProjectIdentity(
                                        project: project,
                                        dotSize: 6,
                                        titleFont: .callout.weight(.semibold),
                                        pathFont: .caption
                                    )
                                    Spacer()
                                    VectorCodeIconView(icon: .chevronRight, size: 13)
                                        .foregroundStyle(VectorCodeTheme.muted)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 11)
                                .background(project.id == model.selectedProject?.id ? VectorCodeTheme.accentSoft : VectorCodeTheme.panel)
                                .overlay {
                                    RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius)
                                        .stroke(project.id == model.selectedProject?.id ? VectorCodeTheme.accent.opacity(0.35) : VectorCodeTheme.line, lineWidth: 1)
                                }
                                .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.cornerRadius))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(14)
                }
            }
        }
        .background(VectorCodeTheme.background)
    }

    @ViewBuilder
    private var emptyProjectsState: some View {
        if model.isRemoteConnected {
            VectorCodeEmptyState(
                title: "No projects open",
                icon: .projects,
                message: "VectorCode is connected to your Mac. Open or add a project on desktop, then refresh this workspace.",
                actionTitle: "Refresh",
                actionIcon: .refresh,
                action: {
                    model.refreshWorkspace()
                },
                secondaryActionTitle: "Scan another QR",
                secondaryActionIcon: .deviceMobile,
                secondaryAction: openPairing
            )
        } else if model.relayConfiguration != nil {
            VectorCodeEmptyState(
                title: "Desktop workspace loading",
                icon: .deviceMobile,
                message: "This phone is paired. Reconnect to the desktop bridge or scan a fresh QR if the desktop QR expired.",
                actionTitle: "Reconnect",
                actionIcon: .refresh,
                action: {
                    model.connectToDesktop()
                },
                secondaryActionTitle: "Scan QR",
                secondaryActionIcon: .deviceMobile,
                secondaryAction: openPairing
            )
        } else {
            VectorCodeEmptyState(
                title: "Pair your desktop",
                icon: .deviceMobile,
                message: "Scan the QR code from VectorCode on your Mac to load open projects, files, and terminals.",
                actionTitle: "Scan QR",
                actionIcon: .deviceMobile,
                action: openPairing
            )
        }
    }
}
