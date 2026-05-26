import Combine
import Foundation

@MainActor
public final class VectorCodeMobileWorkspaceModel: ObservableObject {
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
    @Published public private(set) var isRemoteConnected: Bool

    private let remoteWorkspaceClient: VectorCodeRemoteWorkspaceClient
    private let pairingStore: VectorCodePairingStore
    private var remoteSyncTask: Task<Void, Never>?
    private var editorSelections = VectorCodeProjectScopedSelectionStore()
    private var terminalSelections = VectorCodeProjectScopedSelectionStore()

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
        editorSelections.clear()
        terminalSelections.clear()
        viewport = .projects
        statusText = "Not paired"
    }

    public func switchProject(_ project: VectorCodeProjectSummary) {
        rememberCurrentProjectSelection()
        selectedProjectId = project.id
        selectedEditorId = restoredEditorId(for: project.id)
        selectedTerminalId = restoredTerminalId(for: project.id)
        editorSelections.remember(projectId: project.id, selectedId: selectedEditorId)
        terminalSelections.remember(projectId: project.id, selectedId: selectedTerminalId)
        editorDraft = snapshot.editorsByProject[project.id]?.first { $0.id == selectedEditorId }?.content ?? ""
        viewport = .files
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

        if isRemoteConnected {
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
        let content = editorDraft

        if isRemoteConnected {
            statusText = "Saving \(editor.title)"
            Task { [weak self] in
                await self?.saveRemoteEditor(editor, projectId: projectId, content: content)
            }
            return
        }

        updateEditor(projectId: projectId, editorId: editor.id, content: content, isDirty: false)
        statusText = "Saved locally"
    }

    public func renameFile(_ node: VectorCodeFileNode, to newName: String) {
        guard let project = selectedProject else {
            return
        }
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

    public func copyFile(_ node: VectorCodeFileNode, to destinationProject: VectorCodeProjectSummary, destinationPath: String) {
        guard let sourceProject = selectedProject else {
            return
        }
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
                targetPath: trimmedPath
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
        selectedProjectId = editor.projectId
        selectedEditorId = editor.id
        editorSelections.remember(projectId: editor.projectId, selectedId: editor.id)
        editorDraft = editor.content ?? ""
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
            editorDraft = nextEditor?.content ?? ""
        }

        if selectedProjectId == editor.projectId && selectedEditorId == nil {
            editorDraft = ""
        }
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

    public func markEditorDirty() {
        guard let projectId = selectedProject?.id, let editorId = selectedEditorId else {
            return
        }
        guard let index = snapshot.editorsByProject[projectId]?.firstIndex(where: { $0.id == editorId }) else {
            return
        }
        snapshot.editorsByProject[projectId]?[index].isDirty = true
        snapshot.editorsByProject[projectId]?[index].content = editorDraft
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
        let dirtyEditor = selectedEditor?.isDirty == true ? selectedEditor : nil
        let dirtyDraft = dirtyEditor == nil ? nil : editorDraft
        let mergedSnapshot = Self.mergeProjectScopedSnapshot(current: snapshot, next: nextSnapshot)
        snapshot = mergedSnapshot
        if let dirtyEditor, let dirtyDraft {
            restoreDirtyEditor(dirtyEditor, draft: dirtyDraft)
        }
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
        editorDraft = snapshot.editorsByProject[nextProjectId ?? ""]?.first { $0.id == selectedEditorId }?.content ?? ""
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

    private func restoreDirtyEditor(_ dirtyEditor: VectorCodeEditorTab, draft: String) {
        guard let editors = snapshot.editorsByProject[dirtyEditor.projectId] else {
            return
        }
        guard let index = editors.firstIndex(where: { $0.id == dirtyEditor.id || $0.path == dirtyEditor.path }) else {
            return
        }
        snapshot.editorsByProject[dirtyEditor.projectId]?[index].content = draft
        snapshot.editorsByProject[dirtyEditor.projectId]?[index].isDirty = true
        snapshot.editorsByProject[dirtyEditor.projectId]?[index].version = dirtyEditor.version
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
        await runRemoteOperation(failureStatus: "File unavailable") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.readFile(projectId: project.id, path: node.path)
        } onSuccess: { response in
            openLocalFile(node, project: project, content: response.content, language: response.language, version: response.version)
            statusText = "Connected"
        }
    }

    private func saveRemoteEditor(_ editor: VectorCodeEditorTab, projectId: String, content: String) async {
        await runRemoteOperation(failureStatus: "Save failed") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.writeFile(projectId: projectId, path: editor.path, content: content, expectedVersion: editor.version)
        } onSuccess: { response in
            updateEditor(projectId: projectId, editorId: editor.id, content: content, isDirty: false, version: response.version)
            statusText = "Saved"
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

    private func copyRemoteFile(sourceProjectId: String, path: String, targetProjectId: String, targetPath: String) async {
        await runRemoteOperation(failureStatus: "Copy failed") { [remoteWorkspaceClient] in
            try await remoteWorkspaceClient.copyFile(projectId: sourceProjectId, path: path, targetProjectId: targetProjectId, targetPath: targetPath)
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
            selectedTerminalId = terminal.id
            terminalSelections.remember(projectId: project.id, selectedId: terminal.id)
            viewport = .terminal
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

private enum VectorCodeRemoteSyncError: Error {
    case timeout
}
