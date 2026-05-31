import Combine
import Foundation

@MainActor
public final class VectorCodeMobileWorkspaceModel: ObservableObject {
    private static let fileModifiedSinceErrorCode = "file_modified_since"

    public enum Viewport: String, CaseIterable, Identifiable {
        case projects = "Projects"
        case files = "Files"
        case editor = "Editor"
        case terminal = "Terminal"

        public var id: String { rawValue }
    }

    @Published public private(set) var pairingPayload: VectorCodePairingPayload?
    @Published public private(set) var relayConfiguration: VectorCodeRelayConfiguration?
    @Published public var snapshot: VectorCodeRemoteWorkspaceSnapshot
    @Published public var viewport: Viewport
    @Published public var selectedProjectId: String?
    @Published public var selectedEditorId: String?
    @Published public var selectedTerminalId: String?
    @Published public var editorDraft: String
    @Published public var statusText: String
    @Published private var editorConflictsByKey: [String: VectorCodeEditorConflict]
    @Published public private(set) var isRemoteConnected: Bool

    private let remoteWorkspaceClient: VectorCodeRemoteWorkspaceClient
    private let pairingStore: VectorCodePairingStore
    private var remoteSyncTask: Task<Void, Never>?
    private var editorSelections = VectorCodeProjectScopedSelectionStore()
    private var terminalSelections = VectorCodeProjectScopedSelectionStore()
    private var pendingRemoteFileOpenByProject: [String: String] = [:]

    public init(
        snapshot: VectorCodeRemoteWorkspaceSnapshot = .empty,
        viewport: Viewport = .projects,
        remoteWorkspaceClient: VectorCodeRemoteWorkspaceClient = VectorCodeRemoteWorkspaceClient()
    ) {
        let pairingStore = VectorCodePairingStore()
        let storedPairing = snapshot.projects.isEmpty ? pairingStore.load() : nil
        let storedConfiguration = storedPairing.flatMap { try? VectorCodeRelayConfiguration(pairingPayload: $0.payload, phoneId: $0.phoneId) }
        let initialProjectId = snapshot.activeProjectId ?? snapshot.projects.first?.id
        self.remoteWorkspaceClient = remoteWorkspaceClient
        self.pairingStore = pairingStore
        self.snapshot = snapshot
        self.viewport = viewport
        self.selectedProjectId = initialProjectId
        self.selectedEditorId = snapshot.editorsByProject[initialProjectId ?? ""]?.first?.id
        self.selectedTerminalId = snapshot.terminalsByProject[initialProjectId ?? ""]?.first?.id
        self.editorDraft = snapshot.editorsByProject[initialProjectId ?? ""]?.first?.content ?? ""
        self.statusText = storedConfiguration == nil ? "Not paired" : "Ready to connect"
        self.editorConflictsByKey = [:]
        self.isRemoteConnected = false
        if let storedPairing, let storedConfiguration {
            self.pairingPayload = storedPairing.payload
            self.relayConfiguration = storedConfiguration
        }
        editorSelections.remember(projectId: initialProjectId, selectedId: selectedEditorId)
        terminalSelections.remember(projectId: initialProjectId, selectedId: selectedTerminalId)
    }

    public var selectedProject: VectorCodeProjectSummary? {
        guard let selectedProjectId else {
            return snapshot.projects.first
        }
        return snapshot.projects.first { $0.id == selectedProjectId } ?? snapshot.projects.first
    }

    public var selectedFiles: [VectorCodeFileNode] {
        guard let projectId = selectedProject?.id else {
            return []
        }
        return snapshot.filesByProject[projectId] ?? []
    }

    public var selectedFilesTruncated: Bool {
        guard let projectId = selectedProject?.id else {
            return false
        }
        return snapshot.fileTreeTruncatedByProject[projectId] ?? false
    }

    public var selectedEditors: [VectorCodeEditorTab] {
        guard let projectId = selectedProject?.id else {
            return []
        }
        return snapshot.editorsByProject[projectId] ?? []
    }

    public var selectedTerminals: [VectorCodeTerminalTab] {
        guard let projectId = selectedProject?.id else {
            return []
        }
        return snapshot.terminalsByProject[projectId] ?? []
    }

    public var selectedEditor: VectorCodeEditorTab? {
        selectedEditors.first { $0.id == selectedEditorId } ?? selectedEditors.first
    }

    public var selectedEditorConflict: VectorCodeEditorConflict? {
        guard let selectedEditor else {
            return nil
        }
        return editorConflictsByKey[Self.editorConflictKey(projectId: selectedEditor.projectId, editorId: selectedEditor.id)]
    }

    public var pendingEditorConflict: VectorCodeEditorConflict? {
        selectedEditorConflict ?? editorConflictsByKey.values.sorted { $0.id < $1.id }.first
    }

    public var selectedTerminal: VectorCodeTerminalTab? {
        selectedTerminals.first { $0.id == selectedTerminalId } ?? selectedTerminals.first
    }

    public func pair(from json: String, phoneId: String = UUID().uuidString) throws {
        let payload = try VectorCodePairingPayload.decode(from: json)
        let configuration = try VectorCodeRelayConfiguration(pairingPayload: payload, phoneId: phoneId)
        pairingPayload = payload
        relayConfiguration = configuration
        pairingStore.save(payload: payload, phoneId: phoneId)
        isRemoteConnected = false
        statusText = "Ready to connect"
    }

    public func connectToDesktopIfPaired() {
        guard relayConfiguration != nil, !isRemoteConnected else {
            return
        }
        connectToDesktop()
    }

    public func connectToDesktop() {
        guard let relayConfiguration else {
            statusText = "Not paired"
            return
        }

        remoteSyncTask?.cancel()
        remoteSyncTask = Task { [weak self] in
            await self?.loadRemoteWorkspace(configuration: relayConfiguration)
        }
    }

    public func refreshWorkspace() {
        guard isRemoteConnected else {
            connectToDesktopIfPaired()
            return
        }

        statusText = "Refreshing workspace"
        Task { [weak self] in
            await self?.refreshRemoteWorkspace()
        }
    }

