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
    private var selectedEditorByProject: [String: String] = [:]
    private var selectedTerminalByProject: [String: String] = [:]

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
        if let initialProjectId, let selectedEditorId {
            selectedEditorByProject[initialProjectId] = selectedEditorId
        }
        if let initialProjectId, let selectedTerminalId {
            selectedTerminalByProject[initialProjectId] = selectedTerminalId
        }
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
        selectedEditorByProject.removeAll()
        selectedTerminalByProject.removeAll()
        viewport = .projects
        statusText = "Not paired"
    }

    public func switchProject(_ project: VectorCodeProjectSummary) {
        rememberCurrentProjectSelection()
        selectedProjectId = project.id
        selectedEditorId = restoredEditorId(for: project.id)
        selectedTerminalId = restoredTerminalId(for: project.id)
        if let selectedEditorId {
            selectedEditorByProject[project.id] = selectedEditorId
        }
        if let selectedTerminalId {
            selectedTerminalByProject[project.id] = selectedTerminalId
        }
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

        guard isRemoteConnected else {
            statusText = "Desktop not connected"
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

        guard isRemoteConnected else {
            statusText = "Desktop not connected"
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

        if isRemoteConnected {
            statusText = "Creating terminal"
            Task { [weak self] in
                await self?.createRemoteTerminal(project: project)
            }
            return
        }

        statusText = "Desktop not connected"
    }

    public func sendTerminalInput(_ input: String, submit: Bool) {
        guard !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let projectId = selectedProject?.id, let terminalId = selectedTerminal?.id else {
            return
        }

        guard isRemoteConnected else {
            statusText = "Desktop not connected"
            return
        }

        Task { [weak self] in
            await self?.sendRemoteTerminalInput(projectId: projectId, terminalId: terminalId, input: input, submit: submit, mode: submit ? .command : .paste)
        }
    }

    public func selectEditor(_ editor: VectorCodeEditorTab) {
        selectedProjectId = editor.projectId
        selectedEditorId = editor.id
        selectedEditorByProject[editor.projectId] = editor.id
        editorDraft = editor.content ?? ""
        viewport = .editor
    }

    public func closeEditor(_ editor: VectorCodeEditorTab) {
        guard let index = snapshot.editorsByProject[editor.projectId]?.firstIndex(where: { $0.id == editor.id }) else {
            return
        }

        snapshot.editorsByProject[editor.projectId]?.remove(at: index)
        let remainingEditors = snapshot.editorsByProject[editor.projectId] ?? []
        if selectedEditorId == editor.id {
            let nextEditor = remainingEditors.indices.contains(index) ? remainingEditors[index] : remainingEditors.last
            selectedEditorId = nextEditor?.id
            editorDraft = nextEditor?.content ?? ""
        }
        if let selectedEditorId {
            selectedEditorByProject[editor.projectId] = selectedEditorId
        } else {
            selectedEditorByProject.removeValue(forKey: editor.projectId)
            editorDraft = ""
        }
    }

    private func openLocalFile(_ node: VectorCodeFileNode, project: VectorCodeProjectSummary, content: String? = nil, language: String? = nil, version: String? = nil) {
        let existingEditor = snapshot.editorsByProject[project.id]?.first { $0.path == node.path }
        if let existingEditor {
            selectedEditorId = existingEditor.id
            selectedEditorByProject[project.id] = existingEditor.id
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
                language: language ?? Self.language(for: node.path),
                content: content,
                version: version
            )
            snapshot.editorsByProject[project.id, default: []].append(editor)
            selectedEditorId = editor.id
            selectedEditorByProject[project.id] = editor.id
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
        selectedTerminalByProject[terminal.projectId] = terminal.id
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

        guard isRemoteConnected else {
            statusText = "Desktop not connected"
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
        guard isRemoteConnected else {
            statusText = "Desktop not connected"
            return
        }

        removeLocalTerminal(terminal)
        statusText = "Closing terminal"

        Task { [weak self] in
            await self?.controlRemoteTerminal(terminal, command: .close)
        }
    }

    public func clearTerminal(_ terminal: VectorCodeTerminalTab) {
        guard isRemoteConnected else {
            statusText = "Desktop not connected"
            return
        }

        replaceTerminalOutput(projectId: terminal.projectId, terminalId: terminal.id, output: [])
        statusText = "Clearing terminal"
        Task { [weak self] in
            await self?.controlRemoteTerminal(terminal, command: .clear)
        }
    }

    public func interruptTerminal(_ terminal: VectorCodeTerminalTab) {
        guard isRemoteConnected else {
            statusText = "Desktop not connected"
            return
        }

        appendTerminalLine(projectId: terminal.projectId, terminalId: terminal.id, line: "^C")
        statusText = "Interrupting terminal"
        Task { [weak self] in
            await self?.controlRemoteTerminal(terminal, command: .interrupt)
        }
    }

    public func sendTerminalData(_ data: String) {
        guard !data.isEmpty, let projectId = selectedProject?.id, let terminalId = selectedTerminal?.id else {
            return
        }

        guard isRemoteConnected else {
            statusText = "Desktop not connected"
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
        guard isRemoteConnected, cols > 0, rows > 0 else {
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

    private func removeLocalTerminal(_ terminal: VectorCodeTerminalTab) {
        guard let index = snapshot.terminalsByProject[terminal.projectId]?.firstIndex(where: { $0.id == terminal.id }) else {
            return
        }

        snapshot.terminalsByProject[terminal.projectId]?.remove(at: index)
        let remainingTerminals = snapshot.terminalsByProject[terminal.projectId] ?? []
        if selectedTerminalId == terminal.id {
            let nextTerminal = remainingTerminals.indices.contains(index) ? remainingTerminals[index] : remainingTerminals.last
            selectedTerminalId = nextTerminal?.id
        }
        if let selectedTerminalId {
            selectedTerminalByProject[terminal.projectId] = selectedTerminalId
            if let nextTerminal = remainingTerminals.first(where: { $0.id == selectedTerminalId }) {
                selectTerminal(nextTerminal)
            }
        } else {
            selectedTerminalByProject.removeValue(forKey: terminal.projectId)
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

    private static func language(for path: String) -> String {
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        switch ext {
        case "md", "mdx":
            return "markdown"
        case "swift":
            return "swift"
        case "ts", "tsx":
            return "typescript"
        case "js", "jsx":
            return "javascript"
        case "json":
            return "json"
        case "sh", "zsh", "bash":
            return "shell"
        default:
            return "text"
        }
    }

    private static func renamedPath(for path: String, newName: String) -> String {
        guard let slashIndex = path.lastIndex(of: "/") else {
            return newName
        }
        return "\(path[..<path.index(after: slashIndex)])\(newName)"
    }

    private func loadRemoteWorkspace(configuration: VectorCodeRelayConfiguration) async {
        statusText = "Connecting to desktop"
        do {
            try await remoteWorkspaceClient.connect(configuration: configuration)
            statusText = "Syncing workspace"
            let nextSnapshot = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readState()
            }
            applySnapshot(nextSnapshot)
            isRemoteConnected = true
            statusText = "Connected"
        } catch is CancellationError {
            await remoteWorkspaceClient.disconnect()
            isRemoteConnected = false
            statusText = "Ready to connect"
        } catch {
            await remoteWorkspaceClient.disconnect()
            isRemoteConnected = false
            statusText = "Paired. Desktop not ready."
        }
    }

    private func applySnapshot(_ nextSnapshot: VectorCodeRemoteWorkspaceSnapshot) {
        rememberCurrentProjectSelection()
        let currentProjectId = selectedProjectId
        let dirtyEditor = selectedEditor?.isDirty == true ? selectedEditor : nil
        let dirtyDraft = dirtyEditor == nil ? nil : editorDraft
        snapshot = nextSnapshot
        if let dirtyEditor, let dirtyDraft {
            restoreDirtyEditor(dirtyEditor, draft: dirtyDraft)
        }
        let nextProjectId: String?
        if let currentProjectId, nextSnapshot.projects.contains(where: { $0.id == currentProjectId }) {
            nextProjectId = currentProjectId
        } else {
            nextProjectId = nextSnapshot.activeProjectId ?? nextSnapshot.projects.first?.id
        }
        selectedProjectId = nextProjectId
        selectedEditorId = nextProjectId.flatMap { restoredEditorId(for: $0) }
        selectedTerminalId = nextProjectId.flatMap { restoredTerminalId(for: $0) }
        if let nextProjectId, let selectedEditorId {
            selectedEditorByProject[nextProjectId] = selectedEditorId
        }
        if let nextProjectId, let selectedTerminalId {
            selectedTerminalByProject[nextProjectId] = selectedTerminalId
        }
        editorDraft = snapshot.editorsByProject[nextProjectId ?? ""]?.first { $0.id == selectedEditorId }?.content ?? ""
        if nextProjectId == nil {
            viewport = .projects
        } else if viewport == .projects {
            viewport = .files
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

    private func openRemoteFile(_ node: VectorCodeFileNode, project: VectorCodeProjectSummary) async {
        do {
            let response = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readFile(projectId: project.id, path: node.path)
            }
            openLocalFile(node, project: project, content: response.content, language: response.language, version: response.version)
            statusText = "Connected"
        } catch {
            statusText = "File unavailable"
        }
    }

    private func saveRemoteEditor(_ editor: VectorCodeEditorTab, projectId: String, content: String) async {
        do {
            let response = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.writeFile(projectId: projectId, path: editor.path, content: content, expectedVersion: editor.version)
            }
            updateEditor(projectId: projectId, editorId: editor.id, content: content, isDirty: false, version: response.version)
            statusText = "Saved"
        } catch {
            statusText = "Save failed"
        }
    }

    private func moveRemoteFile(projectId: String, path: String, targetPath: String) async {
        do {
            _ = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.moveFile(projectId: projectId, path: path, targetPath: targetPath)
            }
            await refreshRemoteWorkspace()
            statusText = "Renamed"
        } catch {
            statusText = "Rename failed"
        }
    }

    private func copyRemoteFile(sourceProjectId: String, path: String, targetProjectId: String, targetPath: String) async {
        do {
            _ = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.copyFile(projectId: sourceProjectId, path: path, targetProjectId: targetProjectId, targetPath: targetPath)
            }
            await refreshRemoteWorkspace()
            statusText = "Copied"
        } catch {
            statusText = "Copy failed"
        }
    }

    private func loadRemoteFolderChildren(projectId: String, path: String) async {
        do {
            let response = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readFileTree(projectId: projectId, path: path)
            }
            replaceFolderChildren(projectId: projectId, path: path, children: response.nodes, truncated: response.truncated)
            statusText = "Connected"
        } catch {
            statusText = "Folder unavailable"
        }
    }

    private func createRemoteTerminal(project: VectorCodeProjectSummary) async {
        do {
            let terminal = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.createTerminal(projectId: project.id)
            }
            snapshot.terminalsByProject[project.id, default: []].removeAll { $0.id == terminal.id }
            snapshot.terminalsByProject[project.id, default: []].append(terminal)
            selectedTerminalId = terminal.id
            selectedTerminalByProject[project.id] = terminal.id
            viewport = .terminal
            statusText = "Connected"
        } catch {
            statusText = "Terminal unavailable"
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
        do {
            _ = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.sendTerminalInput(projectId: projectId, terminalId: terminalId, input: input, submit: submit, mode: mode)
            }
            guard refreshAfterSend else {
                statusText = "Connected"
                return
            }
            try await Task.sleep(nanoseconds: 450_000_000)
            let terminalOutput = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readTerminalOutput(projectId: projectId, terminalId: terminalId)
            }
            replaceTerminalOutput(projectId: projectId, terminalId: terminalId, output: terminalOutput.output, rawOutput: terminalOutput.rawOutput)
            statusText = "Connected"
        } catch {
            statusText = "Terminal input failed"
        }
    }

    public func refreshTerminalOutput(projectId: String, terminalId: String) async {
        guard isRemoteConnected else {
            return
        }
        await refreshRemoteTerminalOutput(projectId: projectId, terminalId: terminalId, updateStatus: true)
    }

    public func pollTerminalOutput(projectId: String, terminalId: String) async {
        guard isRemoteConnected else {
            return
        }
        while !Task.isCancelled {
            guard selectedProjectId == projectId, selectedTerminalId == terminalId else {
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
        do {
            let response = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.controlTerminal(
                    projectId: terminal.projectId,
                    terminalId: terminal.id,
                    command: command,
                    cols: cols,
                    rows: rows,
                    title: title
                )
            }
            statusText = response.accepted ? "Connected" : "Terminal action rejected"
        } catch {
            statusText = "Terminal action failed"
        }
    }

    private func refreshRemoteWorkspace() async {
        let projectId = selectedProjectId
        do {
            let nextSnapshot = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readState(projectId: projectId)
            }
            applySnapshot(nextSnapshot)
            statusText = "Connected"
        } catch {
            statusText = "Refresh failed"
        }
    }

    private func refreshRemoteTerminalOutput(projectId: String, terminalId: String, updateStatus: Bool) async {
        do {
            let terminalOutput = try await Self.withTimeout(seconds: 8) { [remoteWorkspaceClient] in
                try await remoteWorkspaceClient.readTerminalOutput(projectId: projectId, terminalId: terminalId)
            }
            replaceTerminalOutput(projectId: projectId, terminalId: terminalId, output: terminalOutput.output, rawOutput: terminalOutput.rawOutput)
            if updateStatus {
                statusText = "Connected"
            }
        } catch {
            if updateStatus {
                statusText = "Terminal output failed"
            }
        }
    }

    private func rememberCurrentProjectSelection() {
        guard let selectedProjectId else {
            return
        }
        if let selectedEditorId {
            selectedEditorByProject[selectedProjectId] = selectedEditorId
        }
        if let selectedTerminalId {
            selectedTerminalByProject[selectedProjectId] = selectedTerminalId
        }
    }

    private func restoredEditorId(for projectId: String) -> String? {
        let editors = snapshot.editorsByProject[projectId] ?? []
        if let remembered = selectedEditorByProject[projectId], editors.contains(where: { $0.id == remembered }) {
            return remembered
        }
        return editors.first?.id
    }

    private func restoredTerminalId(for projectId: String) -> String? {
        let terminals = snapshot.terminalsByProject[projectId] ?? []
        if let remembered = selectedTerminalByProject[projectId], terminals.contains(where: { $0.id == remembered }) {
            return remembered
        }
        return terminals.first?.id
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

public extension VectorCodeRemoteWorkspaceSnapshot {
    static let empty = VectorCodeRemoteWorkspaceSnapshot()

    static let sample = VectorCodeRemoteWorkspaceSnapshot(
        activeProjectId: "job-board",
        projects: [
            VectorCodeProjectSummary(id: "job-board", name: "job_board", path: "~/OrinTech/job_board"),
            VectorCodeProjectSummary(id: "neuron", name: "NEURON", path: "~/OrinTech/NEURON"),
        ],
        filesByProject: [
            "job-board": [
                VectorCodeFileNode(name: "apps", path: "apps", kind: .folder, children: [
                    VectorCodeFileNode(name: "web", path: "apps/web", kind: .folder, children: [
                        VectorCodeFileNode(name: "page.tsx", path: "apps/web/app/page.tsx", kind: .file),
                    ]),
                ]),
                VectorCodeFileNode(name: "README.md", path: "README.md", kind: .file),
                VectorCodeFileNode(name: "package.json", path: "package.json", kind: .file),
            ],
            "neuron": [
                VectorCodeFileNode(name: "products", path: "products", kind: .folder, children: [
                    VectorCodeFileNode(name: "audio-lab", path: "products/audio-lab", kind: .folder),
                ]),
                VectorCodeFileNode(name: "README.md", path: "README.md", kind: .file),
            ],
        ],
        editorsByProject: [
            "job-board": [
                VectorCodeEditorTab(
                    id: "job-board:README.md",
                    projectId: "job-board",
                    path: "README.md",
                    title: "README.md",
                    language: "markdown",
                    content: "# job_board\n\nOpen from desktop, continue on phone.\n"
                ),
            ],
            "neuron": [
                VectorCodeEditorTab(
                    id: "neuron:README.md",
                    projectId: "neuron",
                    path: "README.md",
                    title: "README.md",
                    language: "markdown",
                    content: "# NEURON\n\nProject state restores when you switch back.\n"
                ),
            ],
        ],
        terminalsByProject: [
            "job-board": [
                VectorCodeTerminalTab(
                    id: "job-board:terminal-1",
                    projectId: "job-board",
                    title: "zsh",
                    cwd: "~/OrinTech/job_board",
                    isActive: true,
                    output: ["david@Mac job_board % pnpm test", "Tests ready."]
                ),
                VectorCodeTerminalTab(
                    id: "job-board:terminal-2",
                    projectId: "job-board",
                    title: "server",
                    cwd: "~/OrinTech/job_board",
                    output: ["ready - started server on 3000"]
                ),
            ],
            "neuron": [
                VectorCodeTerminalTab(
                    id: "neuron:terminal-1",
                    projectId: "neuron",
                    title: "zsh",
                    cwd: "~/OrinTech/NEURON",
                    isActive: true,
                    output: ["david@Mac NEURON % swift test"]
                ),
            ],
        ]
    )
}
