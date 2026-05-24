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

    let failingRelayClient = VectorCodeFailingRelayClient()
    let failingWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: failingRelayClient)
    let failingModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: failingWorkspaceClient)
    try failingModel.pair(from: payloadJSON, phoneId: "phone-fail")
    failingModel.connectToDesktop()
    try await waitUntil("failing model reports desktop not ready") {
        failingModel.statusText == "Paired. Desktop not ready."
    }
    precondition(failingModel.statusText == "Paired. Desktop not ready.")
    let failingDisconnectCount = await failingRelayClient.currentDisconnectCount()
    precondition(failingDisconnectCount == 1)

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
    precondition(model.statusText == "Desktop not connected")
    precondition(model.selectedTerminal?.output.last == "david@Mac NEURON % swift test")
    model.createTerminal()
    precondition(model.statusText == "Desktop not connected")
    precondition(model.selectedTerminals.count == 1)
    precondition(model.selectedTerminal?.isActive == true)
    model.renameTerminal(model.selectedTerminal!, title: "mobile")
    precondition(model.selectedTerminal?.title == "zsh")
    model.clearTerminal(model.selectedTerminal!)
    precondition(model.selectedTerminal?.output.isEmpty == false)
    model.interruptTerminal(model.selectedTerminal!)
    precondition(model.selectedTerminal?.output.last == "david@Mac NEURON % swift test")
    let rememberedNeuronTerminalId = model.selectedTerminal?.id
    let jobBoard = model.snapshot.projects.first { $0.id == "job-board" }!
    model.switchProject(jobBoard)
    precondition(model.selectedProject?.id == "job-board")
    model.switchProject(neuron)
    precondition(model.selectedTerminal?.id == rememberedNeuronTerminalId)
    model.closeTerminal(model.selectedTerminal!)
    precondition(model.selectedTerminals.count == 1)

    let collisionSnapshot = VectorCodeRemoteWorkspaceSnapshot(
        activeProjectId: "job-board",
        projects: VectorCodeRemoteWorkspaceSnapshot.sample.projects,
        filesByProject: VectorCodeRemoteWorkspaceSnapshot.sample.filesByProject,
        editorsByProject: [
            "job-board": [
                VectorCodeEditorTab(id: "shared-editor", projectId: "job-board", path: "README.md", title: "README.md", language: "markdown", content: "# job"),
            ],
            "neuron": [
                VectorCodeEditorTab(id: "shared-editor", projectId: "neuron", path: "README.md", title: "README.md", language: "markdown", content: "# neuron"),
                VectorCodeEditorTab(id: "neuron-next", projectId: "neuron", path: "NEXT.md", title: "NEXT.md", language: "markdown", content: "# next"),
            ],
        ],
        terminalsByProject: [
            "job-board": [
                VectorCodeTerminalTab(id: "shared-terminal", projectId: "job-board", title: "job", cwd: "~/OrinTech/job_board", isActive: true),
            ],
            "neuron": [
                VectorCodeTerminalTab(id: "shared-terminal", projectId: "neuron", title: "neuron", cwd: "~/OrinTech/NEURON", isActive: true),
                VectorCodeTerminalTab(id: "neuron-next", projectId: "neuron", title: "next", cwd: "~/OrinTech/NEURON"),
            ],
        ]
    )
    let editorCollisionModel = VectorCodeMobileWorkspaceModel(snapshot: collisionSnapshot)
    let backgroundEditor = editorCollisionModel.snapshot.editorsByProject["neuron"]?.first
    precondition(backgroundEditor != nil)
    editorCollisionModel.closeEditor(backgroundEditor!)
    precondition(editorCollisionModel.selectedProject?.id == "job-board")
    precondition(editorCollisionModel.selectedEditorId == "shared-editor")
    precondition(editorCollisionModel.selectedEditor?.projectId == "job-board")
    precondition(editorCollisionModel.editorDraft == "# job")

    let terminalCollisionRelayClient = VectorCodeRelayLoopbackClient(snapshot: collisionSnapshot)
    let terminalCollisionWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: terminalCollisionRelayClient)
    let terminalCollisionModel = VectorCodeMobileWorkspaceModel(snapshot: collisionSnapshot, remoteWorkspaceClient: terminalCollisionWorkspaceClient)
    try terminalCollisionModel.pair(from: payloadJSON, phoneId: "phone-terminal-collision")
    terminalCollisionModel.connectToDesktop()
    try await waitUntil("terminal collision model connected") {
        terminalCollisionModel.isRemoteConnected
    }
    let backgroundTerminal = terminalCollisionModel.snapshot.terminalsByProject["neuron"]?.first
    precondition(backgroundTerminal != nil)
    terminalCollisionModel.closeTerminal(backgroundTerminal!)
    precondition(terminalCollisionModel.selectedProject?.id == "job-board")
    precondition(terminalCollisionModel.selectedTerminalId == "shared-terminal")
    precondition(terminalCollisionModel.selectedTerminal?.projectId == "job-board")
    try await waitUntil("background terminal close stays scoped to source project") {
        let envelopes = await terminalCollisionRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .terminalControl
                && $0.projectId == "neuron"
                && $0.payloadString("terminalId") == "shared-terminal"
                && $0.payloadString("command") == "close"
        }
    }

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

    let copyRelayClient = VectorCodeRelayLoopbackClient(snapshot: .sample)
    let copyWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: copyRelayClient)
    let copyModel = VectorCodeMobileWorkspaceModel(snapshot: .sample, remoteWorkspaceClient: copyWorkspaceClient)
    try copyModel.pair(from: payloadJSON, phoneId: "phone-copy")
    copyModel.connectToDesktop()
    try await waitUntil("copy model connected") {
        copyModel.isRemoteConnected
    }
    precondition(copyModel.isRemoteConnected)
    let copySource = copyModel.snapshot.filesByProject["job-board"]?.first { $0.path == "README.md" }
    let copyDestinationProject = copyModel.snapshot.projects.first { $0.id == "neuron" }
    precondition(copySource != nil)
    precondition(copyDestinationProject != nil)
    copyModel.copyFile(copySource!, to: copyDestinationProject!, destinationPath: "COPIED.md")
    try await waitUntil("top-level copy refreshed destination project") {
        let envelopes = await copyRelayClient.sentEnvelopes
        return envelopes.last?.action == .stateRead && envelopes.last?.projectId == "neuron"
    }
    let copyEnvelopes = await copyRelayClient.sentEnvelopes
    precondition(copyEnvelopes.contains { $0.action == .fileCopy && $0.projectId == "job-board" && $0.payloadString("targetProjectId") == "neuron" })
    precondition(copyEnvelopes.last?.action == .stateRead)
    precondition(copyEnvelopes.last?.projectId == "neuron")
    copyModel.copyFile(copySource!, to: copyDestinationProject!, destinationPath: "products/COPIED.md")
    try await waitUntil("nested copy refreshed destination folder") {
        let envelopes = await copyRelayClient.sentEnvelopes
        return envelopes.last?.action == .fileTreeRead
            && envelopes.last?.projectId == "neuron"
            && envelopes.last?.payloadString("path") == "products"
    }
    let nestedCopyEnvelopes = await copyRelayClient.sentEnvelopes
    precondition(nestedCopyEnvelopes.contains { $0.action == .fileCopy && $0.payloadString("targetPath") == "products/COPIED.md" })
    precondition(nestedCopyEnvelopes.last?.action == .fileTreeRead)
    precondition(nestedCopyEnvelopes.last?.projectId == "neuron")
    precondition(nestedCopyEnvelopes.last?.payloadString("path") == "products")

    var unloadedNestedCopySnapshot = VectorCodeRemoteWorkspaceSnapshot.sample
    unloadedNestedCopySnapshot.filesByProject["neuron"] = [
        VectorCodeFileNode(name: "products", path: "products", kind: .folder, childrenTruncated: true),
        VectorCodeFileNode(name: "README.md", path: "README.md", kind: .file),
    ]
    let deepCopyRelayClient = VectorCodeRelayLoopbackClient(snapshot: unloadedNestedCopySnapshot)
    let deepCopyWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: deepCopyRelayClient)
    let deepCopyModel = VectorCodeMobileWorkspaceModel(snapshot: unloadedNestedCopySnapshot, remoteWorkspaceClient: deepCopyWorkspaceClient)
    try deepCopyModel.pair(from: payloadJSON, phoneId: "phone-deep-copy")
    deepCopyModel.connectToDesktop()
    try await waitUntil("deep copy model connected") {
        deepCopyModel.isRemoteConnected
    }
    deepCopyModel.copyFile(copySource!, to: copyDestinationProject!, destinationPath: "products/audio-lab/COPIED.md")
    try await waitUntil("deep nested copy refreshed destination folder chain") {
        let envelopes = await deepCopyRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .fileTreeRead
                && $0.projectId == "neuron"
                && $0.payloadString("path") == "products"
        } && envelopes.contains {
            $0.action == .fileTreeRead
                && $0.projectId == "neuron"
                && $0.payloadString("path") == "products/audio-lab"
        }
    }
    let deepCopyEnvelopes = await deepCopyRelayClient.sentEnvelopes
    precondition(deepCopyEnvelopes.contains { $0.action == .fileCopy && $0.payloadString("targetPath") == "products/audio-lab/COPIED.md" })
    precondition(containsFile(deepCopyModel.snapshot.filesByProject["neuron"] ?? [], path: "products/audio-lab/COPIED.md"))

    let rawRouteRelayClient = VectorCodeRelayLoopbackClient(snapshot: .sample)
    let rawRouteWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: rawRouteRelayClient)
    let rawRouteModel = VectorCodeMobileWorkspaceModel(snapshot: .sample, remoteWorkspaceClient: rawRouteWorkspaceClient)
    try rawRouteModel.pair(from: payloadJSON, phoneId: "phone-raw-route")
    rawRouteModel.connectToDesktop()
    try await waitUntil("raw route model connected") {
        rawRouteModel.isRemoteConnected
    }
    let inactiveTerminal = rawRouteModel.snapshot.terminalsByProject["job-board"]?.first { $0.id == "job-board:terminal-2" }
    precondition(inactiveTerminal != nil)
    rawRouteModel.sendTerminalData("\u{001B}[A", terminal: inactiveTerminal!)
    try await waitUntil("native terminal input routed to explicit terminal") {
        let envelopes = await rawRouteRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .terminalInput
                && $0.projectId == "job-board"
                && $0.payloadString("terminalId") == "job-board:terminal-2"
                && $0.payloadString("input") == "\u{001B}[A"
                && $0.payloadString("mode") == "raw"
        }
    }
    rawRouteModel.sendTerminalInput("  pwd ", submit: true)
    try await waitUntil("submitted terminal command preserves whitespace") {
        let envelopes = await rawRouteRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .terminalInput
                && $0.payloadString("input") == "  pwd "
                && $0.payloadBool("submit") == true
                && $0.payloadString("mode") == "command"
        }
    }
    let staleTerminal = VectorCodeTerminalTab(
        id: "job-board:closed-terminal",
        projectId: "job-board",
        title: "closed",
        cwd: "~/OrinTech/job_board"
    )
    let rawRouteEnvelopeCount = await rawRouteRelayClient.sentEnvelopes.count
    rawRouteModel.sendTerminalData("\u{001B}[B", terminal: staleTerminal)
    rawRouteModel.resizeTerminal(staleTerminal, cols: 120, rows: 32)
    rawRouteModel.renameTerminal(staleTerminal, title: "stale")
    rawRouteModel.clearTerminal(staleTerminal)
    rawRouteModel.interruptTerminal(staleTerminal)
    rawRouteModel.closeTerminal(staleTerminal)
    await rawRouteModel.refreshTerminalOutput(projectId: staleTerminal.projectId, terminalId: staleTerminal.id)
    try await Task.sleep(nanoseconds: 100_000_000)
    let rawRouteEnvelopeCountAfterStaleActions = await rawRouteRelayClient.sentEnvelopes.count
    precondition(rawRouteEnvelopeCountAfterStaleActions == rawRouteEnvelopeCount)

    var rawInterruptSnapshot = VectorCodeRemoteWorkspaceSnapshot.sample
    if var terminals = rawInterruptSnapshot.terminalsByProject["job-board"] {
        terminals[0].rawOutput = "\u{001B}[32mdavid@Mac job_board %\u{001B}[0m"
        rawInterruptSnapshot.terminalsByProject["job-board"] = terminals
    }
    let rawInterruptRelayClient = VectorCodeRelayLoopbackClient(snapshot: rawInterruptSnapshot)
    let rawInterruptWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: rawInterruptRelayClient)
    let rawInterruptModel = VectorCodeMobileWorkspaceModel(snapshot: rawInterruptSnapshot, remoteWorkspaceClient: rawInterruptWorkspaceClient)
    try rawInterruptModel.pair(from: payloadJSON, phoneId: "phone-raw-interrupt")
    rawInterruptModel.connectToDesktop()
    try await waitUntil("raw interrupt model connected") {
        rawInterruptModel.isRemoteConnected
    }
    precondition(rawInterruptModel.selectedTerminal?.rawOutput?.contains("\u{001B}[32m") == true)
    rawInterruptModel.interruptTerminal(rawInterruptModel.selectedTerminal!)
    precondition(rawInterruptModel.selectedTerminal?.output.last == "^C")
    precondition(rawInterruptModel.selectedTerminal?.rawOutput?.contains("^C") == true)

    var cachedPartialSnapshot = VectorCodeRemoteWorkspaceSnapshot.sample
    if var neuronTerminals = cachedPartialSnapshot.terminalsByProject["neuron"] {
        neuronTerminals[0].rawOutput = "\u{001B}[32mdavid@Mac NEURON % swift test\u{001B}[0m"
        cachedPartialSnapshot.terminalsByProject["neuron"] = neuronTerminals
    }
    var partialTerminalsByProject = cachedPartialSnapshot.terminalsByProject
    if var neuronTerminals = partialTerminalsByProject["neuron"] {
        neuronTerminals[0].rawOutput = nil
        partialTerminalsByProject["neuron"] = neuronTerminals
    }
    let partialRemoteSnapshot = VectorCodeRemoteWorkspaceSnapshot(
        activeProjectId: "job-board",
        projects: VectorCodeRemoteWorkspaceSnapshot.sample.projects,
        filesByProject: [
            "job-board": [
                VectorCodeFileNode(name: "REMOTE.md", path: "REMOTE.md", kind: .file),
            ],
        ],
        editorsByProject: remoteSnapshot.editorsByProject,
        terminalsByProject: partialTerminalsByProject
    )
    let partialRelayClient = VectorCodeRelayLoopbackClient(snapshot: partialRemoteSnapshot)
    let partialWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: partialRelayClient)
    let partialModel = VectorCodeMobileWorkspaceModel(snapshot: cachedPartialSnapshot, remoteWorkspaceClient: partialWorkspaceClient)
    try partialModel.pair(from: payloadJSON, phoneId: "phone-partial")
    partialModel.connectToDesktop()
    try await waitUntil("partial model connected") {
        partialModel.isRemoteConnected
    }
    precondition(partialModel.isRemoteConnected)
    precondition(partialModel.snapshot.filesByProject["job-board"]?.first?.name == "REMOTE.md")
    precondition(partialModel.snapshot.filesByProject["neuron"]?.contains { $0.name == "README.md" } == true)
    precondition(partialModel.snapshot.terminalsByProject["neuron"]?.first?.rawOutput?.contains("\u{001B}[32m") == true)

    let flakyRelayClient = VectorCodeConnectThenFailingStateRelayClient(snapshot: remoteSnapshot)
    let flakyWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: flakyRelayClient)
    let flakyModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: flakyWorkspaceClient)
    try flakyModel.pair(from: payloadJSON, phoneId: "phone-flaky")
    flakyModel.connectToDesktop()
    try await waitUntil("flaky model initially connected") {
        flakyModel.isRemoteConnected
    }
    precondition(flakyModel.isRemoteConnected)
    flakyModel.refreshWorkspace()
    try await waitUntil("flaky model disconnects after failed refresh") {
        !flakyModel.isRemoteConnected
    }
    precondition(!flakyModel.isRemoteConnected)
    precondition(flakyModel.statusText == "Refresh failed")
    let flakyDisconnectCount = await flakyRelayClient.currentDisconnectCount()
    precondition(flakyDisconnectCount == 1)

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

