import Foundation
import VectorCodeMobile

@MainActor
func verifyVectorCodeMobile() async throws {
    VectorCodePairingStore().clear()

    let expiresAt = VectorCodeISO8601.string(from: Date().addingTimeInterval(300))
    let relayTokenExpiresAt = VectorCodeISO8601.string(from: Date().addingTimeInterval(86_400))
    let relayHost = VectorCodeHosts.canonicalRelayHost
    let payload = VectorCodePairingPayload(
        desktopId: "desktop-1",
        pairingId: "pairing-1",
        desktopPublicKey: "public-key",
        desktopPublicKeyFingerprint: "fingerprint",
        pairingToken: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        relayHost: relayHost,
        userId: VectorCodeHosts.defaultUserId,
        relayToken: "relay-token",
        relayTokenExpiresAt: relayTokenExpiresAt,
        expiresAt: expiresAt
    )
    try payload.validate()

    let payloadData = try JSONEncoder().encode(payload)
    let payloadJSON = String(data: payloadData, encoding: .utf8)!
    let decodedPayload = try VectorCodePairingPayload.decode(from: payloadJSON)
    precondition(decodedPayload == payload)
    try verifySharedProtocolFixtures()

    let relayConfiguration = try VectorCodeRelayConfiguration(pairingPayload: payload, phoneId: "phone-1")
    precondition(relayConfiguration.webSocketURL.absoluteString.contains("/relay"))
    precondition(relayConfiguration.webSocketURL.host == relayHost)
    precondition(relayConfiguration.webSocketURL.absoluteString.contains("role=phone"))
    precondition(relayConfiguration.webSocketURL.absoluteString.contains("deviceId=phone-1"))
    precondition(relayConfiguration.authorizationHeader == "Bearer relay-token")

    let legacyRelayHost = VectorCodeHosts.legacyRelayHosts.sorted().first!
    let legacyRelayPayload = VectorCodePairingPayload(
        desktopId: "desktop-1",
        pairingId: "pairing-legacy",
        desktopPublicKey: "public-key",
        desktopPublicKeyFingerprint: "fingerprint",
        pairingToken: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        relayHost: legacyRelayHost,
        userId: VectorCodeHosts.defaultUserId,
        relayToken: "relay-token",
        relayTokenExpiresAt: relayTokenExpiresAt,
        expiresAt: expiresAt
    )
    precondition(legacyRelayPayload.relayHost == relayHost)
    let legacyRelayConfiguration = try VectorCodeRelayConfiguration(pairingPayload: legacyRelayPayload, phoneId: "phone-1")
    precondition(legacyRelayConfiguration.webSocketURL.host == relayHost)

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

    let layoutSwitchModel = VectorCodeMobileWorkspaceModel(snapshot: .sample)
    let layoutJobBoard = layoutSwitchModel.snapshot.projects.first { $0.id == "job-board" }!
    let layoutNeuron = layoutSwitchModel.snapshot.projects.first { $0.id == "neuron" }!
    layoutSwitchModel.viewport = .projects
    layoutSwitchModel.switchProject(layoutNeuron)
    precondition(layoutSwitchModel.viewport == .files)
    layoutSwitchModel.viewport = .terminal
    layoutSwitchModel.switchProject(layoutJobBoard)
    precondition(layoutSwitchModel.viewport == .terminal)
    precondition(layoutSwitchModel.selectedTerminal?.projectId == "job-board")
    layoutSwitchModel.viewport = .editor
    layoutSwitchModel.switchProject(layoutNeuron)
    precondition(layoutSwitchModel.viewport == .editor)
    precondition(layoutSwitchModel.selectedEditor?.projectId == "neuron")

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

    var dirtyCollisionRemoteSnapshot = collisionSnapshot
    dirtyCollisionRemoteSnapshot.editorsByProject = [
        "job-board": [
            VectorCodeEditorTab(id: "shared-editor", projectId: "job-board", path: "README.md", title: "README.md", language: "markdown", content: "# remote job"),
        ],
        "neuron": [
            VectorCodeEditorTab(id: "shared-editor", projectId: "neuron", path: "README.md", title: "README.md", language: "markdown", content: "# remote neuron"),
        ],
    ]
    let dirtyCollisionRelayClient = VectorCodeRelayLoopbackClient(snapshot: dirtyCollisionRemoteSnapshot)
    let dirtyCollisionWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: dirtyCollisionRelayClient)
    let dirtyCollisionModel = VectorCodeMobileWorkspaceModel(snapshot: collisionSnapshot, remoteWorkspaceClient: dirtyCollisionWorkspaceClient)
    dirtyCollisionModel.editorDraft = "# dirty job\n"
    dirtyCollisionModel.markEditorDirty()
    dirtyCollisionModel.selectEditor(collisionSnapshot.editorsByProject["neuron"]!.first!)
    dirtyCollisionModel.editorDraft = "# dirty neuron\n"
    dirtyCollisionModel.markEditorDirty()
    dirtyCollisionModel.switchProject(jobBoard)
    try dirtyCollisionModel.pair(from: payloadJSON, phoneId: "phone-dirty-editor-collision")
    dirtyCollisionModel.connectToDesktop()
    try await waitUntil("dirty editor collision model connected") {
        dirtyCollisionModel.isRemoteConnected
    }
    dirtyCollisionModel.switchProject(jobBoard)
    precondition(dirtyCollisionModel.editorDraft == "# dirty job\n")
    dirtyCollisionModel.switchProject(neuron)
    precondition(dirtyCollisionModel.editorDraft == "# dirty neuron\n")

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

    let gatedRelayClient = VectorCodeRelayLoopbackClient(snapshot: remoteSnapshot, responseDelayNanoseconds: 120_000_000)
    let gatedWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: gatedRelayClient)
    let gatedFirstRead = Task {
        try await gatedWorkspaceClient.readFile(projectId: "job-board", path: "README.md")
    }
    try await Task.sleep(nanoseconds: 20_000_000)
    let gatedSecondRead = Task {
        try await gatedWorkspaceClient.readFile(projectId: "job-board", path: "README.md")
    }
    try await Task.sleep(nanoseconds: 20_000_000)
    gatedSecondRead.cancel()
    do {
        _ = try await gatedSecondRead.value
        preconditionFailure("Cancelled queued request should not run")
    } catch is CancellationError {}
    let gatedFirstResponse = try await gatedFirstRead.value
    precondition(gatedFirstResponse.content.contains("remote README"))
    let gatedFileReadCount = await gatedRelayClient.sentEnvelopes.filter { $0.action == .fileRead }.count
    precondition(gatedFileReadCount == 1)

    let smokeRelayClient = VectorCodeRelayLoopbackClient(snapshot: remoteSnapshot)
    let smokeWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: smokeRelayClient)
    let smokeModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: smokeWorkspaceClient)
    try smokeModel.pair(from: payloadJSON, phoneId: "phone-smoke")
    smokeModel.connectToDesktop()
    try await waitUntil("remote model smoke connected") {
        smokeModel.isRemoteConnected
    }
    precondition(smokeModel.selectedProject?.id == "job-board")
    let remoteReadme = smokeModel.selectedFiles.first { $0.path == "README.md" }
    precondition(remoteReadme != nil)
    smokeModel.openFile(remoteReadme!)
    try await waitUntil("remote model smoke opened file") {
        smokeModel.selectedEditor?.content?.contains("remote README") == true
    }
    smokeModel.editorDraft = "# Updated from iPhone\n"
    smokeModel.markEditorDirty()
    smokeModel.saveEditor()
    try await waitUntil("remote model smoke saved file") {
        smokeModel.selectedEditor?.isDirty == false && smokeModel.selectedEditor?.version == "v2"
    }
    smokeModel.createTerminal()
    try await waitUntil("remote model smoke created terminal") {
        smokeModel.selectedTerminal?.id == "terminal-2"
    }
    smokeModel.sendTerminalInput("echo mobile", submit: false)
    try await waitUntil("remote model smoke pasted terminal input") {
        let envelopes = await smokeRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .terminalInput
                && $0.payloadString("input") == "echo mobile"
                && $0.payloadString("mode") == "paste"
                && $0.payloadBool("submit") == false
        }
    }
    smokeModel.renameFile(remoteReadme!, to: "README-mobile.md")
    try await waitUntil("remote model smoke renamed file") {
        let envelopes = await smokeRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .fileMove
                && $0.projectId == "job-board"
                && $0.payloadString("targetPath") == "README-mobile.md"
                && $0.payloadBool("overwrite") == false
        }
    }

    let dirtyOpenRelayClient = VectorCodeRelayLoopbackClient(snapshot: remoteSnapshot)
    let dirtyOpenWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: dirtyOpenRelayClient)
    let dirtyOpenModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: dirtyOpenWorkspaceClient)
    try dirtyOpenModel.pair(from: payloadJSON, phoneId: "phone-dirty-open")
    dirtyOpenModel.connectToDesktop()
    try await waitUntil("dirty open model connected") {
        dirtyOpenModel.isRemoteConnected
    }
    let dirtyOpenReadme = dirtyOpenModel.selectedFiles.first { $0.path == "README.md" }
    precondition(dirtyOpenReadme != nil)
    dirtyOpenModel.editorDraft = "# Dirty local draft\n"
    dirtyOpenModel.markEditorDirty()
    let dirtyOpenFileReadCount = await dirtyOpenRelayClient.sentEnvelopes.filter { $0.action == .fileRead }.count
    dirtyOpenModel.openFile(dirtyOpenReadme!)
    precondition(dirtyOpenModel.statusText == "Unsaved draft open")
    precondition(dirtyOpenModel.editorDraft == "# Dirty local draft\n")
    let dirtyOpenFileReadCountAfter = await dirtyOpenRelayClient.sentEnvelopes.filter { $0.action == .fileRead }.count
    precondition(dirtyOpenFileReadCountAfter == dirtyOpenFileReadCount)

    let staleOpenRelayClient = VectorCodeRelayLoopbackClient(snapshot: .sample, responseDelayNanoseconds: 75_000_000)
    let staleOpenWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: staleOpenRelayClient)
    let staleOpenModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: staleOpenWorkspaceClient)
    try staleOpenModel.pair(from: payloadJSON, phoneId: "phone-stale-open")
    staleOpenModel.connectToDesktop()
    try await waitUntil("stale open model connected") {
        staleOpenModel.isRemoteConnected
    }
    let staleOpenReadme = staleOpenModel.selectedFiles.first { $0.path == "README.md" }
    precondition(staleOpenReadme != nil)
    staleOpenModel.openFile(staleOpenReadme!)
    staleOpenModel.switchProject(neuron)
    try await Task.sleep(nanoseconds: 160_000_000)
    precondition(staleOpenModel.selectedProject?.id == "neuron")
    precondition(staleOpenModel.viewport == .files)

    let staleFailedOpenRelayClient = VectorCodeRelayLoopbackClient(snapshot: .sample, failingFileReadAttempts: 1, responseDelayNanoseconds: 75_000_000)
    let staleFailedOpenWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: staleFailedOpenRelayClient)
    let staleFailedOpenModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: staleFailedOpenWorkspaceClient)
    try staleFailedOpenModel.pair(from: payloadJSON, phoneId: "phone-stale-failed-open")
    staleFailedOpenModel.connectToDesktop()
    try await waitUntil("stale failed open model connected") {
        staleFailedOpenModel.isRemoteConnected
    }
    let staleFailedOpenReadme = staleFailedOpenModel.selectedFiles.first { $0.path == "README.md" }
    precondition(staleFailedOpenReadme != nil)
    staleFailedOpenModel.openFile(staleFailedOpenReadme!)
    staleFailedOpenModel.switchProject(neuron)
    try await Task.sleep(nanoseconds: 160_000_000)
    precondition(staleFailedOpenModel.selectedProject?.id == "neuron")
    precondition(staleFailedOpenModel.viewport == .files)
    precondition(staleFailedOpenModel.statusText == "Connected")
    precondition(staleFailedOpenModel.isRemoteConnected)

    let conflictRelayClient = VectorCodeRelayLoopbackClient(snapshot: .sample, conflictingWriteAttempts: 1)
    let conflictWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: conflictRelayClient)
    let conflictModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: conflictWorkspaceClient)
    try conflictModel.pair(from: payloadJSON, phoneId: "phone-conflict")
    conflictModel.connectToDesktop()
    try await waitUntil("conflict model connected") {
        conflictModel.isRemoteConnected
    }
    let conflictReadme = conflictModel.selectedFiles.first { $0.path == "README.md" }
    precondition(conflictReadme != nil)
    conflictModel.openFile(conflictReadme!)
    try await waitUntil("conflict model opened file") {
        conflictModel.selectedEditor?.version == "v1"
    }
    conflictModel.editorDraft = "# Phone draft\n"
    conflictModel.markEditorDirty()
    conflictModel.saveEditor()
    try await waitUntil("conflict model reports conflict") {
        conflictModel.selectedEditorConflict != nil
    }
    precondition(conflictModel.statusText == "File changed on desktop")
    precondition(conflictModel.selectedEditor?.isDirty == true)
    precondition(conflictModel.selectedEditorConflict?.desktopContent.contains("remote README") == true)
    conflictModel.saveEditor()
    precondition(conflictModel.statusText == "Resolve file conflict")
    let conflictFileReadCount = await conflictRelayClient.sentEnvelopes.filter { $0.action == .fileRead }.count
    conflictModel.openFile(conflictReadme!)
    precondition(conflictModel.statusText == "Resolve file conflict")
    precondition(conflictModel.editorDraft == "# Phone draft\n")
    let conflictFileReadCountAfter = await conflictRelayClient.sentEnvelopes.filter { $0.action == .fileRead }.count
    precondition(conflictFileReadCountAfter == conflictFileReadCount)
    conflictModel.switchProject(neuron)
    precondition(conflictModel.selectedEditorConflict == nil)
    conflictModel.switchProject(jobBoard)
    precondition(conflictModel.selectedEditorConflict != nil)
    precondition(conflictModel.editorDraft == "# Phone draft\n")
    conflictModel.keepDesktopEditorConflict()
    precondition(conflictModel.selectedEditorConflict == nil)
    precondition(conflictModel.selectedEditor?.isDirty == false)
    precondition(conflictModel.editorDraft.contains("remote README"))

    let overwriteConflictRelayClient = VectorCodeRelayLoopbackClient(snapshot: remoteSnapshot, conflictingWriteAttempts: 1)
    let overwriteConflictWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: overwriteConflictRelayClient)
    let overwriteConflictModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: overwriteConflictWorkspaceClient)
    try overwriteConflictModel.pair(from: payloadJSON, phoneId: "phone-overwrite-conflict")
    overwriteConflictModel.connectToDesktop()
    try await waitUntil("overwrite conflict model connected") {
        overwriteConflictModel.isRemoteConnected
    }
    let overwriteReadme = overwriteConflictModel.selectedFiles.first { $0.path == "README.md" }
    precondition(overwriteReadme != nil)
    overwriteConflictModel.openFile(overwriteReadme!)
    try await waitUntil("overwrite conflict model opened file") {
        overwriteConflictModel.selectedEditor?.version == "v1"
    }
    overwriteConflictModel.editorDraft = "# Overwrite draft\n"
    overwriteConflictModel.markEditorDirty()
    overwriteConflictModel.saveEditor()
    try await waitUntil("overwrite conflict is visible") {
        overwriteConflictModel.selectedEditorConflict != nil
    }
    overwriteConflictModel.overwriteEditorConflict()
    try await waitUntil("overwrite conflict saved") {
        overwriteConflictModel.selectedEditor?.isDirty == false
            && overwriteConflictModel.selectedEditor?.version == "v2"
            && overwriteConflictModel.selectedEditorConflict == nil
    }
    let overwriteConflictEnvelopes = await overwriteConflictRelayClient.sentEnvelopes
    precondition(overwriteConflictEnvelopes.filter { $0.action == .fileWrite }.count == 2)
    precondition(overwriteConflictEnvelopes.contains { $0.action == .fileWrite && $0.payloadString("expectedVersion") == "v1" })

    var switchedConflictSnapshot = remoteSnapshot
    let switchedConflictPackageEditor = VectorCodeEditorTab(
        id: "job-board:package.json",
        projectId: "job-board",
        path: "package.json",
        title: "package.json",
        language: "json",
        content: "{ \"name\": \"job-board\" }\n",
        version: "pkg-v1"
    )
    switchedConflictSnapshot.editorsByProject["job-board", default: []].append(switchedConflictPackageEditor)
    let switchedConflictRelayClient = VectorCodeRelayLoopbackClient(
        snapshot: switchedConflictSnapshot,
        conflictingWriteAttempts: 1,
        responseDelayNanoseconds: 50_000_000
    )
    let switchedConflictWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: switchedConflictRelayClient)
    let switchedConflictModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: switchedConflictWorkspaceClient)
    try switchedConflictModel.pair(from: payloadJSON, phoneId: "phone-switched-conflict")
    switchedConflictModel.connectToDesktop()
    try await waitUntil("switched conflict model connected") {
        switchedConflictModel.isRemoteConnected
    }
    let switchedConflictReadme = switchedConflictModel.selectedEditor!
    switchedConflictModel.editorDraft = "# Switched conflict draft\n"
    switchedConflictModel.markEditorDirty()
    switchedConflictModel.saveEditor()
    switchedConflictModel.selectEditor(switchedConflictPackageEditor)
    try await waitUntil("switched conflict is stored") {
        switchedConflictModel.pendingEditorConflict != nil
    }
    precondition(switchedConflictModel.selectedEditor?.id == switchedConflictPackageEditor.id)
    precondition(switchedConflictModel.editorDraft == switchedConflictPackageEditor.content)
    precondition(switchedConflictModel.selectedEditorConflict == nil)
    precondition(switchedConflictModel.statusText == "Connected")
    switchedConflictModel.selectEditor(switchedConflictReadme)
    precondition(switchedConflictModel.selectedEditorConflict != nil)
    precondition(switchedConflictModel.editorDraft == "# Switched conflict draft\n")
    precondition(switchedConflictModel.statusText == "Resolve file conflict")

    let failedOverwriteRelayClient = VectorCodeRelayLoopbackClient(
        snapshot: remoteSnapshot,
        conflictingWriteAttempts: 1,
        failingWriteAttempts: 1
    )
    let failedOverwriteWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: failedOverwriteRelayClient)
    let failedOverwriteModel = VectorCodeMobileWorkspaceModel(remoteWorkspaceClient: failedOverwriteWorkspaceClient)
    try failedOverwriteModel.pair(from: payloadJSON, phoneId: "phone-failed-overwrite")
    failedOverwriteModel.connectToDesktop()
    try await waitUntil("failed overwrite model connected") {
        failedOverwriteModel.isRemoteConnected
    }
    let failedOverwriteReadme = failedOverwriteModel.selectedFiles.first { $0.path == "README.md" }
    precondition(failedOverwriteReadme != nil)
    failedOverwriteModel.openFile(failedOverwriteReadme!)
    try await waitUntil("failed overwrite model opened file") {
        failedOverwriteModel.selectedEditor?.version == "v1"
    }
    failedOverwriteModel.editorDraft = "# Failed overwrite draft\n"
    failedOverwriteModel.markEditorDirty()
    failedOverwriteModel.saveEditor()
    try await waitUntil("failed overwrite conflict is visible") {
        failedOverwriteModel.selectedEditorConflict != nil
    }
    failedOverwriteModel.overwriteEditorConflict()
    try await waitUntil("failed overwrite keeps conflict") {
        failedOverwriteModel.statusText == "Save failed"
    }
    precondition(failedOverwriteModel.selectedEditorConflict != nil)
    precondition(failedOverwriteModel.selectedEditor?.isDirty == true)

    let multiConflictRelayClient = VectorCodeRelayLoopbackClient(snapshot: .sample, conflictingWriteAttempts: 2)
    let multiConflictWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: multiConflictRelayClient)
    let multiConflictModel = VectorCodeMobileWorkspaceModel(snapshot: .sample, remoteWorkspaceClient: multiConflictWorkspaceClient)
    try multiConflictModel.pair(from: payloadJSON, phoneId: "phone-multi-conflict")
    multiConflictModel.connectToDesktop()
    try await waitUntil("multi conflict model connected") {
        multiConflictModel.isRemoteConnected
    }
    multiConflictModel.editorDraft = "# Job conflict draft\n"
    multiConflictModel.markEditorDirty()
    multiConflictModel.saveEditor()
    try await waitUntil("multi conflict job conflict is visible") {
        multiConflictModel.selectedEditorConflict != nil
    }
    multiConflictModel.editorDraft = "# Job conflict revised draft\n"
    multiConflictModel.markEditorDirty()
    multiConflictModel.switchProject(neuron)
    multiConflictModel.editorDraft = "# Neuron conflict draft\n"
    multiConflictModel.markEditorDirty()
    multiConflictModel.saveEditor()
    try await waitUntil("multi conflict neuron conflict is visible") {
        multiConflictModel.selectedEditorConflict != nil
    }
    precondition(multiConflictModel.editorDraft == "# Neuron conflict draft\n")
    multiConflictModel.switchProject(jobBoard)
    precondition(multiConflictModel.selectedEditorConflict?.localContent == "# Job conflict revised draft\n")
    precondition(multiConflictModel.editorDraft == "# Job conflict revised draft\n")
    multiConflictModel.switchProject(neuron)
    precondition(multiConflictModel.selectedEditorConflict?.localContent == "# Neuron conflict draft\n")

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
    copyModel.copyFile(copySource!, to: copyDestinationProject!, destinationPath: "FORCE.md", overwrite: true)
    try await waitUntil("copy overwrite flag is forwarded") {
        let envelopes = await copyRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .fileCopy
                && $0.payloadString("targetPath") == "FORCE.md"
                && $0.payloadBool("overwrite") == true
        }
    }
    copyModel.switchProject(copyDestinationProject!)
    copyModel.copyFile(copySource!, from: jobBoard, to: copyDestinationProject!, destinationPath: "SOURCE-STABLE.md")
    try await waitUntil("copy uses captured source project") {
        let envelopes = await copyRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .fileCopy
                && $0.projectId == "job-board"
                && $0.payloadString("targetPath") == "SOURCE-STABLE.md"
        }
    }
    copyModel.renameFile(copySource!, in: jobBoard, to: "README-renamed.md")
    try await waitUntil("rename uses captured source project") {
        let envelopes = await copyRelayClient.sentEnvelopes
        return envelopes.contains {
            $0.action == .fileMove
                && $0.projectId == "job-board"
                && $0.payloadString("targetPath") == "README-renamed.md"
        }
    }

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

    let staleTerminalCreateRelayClient = VectorCodeRelayLoopbackClient(snapshot: .sample, responseDelayNanoseconds: 75_000_000)
    let staleTerminalCreateWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: staleTerminalCreateRelayClient)
    let staleTerminalCreateModel = VectorCodeMobileWorkspaceModel(snapshot: .sample, remoteWorkspaceClient: staleTerminalCreateWorkspaceClient)
    try staleTerminalCreateModel.pair(from: payloadJSON, phoneId: "phone-stale-terminal-create")
    staleTerminalCreateModel.connectToDesktop()
    try await waitUntil("stale terminal create model connected") {
        staleTerminalCreateModel.isRemoteConnected
    }
    staleTerminalCreateModel.createTerminal()
    staleTerminalCreateModel.switchProject(neuron)
    try await Task.sleep(nanoseconds: 160_000_000)
    precondition(staleTerminalCreateModel.selectedProject?.id == "neuron")
    precondition(staleTerminalCreateModel.viewport == .files)
    precondition(staleTerminalCreateModel.selectedTerminal?.projectId == "neuron")
    staleTerminalCreateModel.switchProject(jobBoard)
    precondition(staleTerminalCreateModel.selectedTerminal?.id == "terminal-2")

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

    var backgroundDirtyRemoteSnapshot = VectorCodeRemoteWorkspaceSnapshot.sample
    backgroundDirtyRemoteSnapshot.editorsByProject["job-board"] = []
    let backgroundDirtyRelayClient = VectorCodeRelayLoopbackClient(snapshot: backgroundDirtyRemoteSnapshot)
    let backgroundDirtyWorkspaceClient = VectorCodeRemoteWorkspaceClient(relayClient: backgroundDirtyRelayClient)
    let backgroundDirtyModel = VectorCodeMobileWorkspaceModel(snapshot: .sample, remoteWorkspaceClient: backgroundDirtyWorkspaceClient)
    backgroundDirtyModel.editorDraft = "# Unsaved on phone\n"
    backgroundDirtyModel.markEditorDirty()
    precondition(backgroundDirtyModel.selectedEditor?.isDirty == true)
    backgroundDirtyModel.switchProject(neuron)
    try backgroundDirtyModel.pair(from: payloadJSON, phoneId: "phone-background-dirty")
    backgroundDirtyModel.connectToDesktop()
    try await waitUntil("background dirty editor survives refresh") {
        backgroundDirtyModel.isRemoteConnected
    }
    precondition(backgroundDirtyModel.selectedProject?.id == "neuron")
    backgroundDirtyModel.switchProject(jobBoard)
    precondition(backgroundDirtyModel.selectedEditor?.path == "README.md")
    precondition(backgroundDirtyModel.selectedEditor?.isDirty == true)
    precondition(backgroundDirtyModel.editorDraft == "# Unsaved on phone\n")

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

