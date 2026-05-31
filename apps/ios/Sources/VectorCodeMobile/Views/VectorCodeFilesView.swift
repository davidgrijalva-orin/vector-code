import SwiftUI

public struct VectorCodeFilesView: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel
    @State private var collapsedFolderPathsByProject = [String: Set<String>]()
    @State private var renamePrompt: VectorCodeRenamePrompt<VectorCodeProjectFileAction>?
    @State private var copyingFile: VectorCodeProjectFileAction?
    @State private var copyDestinationPath = ""

    public init(model: VectorCodeMobileWorkspaceModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            if model.selectedProject == nil {
                VectorCodeEmptyState(
                    title: "No project selected",
                    icon: .projects,
                    message: "Pair your desktop or choose a project before browsing files.",
                    actionTitle: "Projects",
                    actionIcon: .projects
                ) {
                    model.viewport = .projects
                }
            } else if model.selectedFiles.isEmpty {
                VectorCodeEmptyState(
                    title: "No files synced",
                    icon: .files,
                    message: "This project has not reported a file tree yet. Refresh the desktop connection and try again.",
                    actionTitle: "Projects",
                    actionIcon: .projects
                ) {
                    model.viewport = .projects
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(model.selectedProject?.name ?? "Files")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(VectorCodeTheme.text)
                                Text("\(model.selectedFiles.count) top-level items")
                                    .font(.caption2)
                                    .foregroundStyle(model.selectedFilesTruncated ? VectorCodeTheme.warning : VectorCodeTheme.muted)
                            }
                            Spacer()
                            VectorCodeIconButton(icon: .clearAll, size: 30) {
                                collapsedFolderPaths.wrappedValue = Set(Self.folderPaths(in: model.selectedFiles))
                            }
                        }
                        .padding(.horizontal, 2)
                        .padding(.bottom, 6)

                        if model.selectedFilesTruncated {
                            Text("Top-level files are truncated. Open a folder to sync its full children.")
                                .font(.caption2)
                                .foregroundStyle(VectorCodeTheme.warning)
                                .padding(.horizontal, 2)
                                .padding(.bottom, 4)
                        }

                        ForEach(model.selectedFiles) { node in
                            VectorCodeFileRow(
                                model: model,
                                node: node,
                                depth: 0,
                                collapsedFolderPaths: collapsedFolderPaths
                            ) { node in
                                if let project = model.selectedProject {
                                    renamePrompt = VectorCodeRenamePrompt(
                                        item: VectorCodeProjectFileAction(project: project, node: node),
                                        draft: node.name
                                    )
                                }
                            } copyAction: { node in
                                if let project = model.selectedProject {
                                    copyingFile = VectorCodeProjectFileAction(project: project, node: node)
                                    copyDestinationPath = node.path
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                }
            }
        }
        .background(VectorCodeTheme.background)
        .vectorCodeRenameAlert("Rename", prompt: $renamePrompt) { file, name in
            model.renameFile(file.node, in: file.project, to: name)
        }
        .sheet(item: $copyingFile) { file in
            VectorCodeCopyFileSheet(
                model: model,
                file: file,
                destinationPath: $copyDestinationPath
            )
        }
    }

    private var collapsedFolderPaths: Binding<Set<String>> {
        Binding(
            get: {
                guard let projectId = model.selectedProject?.id else {
                    return []
                }
                return collapsedFolderPathsByProject[projectId] ?? []
            },
            set: { paths in
                guard let projectId = model.selectedProject?.id else {
                    return
                }
                collapsedFolderPathsByProject[projectId] = paths
            }
        )
    }

    private static func folderPaths(in nodes: [VectorCodeFileNode]) -> [String] {
        nodes.flatMap { node -> [String] in
            guard node.kind == .folder else {
                return []
            }
            return [node.path] + folderPaths(in: node.children)
        }
    }
}

private struct VectorCodeProjectFileAction: Identifiable {
    let project: VectorCodeProjectSummary
    let node: VectorCodeFileNode

    var id: String {
        "\(project.id):\(node.path)"
    }
}

