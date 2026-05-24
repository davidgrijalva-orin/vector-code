import Foundation

public struct VectorCodeEmptyPayload: Codable, Equatable, Sendable {
    public init() {}
}

public actor VectorCodeRemoteWorkspaceClient {
    private let relayClient: any VectorCodeRelayClientProtocol
    private let requestGate = VectorCodeAsyncRequestGate()

    public init(relayClient: any VectorCodeRelayClientProtocol = VectorCodeRelayClient()) {
        self.relayClient = relayClient
    }

    public func connect(configuration: VectorCodeRelayConfiguration) async throws {
        try await relayClient.connect(configuration: configuration)
    }

    public func disconnect() async {
        await relayClient.disconnect()
    }

    public func readState(projectId: String? = nil) async throws -> VectorCodeRemoteWorkspaceSnapshot {
        try await request(
            action: .stateRead,
            projectId: projectId,
            payload: VectorCodeEmptyPayload(),
            responseType: VectorCodeRemoteWorkspaceSnapshot.self
        )
    }

    public func readFile(projectId: String, path: String) async throws -> VectorCodeFileReadResponse {
        try await request(
            action: .fileRead,
            projectId: projectId,
            payload: VectorCodeFileReadRequest(path: path),
            responseType: VectorCodeFileReadResponse.self
        )
    }

    public func readFileTree(projectId: String, path: String? = nil) async throws -> VectorCodeFileTreeResponse {
        try await request(
            action: .fileTreeRead,
            projectId: projectId,
            payload: VectorCodeFileTreeReadRequest(path: path),
            responseType: VectorCodeFileTreeResponse.self
        )
    }

    public func writeFile(projectId: String, path: String, content: String, expectedVersion: String? = nil) async throws -> VectorCodeFileWriteResponse {
        try await request(
            action: .fileWrite,
            projectId: projectId,
            payload: VectorCodeFileWriteRequest(path: path, content: content, expectedVersion: expectedVersion),
            responseType: VectorCodeFileWriteResponse.self
        )
    }

    public func moveFile(projectId: String, path: String, targetPath: String, targetProjectId: String? = nil, overwrite: Bool = false) async throws -> VectorCodeFileMoveResponse {
        try await request(
            action: .fileMove,
            projectId: projectId,
            payload: VectorCodeFileMoveRequest(path: path, targetPath: targetPath, targetProjectId: targetProjectId, overwrite: overwrite),
            responseType: VectorCodeFileMoveResponse.self
        )
    }

    public func copyFile(projectId: String, path: String, targetProjectId: String, targetPath: String, overwrite: Bool = false) async throws -> VectorCodeFileCopyResponse {
        try await request(
            action: .fileCopy,
            projectId: projectId,
            payload: VectorCodeFileCopyRequest(path: path, targetPath: targetPath, targetProjectId: targetProjectId, overwrite: overwrite),
            responseType: VectorCodeFileCopyResponse.self
        )
    }

    public func createTerminal(projectId: String, title: String? = nil, cwd: String? = nil) async throws -> VectorCodeTerminalTab {
        try await request(
            action: .terminalCreate,
            projectId: projectId,
            payload: VectorCodeTerminalCreateRequest(title: title, cwd: cwd),
            responseType: VectorCodeTerminalTab.self
        )
    }

    public func sendTerminalInput(projectId: String, terminalId: String, input: String, submit: Bool = false, mode: VectorCodeTerminalInputRequest.Mode? = nil) async throws -> VectorCodeTerminalInputResponse {
        try await request(
            action: .terminalInput,
            projectId: projectId,
            payload: VectorCodeTerminalInputRequest(terminalId: terminalId, input: input, submit: submit, mode: mode),
            responseType: VectorCodeTerminalInputResponse.self
        )
    }

    public func readTerminalOutput(projectId: String, terminalId: String) async throws -> VectorCodeTerminalOutputResponse {
        try await request(
            action: .terminalOutput,
            projectId: projectId,
            payload: VectorCodeTerminalOutputRequest(terminalId: terminalId),
            responseType: VectorCodeTerminalOutputResponse.self
        )
    }

    public func controlTerminal(
        projectId: String,
        terminalId: String,
        command: VectorCodeTerminalControlRequest.Command,
        cols: Int? = nil,
        rows: Int? = nil,
        title: String? = nil
    ) async throws -> VectorCodeTerminalControlResponse {
        try await request(
            action: .terminalControl,
            projectId: projectId,
            payload: VectorCodeTerminalControlRequest(terminalId: terminalId, command: command, cols: cols, rows: rows, title: title),
            responseType: VectorCodeTerminalControlResponse.self
        )
    }

    private func request<RequestPayload: Codable & Sendable, ResponsePayload: Codable & Sendable>(
        action: VectorCodeRemoteAction,
        projectId: String?,
        payload: RequestPayload,
        responseType: ResponsePayload.Type
    ) async throws -> ResponsePayload {
        try await requestGate.run {
            let envelope = VectorCodeRemoteEnvelope(
                action: action,
                projectId: projectId,
                payload: payload
            )
            try await relayClient.send(envelope)
            let response = try await receiveMatchingEnvelope(requestId: envelope.requestId, action: action, responseType: responseType)
            if let error = response.error {
                throw VectorCodeRemoteWorkspaceClientError.remoteError(error)
            }
            guard response.kind == .response else {
                throw VectorCodeRemoteWorkspaceClientError.invalidResponse
            }
            guard response.requestId == envelope.requestId else {
                throw VectorCodeRemoteWorkspaceClientError.unexpectedRequestId(expected: envelope.requestId, actual: response.requestId)
            }
            guard response.action == action else {
                throw VectorCodeRemoteWorkspaceClientError.unexpectedAction(expected: action, actual: response.action)
            }
            guard let payload = response.payload else {
                throw VectorCodeRemoteWorkspaceClientError.missingPayload
            }
            return payload
        }
    }

    private func receiveMatchingEnvelope<ResponsePayload: Codable & Sendable>(
        requestId: String,
        action: VectorCodeRemoteAction,
        responseType: ResponsePayload.Type
    ) async throws -> VectorCodeRemoteEnvelope<ResponsePayload> {
        while true {
            let response = try await relayClient.receiveEnvelope()
            guard response.requestId == requestId else {
                continue
            }
            if let error = response.error {
                return VectorCodeRemoteEnvelope<ResponsePayload>(
                    kind: response.kind,
                    protocolVersion: response.protocolVersion,
                    requestId: response.requestId,
                    action: response.action,
                    projectId: response.projectId,
                    error: error
                )
            }
            guard response.kind == .response else {
                throw VectorCodeRemoteWorkspaceClientError.invalidResponse
            }
            guard response.action == action else {
                throw VectorCodeRemoteWorkspaceClientError.unexpectedAction(expected: action, actual: response.action)
            }
            let payload = try response.payload.map { payload in
                let data = try JSONEncoder().encode(payload)
                return try JSONDecoder().decode(responseType, from: data)
            }
            return VectorCodeRemoteEnvelope<ResponsePayload>(
                kind: response.kind,
                protocolVersion: response.protocolVersion,
                requestId: response.requestId,
                action: response.action,
                projectId: response.projectId,
                payload: payload,
                error: response.error
            )
        }
    }
}