private func verifySharedProtocolFixtures() throws {
    let fixtureURL = try findProtocolFixtureURL()
    let data = try Data(contentsOf: fixtureURL)
    let fixture = try JSONDecoder().decode(VectorCodeMobileProtocolFixture.self, from: data)

    precondition(fixture.protocolVersion == vectorCodeMobileProtocolVersion)
    precondition(fixture.actions == VectorCodeRemoteAction.allCases.map(\.rawValue))
    precondition(fixture.terminalInputModes == VectorCodeTerminalInputRequest.Mode.allCases.map(\.rawValue))
    precondition(fixture.terminalControlCommands == VectorCodeTerminalControlRequest.Command.allCases.map(\.rawValue))
    precondition(fixture.hosts.canonicalHost == VectorCodeHosts.canonicalHost)
    precondition(fixture.hosts.releaseDownloadUrl == VectorCodeHosts.releaseDownloadURL)
    precondition(fixture.hosts.updateFeedUrl == VectorCodeHosts.updateFeedURL)
    precondition(fixture.hosts.canonicalRelayHost == VectorCodeHosts.canonicalRelayHost)
    precondition(fixture.hosts.defaultUserId == VectorCodeHosts.defaultUserId)
    precondition(Set(fixture.hosts.legacyRelayHosts) == VectorCodeHosts.legacyRelayHosts)
    precondition(fixture.hosts.relayHostPattern == VectorCodeGeneratedConfig.relayHostPattern)
    precondition(fixture.hosts.relayHostNormalizationCases.count == VectorCodeGeneratedConfig.relayHostNormalizationCases.count)
    for testCase in fixture.hosts.relayHostNormalizationCases {
        precondition(VectorCodeHosts.normalizeRelayHost(testCase.input) == testCase.normalized)
    }
    for testCase in VectorCodeGeneratedConfig.relayHostNormalizationCases {
        precondition(VectorCodeHosts.normalizeRelayHost(testCase.input) == testCase.normalized)
    }
    precondition(fixture.frameCrypto.nonceBytes == VectorCodeGeneratedConfig.frameNonceBytes)
    precondition(fixture.frameCrypto.tagBytes == VectorCodeGeneratedConfig.frameTagBytes)
    precondition(fixture.frameCrypto.keyBytes == VectorCodeGeneratedConfig.frameKeyBytes)
    precondition(fixture.frameCrypto.base64UrlCases.count == VectorCodeGeneratedConfig.base64URLCases.count)
    for (fixtureCase, generatedCase) in zip(fixture.frameCrypto.base64UrlCases, VectorCodeGeneratedConfig.base64URLCases) {
        precondition(fixtureCase.bytes == generatedCase.bytes)
        precondition(fixtureCase.encoded == generatedCase.encoded)
    }
    for (fileExtension, language) in fixture.languageByExtension {
        precondition(VectorCodeLanguageInference.language(for: "example.\(fileExtension)") == language)
    }

    let terminalInputData = try JSONEncoder().encode(VectorCodeJSONValue.object(fixture.terminalInputRequest))
    let terminalInput = try JSONDecoder().decode(VectorCodeTerminalInputRequest.self, from: terminalInputData)
    precondition(terminalInput.mode == .paste)
    precondition(terminalInput.submit == false)

    let fileCopyData = try JSONEncoder().encode(VectorCodeJSONValue.object(fixture.fileCopyRequest))
    let fileCopy = try JSONDecoder().decode(VectorCodeFileCopyRequest.self, from: fileCopyData)
    precondition(fileCopy.targetProjectId == "neuron")
    precondition(fileCopy.overwrite == false)

    let snapshotData = try JSONEncoder().encode(VectorCodeJSONValue.object(fixture.workspaceSnapshot))
    let snapshot = try JSONDecoder().decode(VectorCodeRemoteWorkspaceSnapshot.self, from: snapshotData)
    precondition(snapshot.activeProjectId == "job-board")
    precondition(snapshot.projects.first?.name == "job_board")
    precondition(snapshot.filesByProject["job-board"]?.first?.path == "README.md")
    precondition(snapshot.terminalsByProject["job-board"]?.first?.rawOutput?.contains("\u{001B}[32m") == true)
}