    public func clearPairing() {
        remoteSyncTask?.cancel()
        remoteSyncTask = nil
        Task { [remoteWorkspaceClient] in
            await remoteWorkspaceClient.disconnect()
        }
        pairingStore.clear()
        pairingPayload = nil
        relayConfiguration = nil
        isRemoteConnected = false
        snapshot = .empty
        selectedProjectId = nil
        selectedEditorId = nil
        selectedTerminalId = nil
        editorDraft = ""
        editorConflictsByKey.removeAll()
        pendingRemoteFileOpenByProject.removeAll()
        editorSelections.clear()
        terminalSelections.clear()
        viewport = .projects
        statusText = "Not paired"
    }

    public func switchProject(_ project: VectorCodeProjectSummary) {
        rememberCurrentProjectSelection()
        let previousViewport = viewport
        selectedProjectId = project.id
        selectedEditorId = restoredEditorId(for: project.id)
        selectedTerminalId = restoredTerminalId(for: project.id)
        editorSelections.remember(projectId: project.id, selectedId: selectedEditorId)
        terminalSelections.remember(projectId: project.id, selectedId: selectedTerminalId)
        editorDraft = selectedEditorDraftContent(projectId: project.id, editorId: selectedEditorId)
        if previousViewport == .projects {
            viewport = .files
        }
        if isRemoteConnected {
            statusText = "Connected"
        }
        if isRemoteConnected, snapshot.filesByProject[project.id]?.isEmpty != false {
            Task { [weak self] in
                await self?.loadRemoteFolderChildren(projectId: project.id, path: "")
            }
        }
    }

    public func openFile(_ node: VectorCodeFileNode) {
        guard node.kind == .file, let project = selectedProject else {
            return
        }

        if selectProtectedLocalEditorIfNeeded(projectId: project.id, path: node.path) {
            return
        }

        if isRemoteConnected {
            pendingRemoteFileOpenByProject[project.id] = node.path
            statusText = "Opening \(node.name)"
            Task { [weak self] in
                await self?.openRemoteFile(node, project: project)
            }
            return
        }

        openLocalFile(node, project: project)
    }

    public func loadFolderChildren(_ node: VectorCodeFileNode) {
        guard node.kind == .folder, let project = selectedProject, isRemoteConnected else {
            return
        }

        statusText = "Loading \(node.name)"
        Task { [weak self] in
            await self?.loadRemoteFolderChildren(projectId: project.id, path: node.path)
        }
    }

    public func saveEditor() {
        guard let projectId = selectedProject?.id, let editor = selectedEditor else {
            return
        }
        guard selectedEditorConflict == nil else {
            statusText = "Resolve file conflict"
            return
        }
        let content = editorDraft

        if isRemoteConnected {
            statusText = "Saving \(editor.title)"
            Task { [weak self] in
                await self?.saveRemoteEditor(editor, projectId: projectId, content: content)
            }
            return
        }

        updateEditor(projectId: projectId, editorId: editor.id, content: content, isDirty: false)
        clearEditorConflictIfMatching(projectId: projectId, editorId: editor.id)
        statusText = "Saved locally"
    }

    public func renameFile(_ node: VectorCodeFileNode, to newName: String) {
        guard let project = selectedProject else {
            return
        }
        renameFile(node, in: project, to: newName)
    }

