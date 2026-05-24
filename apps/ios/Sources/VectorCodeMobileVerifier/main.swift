import Foundation
import VectorCodeMobile

@MainActor
func verifyVectorCodeMobile() async throws {
    VectorCodePairingStore().clear()

    let expiresAt = VectorCodeISO8601.string(from: Date().addingTimeInterval(300))
    let relayTokenExpiresAt = VectorCodeISO8601.string(from: Date().addingTimeInterval(86_400))
    let payload = VectorCodePairingPayload(
        desktopId: "desktop-1",
        pairingId: "pairing-1",
        desktopPublicKey: "public-key",
        desktopPublicKeyFingerprint: "fingerprint",
        pairingToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        relayHost: "relay.vectorcode.app",
        userId: "default",
        relayToken: "relay-token",
        relayTokenExpiresAt: relayTokenExpiresAt,
        expiresAt: expiresAt
    )
    try payload.validate()

    let payloadData = try JSONEncoder().encode(payload)
    let payloadJSON = String(data: payloadData, encoding: .utf8)!
    let decodedPayload = try VectorCodePairingPayload.decode(from: payloadJSON)
    precondition(decodedPayload == payload)

    let relayConfiguration = try VectorCodeRelayConfiguration(pairingPayload: payload, phoneId: "phone-1")
    precondition(relayConfiguration.webSocketURL.absoluteString.contains("/relay"))
    precondition(relayConfiguration.webSocketURL.host == "relay.vectorcode.app")
    precondition(relayConfiguration.webSocketURL.absoluteString.contains("role=phone"))
    precondition(relayConfiguration.webSocketURL.absoluteString.contains("deviceId=phone-1"))
    precondition(relayConfiguration.authorizationHeader == "Bearer relay-token")

    let legacyRelayPayload = VectorCodePairingPayload(
        desktopId: "desktop-1",
        pairingId: "pairing-legacy",
        desktopPublicKey: "public-key",
        desktopPublicKeyFingerprint: "fingerprint",
        pairingToken: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        relayHost: "relay-production-e21f.up.railway.app",
        userId: "default",
        relayToken: "relay-token",
        relayTokenExpiresAt: relayTokenExpiresAt,
        expiresAt: expiresAt
    )
    precondition(legacyRelayPayload.relayHost == "relay.vectorcode.app")
    let legacyRelayConfiguration = try VectorCodeRelayConfiguration(pairingPayload: legacyRelayPayload, phoneId: "phone-1")
    precondition(legacyRelayConfiguration.webSocketURL.host == "relay.vectorcode.app")

    let emptyModel = VectorCodeMobileWorkspaceModel()
    precondition(emptyModel.snapshot.projects.isEmpty)
    precondition(emptyModel.selectedProject == nil)
    precondition(emptyModel.statusText == "Not paired")
    try emptyModel.pair(from: payloadJSON, phoneId: "phone-1")
    precondition(emptyModel.statusText == "Ready to connect")
    let restoredModel = VectorCodeMobileWorkspaceModel()
    precondition(restoredModel.relayConfiguration?.phoneId == "phone-1")
    precondition(restoredModel.statusText == "Ready to connect")
    restoredModel.clearPairing()
    precondition(restoredModel.relayConfiguration == nil)
    precondition(restoredModel.snapshot.projects.isEmpty)

    let model = VectorCodeMobileWorkspaceModel(snapshot: .sample)
    precondition(model.snapshot.projects.count == 2)
    precondition(model.selectedProject?.id == "job-board")
    precondition(model.selectedTerminals.count == 2)

    let neuron = model.snapshot.projects.first { $0.id == "neuron" }!
    model.switchProject(neuron)
    precondition(model.selectedProject?.id == "neuron")
    precondition(model.selectedTerminals.count == 1)
    precondition(model.selectedEditor?.path == "README.md")

    let readme = model.selectedFiles.first { $0.name == "README.md" }!
    model.openFile(readme)
    precondition(model.viewport == .editor)
    model.editorDraft.append("\nEdited on phone.")
    model.markEditorDirty()
    precondition(model.selectedEditor?.isDirty == true)
    model.saveEditor()
    precondition(model.selectedEditor?.isDirty == false)
    precondition(model.selectedEditor?.content?.contains("Edited on phone.") == true)
    model.closeEditor(model.selectedEditor!)
    precondition(model.selectedEditor == nil)

    model.selectTerminal(model.selectedTerminals[0])
    model.sendTerminalInput("  pwd", submit: false)
    precondition(model.selectedTerminal?.output.last == "$   pwd [pasted]")
    model.createTerminal()
    precondition(model.selectedTerminals.count == 2)
    precondition(model.selectedTerminal?.isActive == true)
    model.renameTerminal(model.selectedTerminal!, title: "mobile")
    precondition(model.selectedTerminal?.title == "mobile")
    model.clearTerminal(model.selectedTerminal!)
    precondition(model.selectedTerminal?.output.isEmpty == true)
    model.interruptTerminal(model.selectedTerminal!)
    precondition(model.selectedTerminal?.output.last == "^C")
    let rememberedNeuronTerminalId = model.selectedTerminal?.id
    let jobBoard = model.snapshot.projects.first { $0.id == "job-board" }!
    model.switchProject(jobBoard)
    precondition(model.selectedProject?.id == "job-board")
    model.switchProject(neuron)
    precondition(model.selectedTerminal?.id == rememberedNeuronTerminalId)
    model.closeTerminal(model.selectedTerminal!)
    precondition(model.selectedTerminals.count == 1)

    let terminalInput = VectorCodeTerminalInputRequest(terminalId: "terminal-1", input: "pnpm test", submit: false)
    let envelope = VectorCodeRemoteEnvelope(action: .terminalInput, projectId: "job-board", payload: terminalInput)
    let envelopeData = try JSONEncoder().encode(envelope)
    let envelopeJSON = String(data: envelopeData, encoding: .utf8)!
    precondition(envelopeJSON.contains("\"terminal.input\""))
    precondition(envelopeJSON.contains("\"submit\":false"))
    precondition(envelopeJSON.contains("\"mode\":\"paste\""))
    precondition(envelopeJSON.contains("\"kind\":\"request\""))
    let rawTerminalInput = VectorCodeTerminalInputRequest(terminalId: "terminal-1", input: "\u{001B}[A", mode: .raw)
    let rawTerminalInputJSON = String(data: try JSONEncoder().encode(rawTerminalInput), encoding: .utf8)!
    precondition(rawTerminalInputJSON.contains("\"mode\":\"raw\""))

    let minimalFile = try JSONDecoder().decode(VectorCodeFileNode.self, from: Data(#"{"name":"README.md","path":"README.md","kind":"file"}"#.utf8))
    precondition(minimalFile.children.isEmpty)
    let minimalTerminal = try JSONDecoder().decode(VectorCodeTerminalTab.self, from: Data(#"{"id":"terminal-1","projectId":"job-board","title":"zsh","cwd":"~/OrinTech/job_board","isActive":true}"#.utf8))
    precondition(minimalTerminal.output.isEmpty)
    let versionedEditor = VectorCodeEditorTab(
        id: "editor-1",
        projectId: "job-board",
        path: "README.md",
        title: "README.md",
        language: "markdown",
        content: "# readme",
        version: "etag-1"
    )
    let versionedEditorJSON = String(data: try JSONEncoder().encode(versionedEditor), encoding: .utf8)!
    precondition(versionedEditorJSON.contains("\"version\":\"etag-1\""))
    let terminalControl = VectorCodeTerminalControlRequest(terminalId: "terminal-1", command: .resize, cols: 120, rows: 32)
    let terminalControlEnvelope = VectorCodeRemoteEnvelope(action: .terminalControl, projectId: "job-board", payload: terminalControl)
    let terminalControlJSON = String(data: try JSONEncoder().encode(terminalControlEnvelope), encoding: .utf8)!
    precondition(terminalControlJSON.contains("\"terminal.control\""))
    precondition(terminalControlJSON.contains("\"resize\""))
    let terminalRenameControl = VectorCodeTerminalControlRequest(terminalId: "terminal-1", command: .rename, title: "server")
    let terminalRenameControlJSON = String(data: try JSONEncoder().encode(terminalRenameControl), encoding: .utf8)!
    precondition(terminalRenameControlJSON.contains("\"rename\""))
    precondition(terminalRenameControlJSON.contains("\"server\""))
    let terminalCloseControl = VectorCodeTerminalControlRequest(terminalId: "terminal-1", command: .close)
    let terminalCloseControlJSON = String(data: try JSONEncoder().encode(terminalCloseControl), encoding: .utf8)!
    precondition(terminalCloseControlJSON.contains("\"close\""))

    let frameHeader = VectorCodeRelayFrameHeader(
        desktopId: relayConfiguration.desktopId,
        phoneId: relayConfiguration.phoneId,
        streamId: "terminal",
        channel: .terminal,
        direction: .phoneToDesktop,
        seq: 1,
        action: .terminalInput
    )
    let frame = try VectorCodeRelayFrameCrypto.encrypt(envelope, header: frameHeader, pairingToken: payload.pairingToken)
    precondition(frame.header.direction == .phoneToDesktop)
    precondition(!frame.nonce.isEmpty)
    precondition(!frame.ciphertext.isEmpty)
    precondition(!frame.tag.isEmpty)
    let decodedEnvelope = try VectorCodeRelayFrameCrypto.decrypt(frame, pairingToken: payload.pairingToken, as: VectorCodeRemoteEnvelope<VectorCodeTerminalInputRequest>.self)
    precondition(decodedEnvelope.requestId == envelope.requestId)
    precondition(decodedEnvelope.payload?.submit == false)

    let relayMessage = try JSONEncoder().encode(VectorCodeRelayOutboundMessage.frame(frame))
    let relayMessageJSON = String(data: relayMessage, encoding: .utf8)!
    precondition(relayMessageJSON.contains("\"type\":\"relay.frame\""))
    precondition(relayMessageJSON.contains("\"phone_to_desktop\""))

    let remoteSnapshot = VectorCodeRemoteWorkspaceSnapshot(
        activeProjectId: "job-board",
        projects: [
            VectorCodeProjectSummary(id: "job-board", name: "job_board", path: "~/OrinTech/job_board"),
        ],
        filesByProject: [
            "job-board": [
                VectorCodeFileNode(name: "README.md", path: "README.md", kind: .file),
            ],
        ],
        editorsByProject: [
            "job-board": [
                VectorCodeEditorTab(id: "editor-1", projectId: "job-board", path: "README.md", title: "README.md", language: "markdown"),
            ],
        ],
        terminalsByProject: [
            "job-board": [
                VectorCodeTerminalTab(id: "terminal-1", projectId: "job-board", title: "zsh", cwd: "~/OrinTech/job_board", isActive: true),
            ],
        ]
    )
    let loopbackRelayClient = VectorCodeRelayLoopbackClient(snapshot: remoteSnapshot)
    let remoteWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: loopbackRelayClient)
    let receivedSnapshot = try await remoteWorkspaceClient.readState(projectId: "job-board")
    precondition(receivedSnapshot == remoteSnapshot)
    let fileReadResponse = try await remoteWorkspaceClient.readFile(projectId: "job-board", path: "README.md")
    precondition(fileReadResponse.content.contains("remote README"))
    let fileTreeResponse = try await remoteWorkspaceClient.readFileTree(projectId: "job-board", path: "src")
    precondition(fileTreeResponse.nodes.first?.path == "src/main.swift")
    precondition(fileTreeResponse.truncated == false)
    let fileWriteResponse = try await remoteWorkspaceClient.writeFile(projectId: "job-board", path: "README.md", content: "# Updated", expectedVersion: "v1")
    precondition(fileWriteResponse.path == "README.md")
    let createdTerminal = try await remoteWorkspaceClient.createTerminal(projectId: "job-board")
    precondition(createdTerminal.projectId == "job-board")
    let terminalInputResponse = try await remoteWorkspaceClient.sendTerminalInput(projectId: "job-board", terminalId: "terminal-1", input: "pnpm test", submit: false)
    precondition(terminalInputResponse.accepted)
    let terminalOutputResponse = try await remoteWorkspaceClient.readTerminalOutput(projectId: "job-board", terminalId: "terminal-1")
    precondition(terminalOutputResponse.output.contains("pnpm test"))
    precondition(terminalOutputResponse.rawOutput?.contains("\u{001B}[32m") == true)
    let terminalControlResponse = try await remoteWorkspaceClient.controlTerminal(projectId: "job-board", terminalId: "terminal-1", command: .clear)
    precondition(terminalControlResponse.accepted)
    let terminalRenameResponse = try await remoteWorkspaceClient.controlTerminal(projectId: "job-board", terminalId: "terminal-1", command: .rename, title: "server")
    precondition(terminalRenameResponse.accepted)
    let terminalCloseResponse = try await remoteWorkspaceClient.controlTerminal(projectId: "job-board", terminalId: "terminal-1", command: .close)
    precondition(terminalCloseResponse.accepted)
    let sentEnvelopes = await loopbackRelayClient.sentEnvelopes
    precondition(sentEnvelopes.first?.action == .stateRead)
    precondition(sentEnvelopes.first?.projectId == "job-board")
    let sentActions = sentEnvelopes.map(\.action)
    precondition(sentActions == [.stateRead, .fileRead, .fileTreeRead, .fileWrite, .terminalCreate, .terminalInput, .terminalOutput, .terminalControl, .terminalControl, .terminalControl])
    precondition(sentEnvelopes.contains { $0.payloadJSON.contains("\"expectedVersion\":\"v1\"") })
    precondition(sentEnvelopes.contains { $0.payloadJSON.contains("\"mode\":\"paste\"") })
    precondition(sentEnvelopes.contains { $0.payloadJSON.contains("\"clear\"") })
    precondition(sentEnvelopes.contains { $0.payloadJSON.contains("\"rename\"") && $0.payloadJSON.contains("\"server\"") })
    precondition(sentEnvelopes.last?.payloadJSON.contains("\"close\"") == true)

    let staleRelayClient = VectorCodeStaleRelayClient(snapshot: remoteSnapshot)
    let staleWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: staleRelayClient)
    let staleRecoveredSnapshot = try await staleWorkspaceClient.readState(projectId: "job-board")
    precondition(staleRecoveredSnapshot == remoteSnapshot)
    let staleReceiveCount = await staleRelayClient.currentReceiveCount()
    precondition(staleReceiveCount == 2)
}

do {
    try await verifyVectorCodeMobile()
    print("VectorCodeMobileVerifier passed")
} catch {
    fputs("VectorCodeMobileVerifier failed: \(error.localizedDescription)\n", stderr)
    exit(1)
}

private actor VectorCodeRelayLoopbackClient: VectorCodeRelayClientProtocol {
    private let snapshot: VectorCodeRemoteWorkspaceSnapshot
    private(set) var lastSentEnvelope: VectorCodeSentEnvelope?
    private(set) var sentEnvelopes: [VectorCodeSentEnvelope] = []

    init(snapshot: VectorCodeRemoteWorkspaceSnapshot) {
        self.snapshot = snapshot
    }

    func connect(configuration: VectorCodeRelayConfiguration) async throws {}

    func disconnect() async {}

    func send<Payload: Codable & Sendable>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws {
        let payloadJSON = String(data: try JSONEncoder().encode(envelope), encoding: .utf8) ?? ""
        let sentEnvelope = VectorCodeSentEnvelope(action: envelope.action, projectId: envelope.projectId, requestId: envelope.requestId, payloadJSON: payloadJSON)
        lastSentEnvelope = sentEnvelope
        sentEnvelopes.append(sentEnvelope)
    }

    func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        switch lastSentEnvelope?.action {
        case .stateRead:
            return try response(snapshot, action: .stateRead)
        case .fileRead:
            return try response(
                VectorCodeFileReadResponse(path: "README.md", content: "# remote README\n", language: "markdown", version: "v1"),
                action: .fileRead
            )
        case .fileTreeRead:
            return try response(
                VectorCodeFileTreeResponse(nodes: [VectorCodeFileNode(name: "main.swift", path: "src/main.swift", kind: .file)]),
                action: .fileTreeRead
            )
        case .fileWrite:
            return try response(VectorCodeFileWriteResponse(path: "README.md", version: "v2"), action: .fileWrite)
        case .terminalCreate:
            return try response(
                VectorCodeTerminalTab(id: "terminal-2", projectId: "job-board", title: "zsh 2", cwd: "~/OrinTech/job_board", isActive: true),
                action: .terminalCreate
            )
        case .terminalInput:
            return try response(VectorCodeTerminalInputResponse(terminalId: "terminal-1", accepted: true), action: .terminalInput)
        case .terminalOutput:
            return try response(VectorCodeTerminalOutputResponse(terminalId: "terminal-1", output: ["pnpm test"], rawOutput: "\u{001B}[32mpnpm test\u{001B}[0m"), action: .terminalOutput)
        case .terminalControl:
            return try response(VectorCodeTerminalControlResponse(terminalId: "terminal-1", accepted: true), action: .terminalControl)
        default:
            return try response(snapshot, action: .stateRead)
        }
    }

    private func response<Payload: Encodable>(
        _ payload: Payload,
        action: VectorCodeRemoteAction
    ) throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        let data = try JSONEncoder().encode(payload)
        let decodedPayload = try JSONDecoder().decode(VectorCodeJSONValue.self, from: data)
            return VectorCodeRemoteEnvelope(
                kind: .response,
                requestId: lastSentEnvelope?.requestId ?? "loopback-response",
                action: action,
                payload: decodedPayload
            )
    }
}