private func findProtocolFixtureURL() throws -> URL {
    let relativePath = "src/vs/workbench/contrib/vectorCode/common/vectorCodeMobileProtocolFixtures.json"
    var directory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    for _ in 0..<8 {
        let candidate = directory.appendingPathComponent(relativePath)
        if FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }
        directory.deleteLastPathComponent()
    }
    throw VectorCodeVerifierError.missingFixture(relativePath)
}

private struct VectorCodeMobileProtocolFixture: Decodable {
    let protocolVersion: Int
    let actions: [String]
    let terminalInputModes: [String]
    let terminalControlCommands: [String]
    let hosts: VectorCodeMobileHostsFixture
    let frameCrypto: VectorCodeMobileFrameCryptoFixture
    let languageByExtension: [String: String]
    let terminalInputRequest: [String: VectorCodeJSONValue]
    let fileCopyRequest: [String: VectorCodeJSONValue]
    let workspaceSnapshot: [String: VectorCodeJSONValue]
}

private struct VectorCodeMobileHostsFixture: Decodable {
    let canonicalHost: String
    let releaseDownloadUrl: String
    let updateFeedUrl: String
    let canonicalRelayHost: String
    let defaultUserId: String
    let legacyRelayHosts: [String]
    let relayHostPattern: String
    let relayHostNormalizationCases: [VectorCodeMobileRelayHostNormalizationFixture]
}