    public func renameFile(_ node: VectorCodeFileNode, in project: VectorCodeProjectSummary, to newName: String) {
        let trimmedName = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, !trimmedName.contains("/") else {
            statusText = "Rename needs a file name"
            return
        }

        let targetPath = Self.renamedPath(for: node.path, newName: trimmedName)
        guard targetPath != node.path else {
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        statusText = "Renaming \(node.name)"
        Task { [weak self] in
            await self?.moveRemoteFile(projectId: project.id, path: node.path, targetPath: targetPath)
        }
    }

    public func copyFile(_ node: VectorCodeFileNode, to destinationProject: VectorCodeProjectSummary, destinationPath: String, overwrite: Bool = false) {
        guard let sourceProject = selectedProject else {
            return
        }
        copyFile(node, from: sourceProject, to: destinationProject, destinationPath: destinationPath, overwrite: overwrite)
    }

    public func copyFile(
        _ node: VectorCodeFileNode,
        from sourceProject: VectorCodeProjectSummary,
        to destinationProject: VectorCodeProjectSummary,
        destinationPath: String,
        overwrite: Bool = false
    ) {
        let trimmedPath = destinationPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty else {
            statusText = "Copy needs a destination"
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        statusText = "Copying \(node.name)"
        Task { [weak self] in
            await self?.copyRemoteFile(
                sourceProjectId: sourceProject.id,
                path: node.path,
                targetProjectId: destinationProject.id,
                targetPath: trimmedPath,
                overwrite: overwrite
            )
        }
    }

    public func createTerminal() {
        guard let project = selectedProject else {
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        statusText = "Creating terminal"
        Task { [weak self] in
            await self?.createRemoteTerminal(project: project)
        }
    }

    public func sendTerminalInput(_ input: String, submit: Bool) {
        guard !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let projectId = selectedProject?.id, let terminalId = selectedTerminal?.id else {
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        Task { [weak self] in
            await self?.sendRemoteTerminalInput(projectId: projectId, terminalId: terminalId, input: input, submit: submit, mode: submit ? .command : .paste)
        }
    }

    public func selectEditor(_ editor: VectorCodeEditorTab) {
        let currentEditor = snapshot.editorsByProject[editor.projectId]?.first { $0.id == editor.id } ?? editor
        selectedProjectId = currentEditor.projectId
        selectedEditorId = currentEditor.id
        editorSelections.remember(projectId: currentEditor.projectId, selectedId: currentEditor.id)
        if let conflict = editorConflictsByKey[Self.editorConflictKey(projectId: currentEditor.projectId, editorId: currentEditor.id)] {
            editorDraft = conflict.localContent
            statusText = "Resolve file conflict"
        } else {
            editorDraft = currentEditor.content ?? ""
            if isRemoteConnected {
                statusText = "Connected"
            }
        }
        viewport = .editor
    }

    public func closeEditor(_ editor: VectorCodeEditorTab) {
        guard let index = snapshot.editorsByProject[editor.projectId]?.firstIndex(where: { $0.id == editor.id }) else {
            return
        }

        snapshot.editorsByProject[editor.projectId]?.remove(at: index)
        let remainingEditors = snapshot.editorsByProject[editor.projectId] ?? []
        let closeSelection = editorSelections.close(
            projectId: editor.projectId,
            removedId: editor.id,
            removedIndex: index,
            remainingIds: remainingEditors.map(\.id),
            currentProjectId: selectedProjectId,
            currentSelectedId: selectedEditorId
        )
        let nextEditor = closeSelection.nextId.flatMap { nextId in remainingEditors.first { $0.id == nextId } }
        if closeSelection.closedCurrentSelection {
            selectedEditorId = nextEditor?.id
            editorDraft = selectedEditorDraftContent(projectId: editor.projectId, editorId: nextEditor?.id)
        }

        if selectedProjectId == editor.projectId && selectedEditorId == nil {
            editorDraft = ""
        }
        clearEditorConflictIfMatching(projectId: editor.projectId, editorId: editor.id)
    }

    private func openLocalFile(_ node: VectorCodeFileNode, project: VectorCodeProjectSummary, content: String? = nil, language: String? = nil, version: String? = nil) {
        let existingEditor = snapshot.editorsByProject[project.id]?.first { $0.path == node.path }
        if let existingEditor {
            selectedEditorId = existingEditor.id
            editorSelections.remember(projectId: project.id, selectedId: existingEditor.id)
            if let content {
                updateEditor(
                    projectId: project.id,
                    editorId: existingEditor.id,
                    content: content,
                    language: language ?? existingEditor.language,
                    isDirty: false,
                    version: version ?? existingEditor.version
                )
                editorDraft = content
            } else {
                editorDraft = existingEditor.content ?? ""
            }
        } else {
            let content = content ?? ""
            let editor = VectorCodeEditorTab(
                id: "\(project.id):\(node.path)",
                projectId: project.id,
                path: node.path,
                title: node.name,
                language: language ?? VectorCodeLanguageInference.language(for: node.path),
                content: content,
                version: version
            )
            snapshot.editorsByProject[project.id, default: []].append(editor)
            selectedEditorId = editor.id
            editorSelections.remember(projectId: project.id, selectedId: editor.id)
            editorDraft = content
        }
        viewport = .editor
    }

    public func dismissEditorConflict() {
        if let conflict = selectedEditorConflict {
            clearEditorConflictIfMatching(projectId: conflict.projectId, editorId: conflict.editorId)
        }
        statusText = "Resolve before saving"
    }

    public func keepDesktopEditorConflict() {
        guard let conflict = selectedEditorConflict else {
            return
        }
        updateEditor(
            projectId: conflict.projectId,
            editorId: conflict.editorId,
            content: conflict.desktopContent,
            isDirty: false,
            version: conflict.desktopVersion
        )
        setEditorDraftIfSelected(projectId: conflict.projectId, editorId: conflict.editorId, content: conflict.desktopContent)
        clearEditorConflictIfMatching(projectId: conflict.projectId, editorId: conflict.editorId)
        statusText = "Desktop version kept"
    }

    public func overwriteEditorConflict() {
        guard let conflict = selectedEditorConflict else {
            return
        }
        let content = editorDraft
        statusText = "Overwriting desktop"
        Task { [weak self] in
            await self?.overwriteRemoteEditorConflict(conflict, content: content)
        }
    }

    public func markEditorDirty() {
        guard let projectId = selectedProject?.id, let editorId = selectedEditorId else {
            return
        }
        guard let index = snapshot.editorsByProject[projectId]?.firstIndex(where: { $0.id == editorId }) else {
            return
        }
        snapshot.editorsByProject[projectId]?[index].isDirty = true
        snapshot.editorsByProject[projectId]?[index].content = editorDraft
        updateEditorConflictLocalContent(projectId: projectId, editorId: editorId, content: editorDraft)
    }

    public func selectTerminal(_ terminal: VectorCodeTerminalTab) {
        selectedProjectId = terminal.projectId
        selectedTerminalId = terminal.id
        terminalSelections.remember(projectId: terminal.projectId, selectedId: terminal.id)
        if let indices = snapshot.terminalsByProject[terminal.projectId]?.indices {
            for index in indices {
                snapshot.terminalsByProject[terminal.projectId]?[index].isActive = snapshot.terminalsByProject[terminal.projectId]?[index].id == terminal.id
            }
        }
        if isRemoteConnected {
            statusText = "Connected"
        }
        viewport = .terminal
    }

    public func renameTerminal(_ terminal: VectorCodeTerminalTab, title: String) {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            return
        }
        guard hasTerminal(terminal) else {
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        updateTerminal(terminal, title: trimmedTitle)
        statusText = "Renaming terminal"
        Task { [weak self] in
            await self?.controlRemoteTerminal(terminal, command: .rename, title: trimmedTitle)
        }
    }

    public func updateTerminalHostTitle(_ terminal: VectorCodeTerminalTab, title: String) {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty, trimmedTitle != terminal.title else {
            return
        }
        updateTerminal(terminal, title: trimmedTitle)
    }

    public func closeTerminal(_ terminal: VectorCodeTerminalTab) {
        guard hasTerminal(terminal) else {
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        removeLocalTerminal(terminal)
        statusText = "Closing terminal"

        Task { [weak self] in
            await self?.controlRemoteTerminal(terminal, command: .close)
        }
    }

    public func clearTerminal(_ terminal: VectorCodeTerminalTab) {
        guard hasTerminal(terminal) else {
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        replaceTerminalOutput(projectId: terminal.projectId, terminalId: terminal.id, output: [])
        statusText = "Clearing terminal"
        Task { [weak self] in
            await self?.controlRemoteTerminal(terminal, command: .clear)
        }
    }

    public func interruptTerminal(_ terminal: VectorCodeTerminalTab) {
        guard hasTerminal(terminal) else {
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        appendTerminalLine(projectId: terminal.projectId, terminalId: terminal.id, line: "^C")
        statusText = "Interrupting terminal"
        Task { [weak self] in
            await self?.controlRemoteTerminal(terminal, command: .interrupt)
        }
    }

    public func sendTerminalData(_ data: String, terminal: VectorCodeTerminalTab? = nil) {
        let projectId = terminal?.projectId ?? selectedProject?.id
        let terminalId = terminal?.id ?? selectedTerminal?.id
        guard !data.isEmpty, let projectId, let terminalId else {
            return
        }
        guard hasTerminal(projectId: projectId, terminalId: terminalId) else {
            return
        }

        guard requireRemoteConnection() else {
            return
        }

        Task { [weak self] in
            await self?.sendRemoteTerminalInput(
                projectId: projectId,
                terminalId: terminalId,
                input: data,
                submit: false,
                mode: .raw,
                refreshAfterSend: false
            )
        }
    }

    public func resizeTerminal(_ terminal: VectorCodeTerminalTab, cols: Int, rows: Int) {
        guard requireRemoteConnection(), cols > 0, rows > 0, hasTerminal(terminal) else {
            return
        }

        Task { [weak self] in
            await self?.controlRemoteTerminal(terminal, command: .resize, cols: cols, rows: rows)
        }
    }

    private func updateTerminal(_ terminal: VectorCodeTerminalTab, title: String? = nil, isActive: Bool? = nil) {
        guard let index = snapshot.terminalsByProject[terminal.projectId]?.firstIndex(where: { $0.id == terminal.id }) else {
            return
        }
        if let title {
            snapshot.terminalsByProject[terminal.projectId]?[index].title = title
        }
        if let isActive {
            snapshot.terminalsByProject[terminal.projectId]?[index].isActive = isActive
        }
    }

    private func hasTerminal(_ terminal: VectorCodeTerminalTab) -> Bool {
        hasTerminal(projectId: terminal.projectId, terminalId: terminal.id)
    }

    private func hasTerminal(projectId: String, terminalId: String) -> Bool {
        snapshot.terminalsByProject[projectId]?.contains(where: { $0.id == terminalId }) == true
    }

    private func removeLocalTerminal(_ terminal: VectorCodeTerminalTab) {
        guard let index = snapshot.terminalsByProject[terminal.projectId]?.firstIndex(where: { $0.id == terminal.id }) else {
            return
        }

        snapshot.terminalsByProject[terminal.projectId]?.remove(at: index)
        let remainingTerminals = snapshot.terminalsByProject[terminal.projectId] ?? []
        let closeSelection = terminalSelections.close(
            projectId: terminal.projectId,
            removedId: terminal.id,
            removedIndex: index,
            remainingIds: remainingTerminals.map(\.id),
            currentProjectId: selectedProjectId,
            currentSelectedId: selectedTerminalId
        )
        let nextTerminal = closeSelection.nextId.flatMap { nextId in remainingTerminals.first { $0.id == nextId } }
        if closeSelection.closedCurrentSelection {
            selectedTerminalId = nextTerminal?.id
        }

        if closeSelection.closedCurrentSelection, let nextTerminal {
            selectTerminal(nextTerminal)
        }
    }

    private func updateEditor(projectId: String, editorId: String, content: String? = nil, language: String? = nil, isDirty: Bool? = nil, version: String? = nil) {
        guard let index = snapshot.editorsByProject[projectId]?.firstIndex(where: { $0.id == editorId }) else {
            return
        }
        if let content {
            snapshot.editorsByProject[projectId]?[index].content = content
        }
        if let language {
            snapshot.editorsByProject[projectId]?[index].language = language
        }
        if let isDirty {
            snapshot.editorsByProject[projectId]?[index].isDirty = isDirty
        }
        if let version {
            snapshot.editorsByProject[projectId]?[index].version = version
        }
    }

    private func replaceTerminalOutput(projectId: String, terminalId: String, output: [String], rawOutput: String? = nil) {
        guard let index = snapshot.terminalsByProject[projectId]?.firstIndex(where: { $0.id == terminalId }) else {
            return
        }
        snapshot.terminalsByProject[projectId]?[index].output = output
        snapshot.terminalsByProject[projectId]?[index].rawOutput = rawOutput
    }

    private func appendTerminalLine(projectId: String, terminalId: String, line: String) {
        guard let index = snapshot.terminalsByProject[projectId]?.firstIndex(where: { $0.id == terminalId }) else {
            return
        }
        snapshot.terminalsByProject[projectId]?[index].output.append(line)
        guard let rawOutput = snapshot.terminalsByProject[projectId]?[index].rawOutput else {
            return
        }
        snapshot.terminalsByProject[projectId]?[index].rawOutput = rawOutput.isEmpty ? line : "\(rawOutput)\r\n\(line)"
    }

    private func replaceFolderChildren(projectId: String, path: String, children: [VectorCodeFileNode], truncated: Bool) {
        if path.isEmpty {
            snapshot.filesByProject[projectId] = children
            snapshot.fileTreeTruncatedByProject[projectId] = truncated
            return
        }

        guard var roots = snapshot.filesByProject[projectId] else {
            return
        }
        guard Self.replaceFolderChildren(in: &roots, path: path, children: children, truncated: truncated) else {
            return
        }
        snapshot.filesByProject[projectId] = roots
    }

    private static func replaceFolderChildren(in nodes: inout [VectorCodeFileNode], path: String, children: [VectorCodeFileNode], truncated: Bool) -> Bool {
        for index in nodes.indices {
            if nodes[index].path == path {
                nodes[index].children = children
                nodes[index].childrenTruncated = truncated
                return true
            }
            if replaceFolderChildren(in: &nodes[index].children, path: path, children: children, truncated: truncated) {
                return true
            }
        }
        return false
    }

    private static func renamedPath(for path: String, newName: String) -> String {
        guard let slashIndex = path.lastIndex(of: "/") else {
            return newName
        }
        return "\(path[..<path.index(after: slashIndex)])\(newName)"
    }

    private static func parentFolderPath(for path: String) -> String {
        let normalizedPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let slashIndex = normalizedPath.lastIndex(of: "/") else {
            return ""
        }
        return String(normalizedPath[..<slashIndex])
    }

    private static func ancestorFolderPaths(for path: String) -> [String] {
        let parentPath = parentFolderPath(for: path)
        guard !parentPath.isEmpty else {
            return []
        }

        let parts = parentPath.split(separator: "/").map(String.init)
        return parts.indices.map { index in
            parts[...index].joined(separator: "/")
        }
    }

    private func loadRemoteWorkspace(configuration: VectorCodeRelayConfiguration) async {
        statusText = "Connecting to desktop"
        do {
            try await remoteWorkspaceClient.connect(configuration: configuration)
            statusText = "Syncing workspace"
            let nextSnapshot = try await runTimedRemoteOperation { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readState()
            }
            applySnapshot(nextSnapshot)
            isRemoteConnected = true
            statusText = "Connected"
        } catch is CancellationError {
            await disconnectRemoteWorkspace(statusText: "Ready to connect")
        } catch {
            await disconnectRemoteWorkspace(statusText: "Paired. Desktop not ready.")
        }
    }

    private func applySnapshot(_ nextSnapshot: VectorCodeRemoteWorkspaceSnapshot) {
        rememberCurrentProjectSelection()
        let currentProjectId = selectedProjectId
        let dirtyEditors = dirtyEditorDrafts()
        let mergedSnapshot = Self.mergeProjectScopedSnapshot(current: snapshot, next: nextSnapshot)
        snapshot = mergedSnapshot
        restoreDirtyEditors(dirtyEditors)
        let nextProjectId: String?
        if let currentProjectId, mergedSnapshot.projects.contains(where: { $0.id == currentProjectId }) {
            nextProjectId = currentProjectId
        } else {
            nextProjectId = mergedSnapshot.activeProjectId ?? mergedSnapshot.projects.first?.id
        }
        selectedProjectId = nextProjectId
        selectedEditorId = nextProjectId.flatMap { restoredEditorId(for: $0) }
        selectedTerminalId = nextProjectId.flatMap { restoredTerminalId(for: $0) }
        editorSelections.remember(projectId: nextProjectId, selectedId: selectedEditorId)
        terminalSelections.remember(projectId: nextProjectId, selectedId: selectedTerminalId)
        editorDraft = selectedEditorDraftContent(projectId: nextProjectId, editorId: selectedEditorId)
        if nextProjectId == nil {
            viewport = .projects
        } else if viewport == .projects {
            viewport = .files
        }
    }

    private static func mergeProjectScopedSnapshot(
        current: VectorCodeRemoteWorkspaceSnapshot,
        next: VectorCodeRemoteWorkspaceSnapshot
    ) -> VectorCodeRemoteWorkspaceSnapshot {
        var merged = next
        let projectIds = Set(next.projects.map(\.id))

        merged.filesByProject = mergeProjectMap(current: current.filesByProject, next: next.filesByProject, projectIds: projectIds)
        merged.fileTreeTruncatedByProject = mergeProjectMap(current: current.fileTreeTruncatedByProject, next: next.fileTreeTruncatedByProject, projectIds: projectIds)
        merged.editorsByProject = mergeProjectMap(current: current.editorsByProject, next: next.editorsByProject, projectIds: projectIds)
        merged.terminalsByProject = mergeProjectMap(current: current.terminalsByProject, next: next.terminalsByProject, projectIds: projectIds) { _, currentTerminals, nextTerminals in
            mergeTerminalTabs(current: currentTerminals ?? [], next: nextTerminals)
        }

        return merged
    }

    private static func mergeProjectMap<Value>(
        current: [String: Value],
        next: [String: Value],
        projectIds: Set<String>,
        mergeValue: (_ projectId: String, _ currentValue: Value?, _ nextValue: Value) -> Value = { _, _, nextValue in nextValue }
    ) -> [String: Value] {
        var merged = current.filter { projectIds.contains($0.key) }
        for (projectId, nextValue) in next where projectIds.contains(projectId) {
            merged[projectId] = mergeValue(projectId, current[projectId], nextValue)
        }
        return merged
    }

    private static func mergeTerminalTabs(current: [VectorCodeTerminalTab], next: [VectorCodeTerminalTab]) -> [VectorCodeTerminalTab] {
        var currentById: [String: VectorCodeTerminalTab] = [:]
        for terminal in current {
            currentById[terminal.id] = terminal
        }

        return next.map { terminal in
            guard terminal.rawOutput == nil,
                  let previous = currentById[terminal.id],
                  previous.output == terminal.output,
                  let previousRawOutput = previous.rawOutput else {
                return terminal
            }

            var merged = terminal
            merged.rawOutput = previousRawOutput
            return merged
        }
    }

    private func dirtyEditorDrafts() -> [VectorCodeDirtyEditorDraft] {
        let selectedDirtyEditor = selectedEditor?.isDirty == true ? selectedEditor : nil
        return snapshot.editorsByProject.values.flatMap { editors in
            editors.compactMap { editor in
                guard editor.isDirty else {
                    return nil
                }
                return VectorCodeDirtyEditorDraft(
                    editor: editor,
                    content: Self.isSameEditor(editor, selectedDirtyEditor) ? editorDraft : editor.content ?? ""
                )
            }
        }
    }

    private static func isSameEditor(_ editor: VectorCodeEditorTab, _ other: VectorCodeEditorTab?) -> Bool {
        editor.projectId == other?.projectId && editor.id == other?.id
    }

    private static func editorConflictKey(projectId: String, editorId: String) -> String {
        "\(projectId):\(editorId)"
    }

    private func isSelectedEditor(projectId: String, editorId: String) -> Bool {
        selectedProjectId == projectId && selectedEditorId == editorId
    }

    private func setEditorDraftIfSelected(projectId: String, editorId: String, content: String) {
        guard isSelectedEditor(projectId: projectId, editorId: editorId) else {
            return
        }
        editorDraft = content
    }

    private func selectedEditorDraftContent(projectId: String?, editorId: String?) -> String {
        guard let projectId, let editorId else {
            return ""
        }
        if let conflict = editorConflictsByKey[Self.editorConflictKey(projectId: projectId, editorId: editorId)] {
            return conflict.localContent
        }
        return snapshot.editorsByProject[projectId]?.first { $0.id == editorId }?.content ?? ""
    }

    private func editor(projectId: String, editorId: String) -> VectorCodeEditorTab? {
        snapshot.editorsByProject[projectId]?.first { $0.id == editorId }
    }

    private func editor(projectId: String, path: String) -> VectorCodeEditorTab? {
        snapshot.editorsByProject[projectId]?.first { $0.path == path }
    }

    private func editorConflict(projectId: String, path: String) -> VectorCodeEditorConflict? {
        editorConflictsByKey.values.first { $0.projectId == projectId && $0.path == path }
    }

    private func selectProtectedLocalEditorIfNeeded(projectId: String, path: String) -> Bool {
        if let conflict = editorConflict(projectId: projectId, path: path),
           let conflictedEditor = editor(projectId: projectId, editorId: conflict.editorId) {
            selectEditor(conflictedEditor)
            statusText = "Resolve file conflict"
            return true
        }

        guard let existingEditor = editor(projectId: projectId, path: path), existingEditor.isDirty else {
            return false
        }
        selectEditor(existingEditor)
        statusText = "Unsaved draft open"
        return true
    }

    private func updateEditorConflictLocalContent(projectId: String, editorId: String, content: String) {
        let key = Self.editorConflictKey(projectId: projectId, editorId: editorId)
        guard var conflict = editorConflictsByKey[key] else {
            return
        }
        conflict.localContent = content
        editorConflictsByKey[key] = conflict
    }

    private func clearEditorConflictIfMatching(projectId: String, editorId: String) {
        editorConflictsByKey.removeValue(forKey: Self.editorConflictKey(projectId: projectId, editorId: editorId))
    }

    private func restoreDirtyEditors(_ dirtyEditors: [VectorCodeDirtyEditorDraft]) {
        let projectIds = Set(snapshot.projects.map(\.id))
        for dirtyEditor in dirtyEditors where projectIds.contains(dirtyEditor.editor.projectId) {
            restoreDirtyEditor(dirtyEditor)
        }
    }

    private func restoreDirtyEditor(_ dirtyEditor: VectorCodeDirtyEditorDraft) {
        var restoredEditor = dirtyEditor.editor
        restoredEditor.content = dirtyEditor.content
        restoredEditor.isDirty = true

        guard let editors = snapshot.editorsByProject[restoredEditor.projectId] else {
            snapshot.editorsByProject[restoredEditor.projectId] = [restoredEditor]
            return
        }
        guard let index = editors.firstIndex(where: { $0.id == restoredEditor.id || $0.path == restoredEditor.path }) else {
            snapshot.editorsByProject[restoredEditor.projectId, default: []].append(restoredEditor)
            return
        }

        snapshot.editorsByProject[restoredEditor.projectId]?[index] = restoredEditor
    }

    private func runRemoteOperation<Value: Sendable>(
        failureStatus: String,
        operation: @escaping @Sendable () async throws -> Value,
        onSuccess: (Value) async throws -> Void
    ) async {
        do {
            let value = try await runTimedRemoteOperation(operation)
            try await onSuccess(value)
        } catch {
            await handleRemoteFailure(error, statusText: failureStatus)
        }
    }

    private func runTimedRemoteOperation<Value: Sendable>(
        _ operation: @escaping @Sendable () async throws -> Value
    ) async throws -> Value {
        try await Self.withTimeout(seconds: 8, operation: operation)
    }

    private func openRemoteFile(_ node: VectorCodeFileNode, project: VectorCodeProjectSummary) async {
        do {
            let response = try await runTimedRemoteOperation { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readFile(projectId: project.id, path: node.path)
            }
            guard pendingRemoteFileOpenByProject[project.id] == node.path else {
                return
            }
            pendingRemoteFileOpenByProject.removeValue(forKey: project.id)
            guard selectedProjectId == project.id else {
                return
            }
            guard !selectProtectedLocalEditorIfNeeded(projectId: project.id, path: node.path) else {
                return
            }
            openLocalFile(node, project: project, content: response.content, language: response.language, version: response.version)
            statusText = "Connected"
        } catch {
            let wasPendingOpen = pendingRemoteFileOpenByProject[project.id] == node.path
            if wasPendingOpen {
                pendingRemoteFileOpenByProject.removeValue(forKey: project.id)
            }
            await handleScopedRemoteFailure(
                error,
                statusText: "File unavailable",
                isVisible: wasPendingOpen && selectedProjectId == project.id
            )
        }
    }

    private func saveRemoteEditor(_ editor: VectorCodeEditorTab, projectId: String, content: String) async {
        do {
            let response = try await runTimedRemoteOperation { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.writeFile(projectId: projectId, path: editor.path, content: content, expectedVersion: editor.version)
            }
            updateEditor(projectId: projectId, editorId: editor.id, content: content, isDirty: false, version: response.version)
            clearEditorConflictIfMatching(projectId: projectId, editorId: editor.id)
            if isSelectedEditor(projectId: projectId, editorId: editor.id) {
                statusText = "Saved"
            }
        } catch {
            if Self.isFileModifiedSinceError(error) {
                await prepareEditorConflict(editor, projectId: projectId, localContent: content)
                return
            }
            await handleScopedRemoteFailure(
                error,
                statusText: "Save failed",
                isVisible: isSelectedEditor(projectId: projectId, editorId: editor.id)
            )
        }
    }

    private func overwriteRemoteEditorConflict(_ conflict: VectorCodeEditorConflict, content: String) async {
        do {
            let response = try await runTimedRemoteOperation { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.writeFile(projectId: conflict.projectId, path: conflict.path, content: content, expectedVersion: conflict.desktopVersion)
            }
            updateEditor(projectId: conflict.projectId, editorId: conflict.editorId, content: content, isDirty: false, version: response.version)
            setEditorDraftIfSelected(projectId: conflict.projectId, editorId: conflict.editorId, content: content)
            clearEditorConflictIfMatching(projectId: conflict.projectId, editorId: conflict.editorId)
            if isSelectedEditor(projectId: conflict.projectId, editorId: conflict.editorId) {
                statusText = "Saved"
            }
        } catch {
            if Self.isFileModifiedSinceError(error) {
                await prepareEditorConflict(conflict, localContent: content)
                return
            }
            await handleScopedRemoteFailure(
                error,
                statusText: "Save failed",
                isVisible: isSelectedEditor(projectId: conflict.projectId, editorId: conflict.editorId)
            )
        }
    }

    private func prepareEditorConflict(_ editor: VectorCodeEditorTab, projectId: String, localContent: String) async {
        await prepareEditorConflict(
            projectId: projectId,
            editorId: editor.id,
            path: editor.path,
            title: editor.title,
            localContent: localContent
        )
    }

    private func prepareEditorConflict(_ conflict: VectorCodeEditorConflict, localContent: String) async {
        await prepareEditorConflict(
            projectId: conflict.projectId,
            editorId: conflict.editorId,
            path: conflict.path,
            title: conflict.title,
            localContent: localContent
        )
    }

    private func prepareEditorConflict(projectId: String, editorId: String, path: String, title: String, localContent: String) async {
        do {
            let latest = try await runTimedRemoteOperation { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readFile(projectId: projectId, path: path)
            }
            updateEditor(projectId: projectId, editorId: editorId, content: localContent, isDirty: true)
            setEditorDraftIfSelected(projectId: projectId, editorId: editorId, content: localContent)
            let conflict = VectorCodeEditorConflict(
                projectId: projectId,
                editorId: editorId,
                path: path,
                title: title,
                localContent: localContent,
                desktopContent: latest.content,
                desktopVersion: latest.version
            )
            editorConflictsByKey[Self.editorConflictKey(projectId: projectId, editorId: editorId)] = conflict
            if isSelectedEditor(projectId: projectId, editorId: editorId) {
                statusText = "File changed on desktop"
            }
        } catch {
            await handleScopedRemoteFailure(
                error,
                statusText: "Save conflict",
                isVisible: isSelectedEditor(projectId: projectId, editorId: editorId)
            )
        }
    }

    private func moveRemoteFile(projectId: String, path: String, targetPath: String) async {
        await runRemoteOperation(failureStatus: "Rename failed") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.moveFile(projectId: projectId, path: path, targetPath: targetPath)
        } onSuccess: { _ in
            await refreshRemoteFileTreeAfterMutation(projectId: projectId, changedPath: targetPath)
            if Self.parentFolderPath(for: path) != Self.parentFolderPath(for: targetPath) {
                await refreshRemoteFileTreeAfterMutation(projectId: projectId, changedPath: path)
            }
            statusText = "Renamed"
        }
    }

    private func copyRemoteFile(sourceProjectId: String, path: String, targetProjectId: String, targetPath: String, overwrite: Bool = false) async {
        await runRemoteOperation(failureStatus: "Copy failed") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.copyFile(projectId: sourceProjectId, path: path, targetProjectId: targetProjectId, targetPath: targetPath, overwrite: overwrite)
        } onSuccess: { response in
            await refreshRemoteFileTreeAfterMutation(projectId: response.targetProjectId, changedPath: response.targetPath)
            statusText = "Copied"
        }
    }

    private func refreshRemoteFileTreeAfterMutation(projectId: String, changedPath: String) async {
        let ancestorPaths = Self.ancestorFolderPaths(for: changedPath)
        if ancestorPaths.isEmpty {
            await refreshRemoteWorkspace(projectId: projectId)
            return
        }

        for path in ancestorPaths {
            await loadRemoteFolderChildren(projectId: projectId, path: path)
        }
    }

    private func loadRemoteFolderChildren(projectId: String, path: String) async {
        await runRemoteOperation(failureStatus: "Folder unavailable") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.readFileTree(projectId: projectId, path: path)
        } onSuccess: { response in
            replaceFolderChildren(projectId: projectId, path: path, children: response.nodes, truncated: response.truncated)
            statusText = "Connected"
        }
    }

    private func createRemoteTerminal(project: VectorCodeProjectSummary) async {
        await runRemoteOperation(failureStatus: "Terminal unavailable") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.createTerminal(projectId: project.id)
        } onSuccess: { terminal in
            snapshot.terminalsByProject[project.id, default: []].removeAll { $0.id == terminal.id }
            snapshot.terminalsByProject[project.id, default: []].append(terminal)
            terminalSelections.remember(projectId: project.id, selectedId: terminal.id)
            if selectedProjectId == project.id {
                selectedTerminalId = terminal.id
                viewport = .terminal
            }
            statusText = "Connected"
        }
    }

    private func sendRemoteTerminalInput(
        projectId: String,
        terminalId: String,
        input: String,
        submit: Bool,
        mode: VectorCodeTerminalInputRequest.Mode,
        refreshAfterSend: Bool = true
    ) async {
        await runRemoteOperation(failureStatus: "Terminal input failed") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.sendTerminalInput(projectId: projectId, terminalId: terminalId, input: input, submit: submit, mode: mode)
        } onSuccess: { _ in
            guard refreshAfterSend else {
                statusText = "Connected"
                return
            }
            try await Task.sleep(nanoseconds: 450_000_000)
            try await readAndReplaceRemoteTerminalOutput(projectId: projectId, terminalId: terminalId)
            statusText = "Connected"
        }
    }

    public func refreshTerminalOutput(projectId: String, terminalId: String) async {
        guard isRemoteConnected, hasTerminal(projectId: projectId, terminalId: terminalId) else {
            return
        }
        await refreshRemoteTerminalOutput(projectId: projectId, terminalId: terminalId, updateStatus: true)
    }

    public func pollTerminalOutput(projectId: String, terminalId: String) async {
        guard isRemoteConnected, hasTerminal(projectId: projectId, terminalId: terminalId) else {
            return
        }
        while !Task.isCancelled {
            guard selectedProjectId == projectId, selectedTerminalId == terminalId, hasTerminal(projectId: projectId, terminalId: terminalId) else {
                return
            }
            await refreshRemoteTerminalOutput(projectId: projectId, terminalId: terminalId, updateStatus: false)
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    private func controlRemoteTerminal(
        _ terminal: VectorCodeTerminalTab,
        command: VectorCodeTerminalControlRequest.Command,
        title: String? = nil,
        cols: Int? = nil,
        rows: Int? = nil
    ) async {
        await runRemoteOperation(failureStatus: "Terminal action failed") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.controlTerminal(
                projectId: terminal.projectId,
                terminalId: terminal.id,
                command: command,
                cols: cols,
                rows: rows,
                title: title
            )
        } onSuccess: { response in
            statusText = response.accepted ? "Connected" : "Terminal action rejected"
        }
    }

    private func refreshRemoteWorkspace(projectId requestedProjectId: String? = nil) async {
        let projectId = requestedProjectId ?? selectedProjectId
        await runRemoteOperation(failureStatus: "Refresh failed") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.readState(projectId: projectId)
        } onSuccess: { snapshot in
            applySnapshot(snapshot)
            statusText = "Connected"
        }
    }

    private func refreshRemoteTerminalOutput(projectId: String, terminalId: String, updateStatus: Bool) async {
        do {
            try await readAndReplaceRemoteTerminalOutput(projectId: projectId, terminalId: terminalId)
            if updateStatus {
                statusText = "Connected"
            }
        } catch {
            if updateStatus || Self.shouldDisconnectAfterRemoteFailure(error) {
                await handleRemoteFailure(error, statusText: "Terminal output failed")
            }
        }
    }

    private func readAndReplaceRemoteTerminalOutput(projectId: String, terminalId: String) async throws {
        let terminalOutput = try await runTimedRemoteOperation { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.readTerminalOutput(projectId: projectId, terminalId: terminalId)
        }
        replaceTerminalOutput(projectId: projectId, terminalId: terminalId, output: terminalOutput.output, rawOutput: terminalOutput.rawOutput)
    }

    private func disconnectRemoteWorkspace(statusText: String) async {
        await remoteWorkspaceClient.disconnect()
        isRemoteConnected = false
        self.statusText = statusText
    }

    private func rememberCurrentProjectSelection() {
        guard let selectedProjectId else {
            return
        }
        editorSelections.remember(projectId: selectedProjectId, selectedId: selectedEditorId)
        terminalSelections.remember(projectId: selectedProjectId, selectedId: selectedTerminalId)
    }

    private func restoredEditorId(for projectId: String) -> String? {
        let editors = snapshot.editorsByProject[projectId] ?? []
        return editorSelections.restoreId(for: projectId, availableIds: editors.map(\.id))
    }

    private func restoredTerminalId(for projectId: String) -> String? {
        let terminals = snapshot.terminalsByProject[projectId] ?? []
        return terminalSelections.restoreId(for: projectId, availableIds: terminals.map(\.id))
    }

    private func requireRemoteConnection() -> Bool {
        guard isRemoteConnected else {
            statusText = "Desktop not connected"
            return false
        }
        return true
    }

    private func handleRemoteFailure(_ error: Error, statusText: String) async {
        self.statusText = statusText
        guard Self.shouldDisconnectAfterRemoteFailure(error) else {
            return
        }
        await remoteWorkspaceClient.disconnect()
        isRemoteConnected = false
    }

    private func handleScopedRemoteFailure(_ error: Error, statusText: String, isVisible: Bool) async {
        guard Self.shouldDisconnectAfterRemoteFailure(error) || isVisible else {
            return
        }
        await handleRemoteFailure(error, statusText: statusText)
    }

    private static func shouldDisconnectAfterRemoteFailure(_ error: Error) -> Bool {
        if error is CancellationError {
            return false
        }

        if error is VectorCodeRemoteSyncError || error is VectorCodeRelayClientError {
            return true
        }

        guard let clientError = error as? VectorCodeRemoteWorkspaceClientError else {
            return true
        }

        switch clientError {
        case .remoteError:
            return false
        case .missingPayload, .invalidResponse, .unexpectedAction, .unexpectedRequestId:
            return true
        }
    }

    private static func isFileModifiedSinceError(_ error: Error) -> Bool {
        guard let clientError = error as? VectorCodeRemoteWorkspaceClientError else {
            return false
        }
        guard case .remoteError(let remoteError) = clientError else {
            return false
        }
        return remoteError.code == fileModifiedSinceErrorCode
    }

    private static func withTimeout<Value: Sendable>(
        seconds: TimeInterval,
        operation: @escaping @Sendable () async throws -> Value
    ) async throws -> Value {
        try await withThrowingTaskGroup(of: Value.self) { group in
            group.addTask {
                try await operation()
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw VectorCodeRemoteSyncError.timeout
            }
            guard let value = try await group.next() else {
                throw VectorCodeRemoteSyncError.timeout
            }
            group.cancelAll()
            return value
        }
    }
}

private struct VectorCodeDirtyEditorDraft {
    let editor: VectorCodeEditorTab
    let content: String
}

private enum VectorCodeRemoteSyncError: Error {
    case timeout
}

public struct VectorCodeEditorConflict: Identifiable, Equatable, Sendable {
    public var id: String { "\(projectId):\(editorId):\(desktopVersion ?? "unknown")" }
    public let projectId: String
    public let editorId: String
    public let path: String
    public let title: String
    public var localContent: String
    public let desktopContent: String
    public let desktopVersion: String?
}