private struct VectorCodeFileRow: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel
    let node: VectorCodeFileNode
    let depth: Int
    @Binding var collapsedFolderPaths: Set<String>
    let renameAction: (VectorCodeFileNode) -> Void
    let copyAction: (VectorCodeFileNode) -> Void

    private var expanded: Bool {
        !collapsedFolderPaths.contains(node.path)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                if node.kind == .folder {
                    toggleFolder()
                } else {
                    model.openFile(node)
                }
            } label: {
                HStack(spacing: 8) {
                    if node.kind == .folder {
                        VectorCodeIconView(icon: expanded ? .chevronDown : .chevronRight, size: 11)
                            .foregroundStyle(VectorCodeTheme.subtle)
                            .frame(width: 12)
                    } else {
                        Color.clear
                            .frame(width: 12)
                    }
                    VectorCodeIconView(icon: icon)
                        .foregroundStyle(node.kind == .folder ? VectorCodeTheme.muted : VectorCodeTheme.subtle)
                        .frame(width: 16)
                    Text(node.name)
                        .font(.system(size: 14, weight: node.kind == .folder ? .medium : .regular, design: .default))
                        .foregroundStyle(node.kind == .folder ? VectorCodeTheme.text : VectorCodeTheme.muted)
                    if node.childrenTruncated {
                        VectorCodeIconView(icon: .refresh, size: 11)
                            .foregroundStyle(VectorCodeTheme.subtle)
                    }
                    Spacer()
                }
                .padding(.leading, CGFloat(depth) * 18)
                .padding(.horizontal, 7)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(node.kind == .folder ? VectorCodeTheme.hover : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: VectorCodeTheme.compactRadius))
            .contextMenu {
                Button {
                    renameAction(node)
                } label: {
                    Label("Rename", systemImage: "pencil")
                }
                if model.snapshot.projects.count > 1 {
                    Button {
                        copyAction(node)
                    } label: {
                        Label("Copy to Project", systemImage: "doc.on.doc")
                    }
                }
            }

            if expanded {
                ForEach(node.children) { child in
                    VectorCodeFileRow(
                        model: model,
                        node: child,
                        depth: depth + 1,
                        collapsedFolderPaths: $collapsedFolderPaths,
                        renameAction: renameAction,
                        copyAction: copyAction
                    )
                }
            }
        }
    }

    private func toggleFolder() {
        if expanded {
            if node.childrenTruncated {
                model.loadFolderChildren(node)
                return
            }
            collapsedFolderPaths.insert(node.path)
            return
        }

        collapsedFolderPaths.remove(node.path)
        if node.childrenTruncated {
            model.loadFolderChildren(node)
        }
    }

    private var icon: VectorCodeIcon {
        switch node.kind {
        case .folder:
            return expanded ? .folderOpened : .folder
        case .file:
            return .file
        }
    }
}

private struct VectorCodeCopyFileSheet: View {
    @ObservedObject var model: VectorCodeMobileWorkspaceModel
    let file: VectorCodeProjectFileAction
    @Binding var destinationPath: String
    @State private var allowsOverwrite = false
    @Environment(\.dismiss) private var dismiss

    private var node: VectorCodeFileNode {
        file.node
    }

    private var destinationProjects: [VectorCodeProjectSummary] {
        model.snapshot.projects.filter { $0.id != file.project.id }
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                VectorCodeSectionSurface {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(node.name)
                            .font(.headline.weight(.semibold))
                        Text(node.path)
                            .font(.caption.monospaced())
                            .foregroundStyle(VectorCodeTheme.muted)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Destination path")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(VectorCodeTheme.muted)
                    TextField("path/in/project", text: $destinationPath)
                        .textFieldStyle(VectorCodeOutlinedTextFieldStyle())
                }

                Toggle(isOn: $allowsOverwrite) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Allow overwrite")
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(VectorCodeTheme.text)
                        Text("Only replace an existing desktop file when this is on.")
                            .font(.caption)
                            .foregroundStyle(VectorCodeTheme.muted)
                    }
                }
                .toggleStyle(.switch)
                .padding(12)
                .vectorCodeOutlinedSurface(background: VectorCodeTheme.raised, cornerRadius: VectorCodeTheme.compactRadius)

                Text("Copy applies immediately on the paired desktop.")
                    .font(.caption)
                    .foregroundStyle(VectorCodeTheme.subtle)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Copy to")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(VectorCodeTheme.muted)
                    ForEach(destinationProjects) { project in
                        Button {
                            model.copyFile(file.node, from: file.project, to: project, destinationPath: destinationPath, overwrite: allowsOverwrite)
                            dismiss()
                        } label: {
                            VectorCodeSectionSurface(contentPadding: 12) {
                                HStack(spacing: 10) {
                                    VectorCodeProjectIdentity(
                                        project: project,
                                        dotSize: 6,
                                        titleFont: .callout.weight(.semibold),
                                        pathFont: .caption
                                    )
                                    Spacer()
                                    VectorCodeIconView(icon: .copy, size: 14)
                                        .foregroundStyle(VectorCodeTheme.subtle)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer()
            }
            .padding(16)
            .background(VectorCodeTheme.background.ignoresSafeArea())
            .foregroundStyle(VectorCodeTheme.text)
            .navigationTitle(node.kind == .folder ? "Copy folder" : "Copy file")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }
}