private struct VectorCodeMobileRelayHostNormalizationFixture: Decodable {
    let input: String
    let normalized: String?
}

private struct VectorCodeMobileFrameCryptoFixture: Decodable {
    let nonceBytes: Int
    let tagBytes: Int
    let keyBytes: Int
    let base64UrlCases: [VectorCodeMobileBase64URLFixture]
}

private struct VectorCodeMobileBase64URLFixture: Decodable {
    let bytes: [UInt8]
    let encoded: String
}

private actor VectorCodeRelayLoopbackClient: VectorCodeRelayClientProtocol {
    private let snapshot: VectorCodeRemoteWorkspaceSnapshot
    private(set) var lastSentEnvelope: VectorCodeSentEnvelope?
    private(set) var sentEnvelopes: [VectorCodeSentEnvelope] = []
    private var lastMoveTargetPath: String?
    private var lastCopyTargetPath: String?
    private var remainingFileReadFailures: Int
    private var remainingWriteConflicts: Int
    private var remainingWriteFailures: Int
    private let responseDelayNanoseconds: UInt64

    init(
        snapshot: VectorCodeRemoteWorkspaceSnapshot,
        failingFileReadAttempts: Int = 0,
        conflictingWriteAttempts: Int = 0,
        failingWriteAttempts: Int = 0,
        responseDelayNanoseconds: UInt64 = 0
    ) {
        self.snapshot = snapshot
        self.remainingFileReadFailures = failingFileReadAttempts
        self.remainingWriteConflicts = conflictingWriteAttempts
        self.remainingWriteFailures = failingWriteAttempts
        self.responseDelayNanoseconds = responseDelayNanoseconds
    }

    func connect(configuration: VectorCodeRelayConfiguration) async throws {}

    func disconnect() async {}

    func send<Payload: Codable & Sendable>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws {
        let payloadJSON = String(data: try JSONEncoder().encode(envelope), encoding: .utf8) ?? ""
        let sentEnvelope = VectorCodeSentEnvelope(action: envelope.action, projectId: envelope.projectId, requestId: envelope.requestId, payloadJSON: payloadJSON)
        lastSentEnvelope = sentEnvelope
        sentEnvelopes.append(sentEnvelope)
        if sentEnvelope.action == .fileMove {
            lastMoveTargetPath = sentEnvelope.payloadString("targetPath")
        }
        if sentEnvelope.action == .fileCopy {
            lastCopyTargetPath = sentEnvelope.payloadString("targetPath")
        }
    }

    func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        switch lastSentEnvelope?.action {
        case .stateRead:
            return try response(snapshot, action: .stateRead)
        case .fileRead:
            try await sleepIfConfigured()
            if remainingFileReadFailures > 0 {
                remainingFileReadFailures -= 1
                return try errorResponse(code: "file_not_found", message: "The desktop file is unavailable.", action: .fileRead)
            }
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
            try await sleepIfConfigured()
            if remainingWriteConflicts > 0 {
                remainingWriteConflicts -= 1
                return try errorResponse(code: "file_modified_since", message: "The desktop file changed since the phone opened it.", action: .fileWrite)
            }
            if remainingWriteFailures > 0 {
                remainingWriteFailures -= 1
                return try errorResponse(code: "write_failed", message: "The desktop could not write the file.", action: .fileWrite)
            }
            return try response(VectorCodeFileWriteResponse(path: "README.md", version: "v2"), action: .fileWrite)
        case .fileMove:
            let targetPath = lastMoveTargetPath ?? "README-mobile.md"
            return try response(
                VectorCodeFileMoveResponse(path: "README.md", targetPath: targetPath, targetProjectId: lastSentEnvelope?.projectId ?? "job-board"),
                action: .fileMove
            )
        case .fileCopy:
            let targetPath = lastCopyTargetPath ?? "COPIED.md"
            return try response(
                VectorCodeFileCopyResponse(path: "README.md", targetPath: targetPath, targetProjectId: "neuron"),
                action: .fileCopy
            )
        case .terminalCreate:
            try await sleepIfConfigured()
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
        try vectorCodeVerifierResponseEnvelope(
            requestId: lastSentEnvelope?.requestId,
            fallbackRequestId: "loopback-response",
            action: action,
            payload: payload
        )
    }

    private func errorResponse(
        code: String,
        message: String,
        action: VectorCodeRemoteAction
    ) throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        VectorCodeRemoteEnvelope(
            kind: .response,
            requestId: lastSentEnvelope?.requestId ?? "loopback-error-response",
            action: action,
            error: VectorCodeRemoteError(code: code, message: message)
        )
    }

    private func sleepIfConfigured() async throws {
        if responseDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: responseDelayNanoseconds)
        }
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

