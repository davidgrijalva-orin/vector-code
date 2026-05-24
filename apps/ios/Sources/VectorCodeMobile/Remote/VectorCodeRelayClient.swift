import Foundation

public protocol VectorCodeRelayClientProtocol: Sendable {
    func connect(configuration: VectorCodeRelayConfiguration) async throws
    func disconnect() async
    func send<Payload: Codable & Sendable>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws
    func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue>
}

public actor VectorCodeRelayClient: VectorCodeRelayClientProtocol {
    private var task: URLSessionWebSocketTask?
    private var configuration: VectorCodeRelayConfiguration?
    private var sequence = 0
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func connect(configuration: VectorCodeRelayConfiguration) async throws {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        self.configuration = nil
        sequence = 0

        var request = URLRequest(url: configuration.webSocketURL)
        if let authorizationHeader = configuration.authorizationHeader {
            request.setValue(authorizationHeader, forHTTPHeaderField: "Authorization")
        }

        let nextTask = session.webSocketTask(with: request)
        nextTask.resume()
        task = nextTask
        self.configuration = configuration
    }

    public func disconnect() async {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        configuration = nil
        sequence = 0
    }

    public func send<Payload: Codable & Sendable>(_ envelope: VectorCodeRemoteEnvelope<Payload>) async throws {
        guard let task, let configuration else {
            throw VectorCodeRelayClientError.notConnected
        }
        sequence += 1
        let frame = try VectorCodeRelayFrameCrypto.encrypt(
            envelope,
            header: VectorCodeRelayFrameHeader(
                desktopId: configuration.desktopId,
                phoneId: configuration.phoneId,
                streamId: envelope.action.streamId,
                channel: envelope.action.channel,
                direction: .phoneToDesktop,
                seq: sequence,
                action: envelope.action
            ),
            pairingToken: configuration.pairingToken
        )
        let data = try encoder.encode(VectorCodeRelayOutboundMessage.frame(frame))
        guard let json = String(data: data, encoding: .utf8) else {
            throw VectorCodeRelayClientError.encodingFailed
        }
        try await task.send(.string(json))
    }

    public func receiveEnvelope() async throws -> VectorCodeRemoteEnvelope<VectorCodeJSONValue> {
        guard let task, let configuration else {
            throw VectorCodeRelayClientError.notConnected
        }

        while true {
            let message = try await task.receive()
            let data: Data
            switch message {
            case .data(let value):
                data = value
            case .string(let value):
                data = Data(value.utf8)
            @unknown default:
                continue
            }

            switch try decoder.decode(VectorCodeRelayInboundMessage.self, from: data) {
            case .frame(let frame):
                guard frame.header.direction == .desktopToPhone else {
                    continue
                }
                return try VectorCodeRelayFrameCrypto.decrypt(frame, pairingToken: configuration.pairingToken, as: VectorCodeRemoteEnvelope<VectorCodeJSONValue>.self)
            case .error(let code, let message):
                throw VectorCodeRelayClientError.relayError(code: code, message: message)
            case .ready, .peerOnline, .peerOffline, .pong:
                continue
            }
        }
    }
}

private extension VectorCodeRemoteAction {
    var streamId: String {
        switch self {
        case .stateRead:
            "state"
        case .terminalList, .terminalCreate, .terminalInput, .terminalControl, .terminalOutput:
            "terminal"
        case .fileTreeRead, .fileRead, .fileWrite, .fileMove, .fileCopy:
            "file"
        }
    }

    var channel: VectorCodeRelayFrameChannel {
        switch self {
        case .stateRead:
            .control
        case .terminalList, .terminalCreate, .terminalInput, .terminalControl, .terminalOutput:
            .terminal
        case .fileTreeRead, .fileRead, .fileWrite, .fileMove, .fileCopy:
            .file
        }
    }
}

public enum VectorCodeRelayClientError: Error, LocalizedError {
    case notConnected
    case encodingFailed
    case relayError(code: String, message: String)

    public var errorDescription: String? {
        switch self {
        case .notConnected:
            "The relay is not connected."
        case .encodingFailed:
            "Unable to encode relay payload."
        case .relayError(let code, let message):
            "Relay error \(code): \(message)"
        }
    }
}