@MainActor
private func waitUntil(_ description: String, timeoutSeconds: TimeInterval = 2, predicate: () async -> Bool) async throws {
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while Date() < deadline {
        if await predicate() {
            return
        }
        try await Task.sleep(nanoseconds: 20_000_000)
    }
    throw VectorCodeVerifierError.timeout(description)
}

private func containsFile(_ nodes: [VectorCodeFileNode], path: String) -> Bool {
    for node in nodes {
        if node.kind == .file && node.path == path {
            return true
        }
        if containsFile(node.children, path: path) {
            return true
        }
    }
    return false
}

private actor VectorCodeRelayLoopbackClient: VectorCodeRelayClientProtocol {
    private let snapshot: VectorCodeRemoteWorkspaceSnapshot
    private(set) var lastSentEnvelope: VectorCodeSentEnvelope?
    private(set) var sentEnvelopes: [VectorCodeSentEnvelope] = []
    private var lastCopyTargetPath: String?

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
        if sentEnvelope.action == .fileCopy {
            lastCopyTargetPath = sentEnvelope.payloadString("targetPath")
        }
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
            if lastSentEnvelope?.payloadString("path") == "products/audio-lab" {
                return try response(
                    VectorCodeFileTreeResponse(nodes: [VectorCodeFileNode(name: "COPIED.md", path: "products/audio-lab/COPIED.md", kind: .file)]),
                    action: .fileTreeRead
                )
            }
            if lastSentEnvelope?.payloadString("path") == "products" {
                if lastCopyTargetPath == "products/audio-lab/COPIED.md" {
                    return try response(
                        VectorCodeFileTreeResponse(nodes: [
                            VectorCodeFileNode(name: "audio-lab", path: "products/audio-lab", kind: .folder, childrenTruncated: true),
                        ]),
                        action: .fileTreeRead
                    )
                }
                return try response(
                    VectorCodeFileTreeResponse(nodes: [VectorCodeFileNode(name: "COPIED.md", path: "products/COPIED.md", kind: .file)]),
                    action: .fileTreeRead
                )
            }
            return try response(
                VectorCodeFileTreeResponse(nodes: [VectorCodeFileNode(name: "main.swift", path: "src/main.swift", kind: .file)]),
                action: .fileTreeRead
            )
        case .fileWrite:
            return try response(VectorCodeFileWriteResponse(path: "README.md", version: "v2"), action: .fileWrite)
        case .fileCopy:
            let targetPath = lastCopyTargetPath ?? "COPIED.md"
            return try response(
                VectorCodeFileCopyResponse(path: "README.md", targetPath: targetPath, targetProjectId: "neuron"),
                action: .fileCopy
            )
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

    func payloadString(_ key: String) -> String? {
        guard case .string(let value)? = payloadValue(key) else {
            return nil
        }
        return value
    }

    func payloadBool(_ key: String) -> Bool? {
        guard case .bool(let value)? = payloadValue(key) else {
            return nil
        }
        return value
    }

    private func payloadValue(_ key: String) -> VectorCodeJSONValue? {
        guard let data = payloadJSON.data(using: .utf8),
              let envelope = try? JSONDecoder().decode(VectorCodeRemoteEnvelope<VectorCodeJSONValue>.self, from: data),
              case .object(let payload)? = envelope.payload else {
            return nil
        }
        return payload[key]
    }
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

private actor VectorCodeConnectThenFailingStateRelayClient: VectorCodeRelayClientProtocol {
    private let snapshot: VectorCodeRemoteWorkspaceSnapshot
    private var requestId: String?
    private var stateReadCount = 0
    private(set) var disconnectCount = 0

    init(snapshot: VectorCodeRemoteWorkspaceSnapshot) {
        self.snapshot = snapshot
    }

    func connect(configuration: VectorCodeRelayConfiguration) async throws {}

    func disconnect() async {
        disconnectCount += 1
    }

    func currentDisconnectCount() -> Int {
        disconnectCount
    }

    func send<Payload>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws where Payload: Decodable, Payload: Encodable, Payload: Sendable {
        requestId = envelope.requestId
    }

    func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        stateReadCount += 1
        guard stateReadCount == 1 else {
            throw VectorCodeVerifierRelayError.connectFailed
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

private actor VectorCodeFailingRelayClient: VectorCodeRelayClientProtocol {
    private(set) var disconnectCount = 0

    func connect(configuration: VectorCodeRelayConfiguration) async throws {
        throw VectorCodeVerifierRelayError.connectFailed
    }

    func disconnect() async {
        disconnectCount += 1
    }

    func currentDisconnectCount() -> Int {
        disconnectCount
    }

    func send<Payload>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws where Payload: Decodable, Payload: Encodable, Payload: Sendable {
        throw VectorCodeVerifierRelayError.connectFailed
    }

    func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        throw VectorCodeVerifierRelayError.connectFailed
    }
}

private enum VectorCodeVerifierRelayError: Error {
    case connectFailed
}

private enum VectorCodeVerifierError: Error, LocalizedError {
    case timeout(String)

    var errorDescription: String? {
        switch self {
        case .timeout(let description):
            "Timed out waiting for \(description)."
        }
    }
}