private func vectorCodeVerifierJSONPayload<Payload: Encodable>(_ payload: Payload) throws -> VectorCodeJSONValue {
    try JSONDecoder().decode(VectorCodeJSONValue.self, from: JSONEncoder().encode(payload))
}

private func vectorCodeVerifierResponseEnvelope<Payload: Encodable>(
    requestId: String?,
    fallbackRequestId: String,
    action: VectorCodeRemoteAction,
    payload: Payload
) throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
    try VectorCodeRemoteEnvelope(
        kind: .response,
        requestId: requestId ?? fallbackRequestId,
        action: action,
        payload: vectorCodeVerifierJSONPayload(payload)
    )
}

private struct VectorCodeVerifierRelayState {
    private(set) var requestId: String?
    private(set) var disconnectCount = 0

    mutating func recordDisconnect() {
        disconnectCount += 1
    }

    mutating func recordSend<Payload>(_ envelope: VectorCodeRemoteEnvelope<Payload>) {
        requestId = envelope.requestId
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
            return try vectorCodeVerifierResponseEnvelope(
                requestId: "stale-response",
                fallbackRequestId: "stale-response",
                action: .terminalOutput,
                payload: VectorCodeTerminalOutputResponse(terminalId: "old-terminal", output: ["stale"])
            )
        }