private struct VectorCodeSentEnvelope: Sendable {
    let action: VectorCodeRemoteAction
    let projectId: String?
    let requestId: String
    let payloadJSON: String
}

private actor VectorCodeStaleRelayClient: VectorCodeRelayClientProtocol {
    private let snapshot: VectorCodeRemoteWorkspaceSnapshot
    private var requestId: String?
    private(set) var receiveCount = 0

    init(snapshot: VectorCodeRemoteWorkspaceSnapshot) {
        self.snapshot = snapshot
    }

    func connect(configuration: VectorCodeRelayConfiguration) async throws {}

    func disconnect() async {}

    func currentReceiveCount() -> Int {
        receiveCount
    }

    func send<Payload>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws where Payload: Decodable, Payload: Encodable, Payload: Sendable {
        requestId = envelope.requestId
    }

    func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        receiveCount += 1
        if receiveCount == 1 {
            let stalePayload = try JSONDecoder().decode(
                VectorCodeJSONValue.self,
                from: JSONEncoder().encode(VectorCodeTerminalOutputResponse(terminalId: "old-terminal", output: ["stale"]))
            )
            return VectorCodeRemoteEnvelope(
                kind: .response,
                requestId: "stale-response",
                action: .terminalOutput,
                payload: stalePayload
            )
        }

        let payload = try JSONDecoder().decode(VectorCodeJSONValue.self, from: JSONEncoder().encode(snapshot))
        return VectorCodeRemoteEnvelope(
            kind: .response,
            requestId: requestId ?? "state-response",
            action: .stateRead,
            payload: payload
        )
    }
}