public enum VectorCodeRemoteWorkspaceClientError: Error, LocalizedError {
    case missingPayload
    case invalidResponse
    case remoteError(VectorCodeRemoteError)
    case unexpectedAction(expected: VectorCodeRemoteAction, actual: VectorCodeRemoteAction)
    case unexpectedRequestId(expected: String, actual: String)

    public var errorDescription: String? {
        switch self {
        case .missingPayload:
            "The desktop did not return a payload."
        case .invalidResponse:
            "The desktop returned a non-response envelope."
        case .remoteError(let error):
            "\(error.code): \(error.message)"
        case .unexpectedAction(let expected, let actual):
            "Expected \(expected.rawValue), received \(actual.rawValue)."
        case .unexpectedRequestId(let expected, let actual):
            "Expected response \(expected), received \(actual)."
        }
    }
}

private actor VectorCodeAsyncRequestGate {
    private var isLocked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func run<Value: Sendable>(_ operation: @Sendable () async throws -> Value) async throws -> Value {
        await lock()
        do {
            let value = try await operation()
            unlock()
            return value
        } catch {
            unlock()
            throw error
        }
    }

    private func lock() async {
        if !isLocked {
            isLocked = true
            return
        }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    private func unlock() {
        if waiters.isEmpty {
            isLocked = false
            return
        }
        let next = waiters.removeFirst()
        next.resume()
    }
}