        return try vectorCodeVerifierResponseEnvelope(
            requestId: requestId,
            fallbackRequestId: "state-response",
            action: .stateRead,
            payload: snapshot
        )
    }
}

private actor VectorCodeConnectThenFailingStateRelayClient: VectorCodeRelayClientProtocol {
    private let snapshot: VectorCodeRemoteWorkspaceSnapshot
    private var relayState = VectorCodeVerifierRelayState()
    private var stateReadCount = 0

    init(snapshot: VectorCodeRemoteWorkspaceSnapshot) {
        self.snapshot = snapshot
    }

    func connect(configuration: VectorCodeRelayConfiguration) async throws {}

    func disconnect() async {
        relayState.recordDisconnect()
    }

    func currentDisconnectCount() -> Int {
        relayState.disconnectCount
    }

    func send<Payload>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws where Payload: Decodable, Payload: Encodable, Payload: Sendable {
        relayState.recordSend(envelope)
    }

    func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        stateReadCount += 1
        guard stateReadCount == 1 else {
            throw VectorCodeVerifierRelayError.connectFailed
        }

        return try vectorCodeVerifierResponseEnvelope(
            requestId: relayState.requestId,
            fallbackRequestId: "state-response",
            action: .stateRead,
            payload: snapshot
        )
    }
}

private actor VectorCodeFailingRelayClient: VectorCodeRelayClientProtocol {
    private var relayState = VectorCodeVerifierRelayState()

    func connect(configuration: VectorCodeRelayConfiguration) async throws {
        throw VectorCodeVerifierRelayError.connectFailed
    }

    func send<Payload>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws where Payload: Decodable, Payload: Encodable, Payload: Sendable {
        relayState.recordSend(envelope)
        throw VectorCodeVerifierRelayError.connectFailed
    }

    func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        throw VectorCodeVerifierRelayError.connectFailed
    }

    func disconnect() async {
        relayState.recordDisconnect()
    }

    func currentDisconnectCount() -> Int {
        relayState.disconnectCount
    }
}

private enum VectorCodeVerifierRelayError: Error {
    case connectFailed
}

private enum VectorCodeVerifierError: Error, LocalizedError {
    case missingFixture(String)
    case timeout(String)

    var errorDescription: String? {
        switch self {
        case .missingFixture(let path):
            "Missing protocol fixture at \(path)."
        case .timeout(let description):
            "Timed out waiting for \(description)."
        }
    }
}
