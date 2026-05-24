import CryptoKit
import Foundation

public let vectorCodeMobileProtocolVersion = 1

public enum VectorCodeRemoteAction: String, Codable, Sendable {
    case stateRead = "state.read"
    case fileTreeRead = "file.tree.read"
    case fileRead = "file.read"
    case fileWrite = "file.write"
    case fileMove = "file.move"
    case fileCopy = "file.copy"
    case terminalList = "terminal.list"
    case terminalCreate = "terminal.create"
    case terminalInput = "terminal.input"
    case terminalControl = "terminal.control"
    case terminalOutput = "terminal.output"
}

public struct VectorCodeRemoteEnvelope<Payload: Codable & Sendable>: Codable, Sendable {
    public let kind: VectorCodeRemoteEnvelopeKind
    public let protocolVersion: Int
    public let requestId: String
    public let action: VectorCodeRemoteAction
    public let projectId: String?
    public let payload: Payload?
    public let error: VectorCodeRemoteError?

    public init(
        kind: VectorCodeRemoteEnvelopeKind = .request,
        protocolVersion: Int = vectorCodeMobileProtocolVersion,
        requestId: String = UUID().uuidString,
        action: VectorCodeRemoteAction,
        projectId: String? = nil,
        payload: Payload? = nil,
        error: VectorCodeRemoteError? = nil
    ) {
        self.kind = kind
        self.protocolVersion = protocolVersion
        self.requestId = requestId
        self.action = action
        self.projectId = projectId
        self.payload = payload
        self.error = error
    }
}

public enum VectorCodeJSONValue: Codable, Equatable, Sendable {
    case object([String: VectorCodeJSONValue])
    case array([VectorCodeJSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([VectorCodeJSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: VectorCodeJSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

public enum VectorCodeRemoteEnvelopeKind: String, Codable, Sendable {
    case request
    case response
}

public struct VectorCodeRemoteError: Codable, Equatable, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

public struct VectorCodeRelayConfiguration: Equatable, Sendable {
    public let webSocketURL: URL
    public let authorizationHeader: String?
    public let desktopId: String
    public let phoneId: String
    public let pairingId: String
    public let pairingToken: String

    public init(pairingPayload: VectorCodePairingPayload, phoneId: String) throws {
        let relayURL = try Self.makeRelayURL(pairingPayload: pairingPayload, phoneId: phoneId)
        self.webSocketURL = relayURL
        self.authorizationHeader = pairingPayload.relayToken.map { "Bearer \($0)" }
        self.desktopId = pairingPayload.desktopId
        self.phoneId = phoneId
        self.pairingId = pairingPayload.pairingId
        self.pairingToken = pairingPayload.pairingToken
    }

    private static func makeRelayURL(pairingPayload: VectorCodePairingPayload, phoneId: String) throws -> URL {
        let hostInput = pairingPayload.relayHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !hostInput.isEmpty else {
            throw VectorCodeRelayConfigurationError.invalidRelayHost
        }

        let scheme = hostInput.hasPrefix("localhost") || hostInput.hasPrefix("127.0.0.1") ? "ws" : "wss"
        guard var components = URLComponents(string: "\(scheme)://\(hostInput)/relay") else {
            throw VectorCodeRelayConfigurationError.invalidRelayHost
        }

        components.queryItems = [
            URLQueryItem(name: "role", value: "phone"),
            URLQueryItem(name: "userId", value: pairingPayload.userId ?? "default"),
            URLQueryItem(name: "desktopId", value: pairingPayload.desktopId),
            URLQueryItem(name: "deviceId", value: phoneId),
            URLQueryItem(name: "pairingId", value: pairingPayload.pairingId),
        ]

        guard let url = components.url else {
            throw VectorCodeRelayConfigurationError.invalidRelayHost
        }
        return url
    }
}

public enum VectorCodeRelayConfigurationError: Error, LocalizedError {
    case invalidRelayHost

    public var errorDescription: String? {
        switch self {
        case .invalidRelayHost:
            "Invalid relay host."
        }
    }
}

public enum VectorCodeRelayFrameDirection: String, Codable, Sendable {
    case phoneToDesktop = "phone_to_desktop"
    case desktopToPhone = "desktop_to_phone"
}

public enum VectorCodeRelayFrameChannel: String, Codable, Sendable {
    case control
    case terminal
    case file
    case audit
}

public struct VectorCodeRelayFrameHeader: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let frameId: String
    public let desktopId: String
    public let phoneId: String
    public let sessionId: String?
    public let streamId: String
    public let channel: VectorCodeRelayFrameChannel
    public let direction: VectorCodeRelayFrameDirection
    public let seq: Int
    public let issuedAt: String
    public let action: VectorCodeRemoteAction

    public init(
        protocolVersion: Int = vectorCodeMobileProtocolVersion,
        frameId: String = UUID().uuidString,
        desktopId: String,
        phoneId: String,
        sessionId: String? = nil,
        streamId: String,
        channel: VectorCodeRelayFrameChannel,
        direction: VectorCodeRelayFrameDirection,
        seq: Int,
        issuedAt: String = VectorCodeISO8601.string(from: Date()),
        action: VectorCodeRemoteAction
    ) {
        self.protocolVersion = protocolVersion
        self.frameId = frameId
        self.desktopId = desktopId
        self.phoneId = phoneId
        self.sessionId = sessionId
        self.streamId = streamId
        self.channel = channel
        self.direction = direction
        self.seq = seq
        self.issuedAt = issuedAt
        self.action = action
    }
}

public struct VectorCodeRelayEncryptedFrame: Codable, Equatable, Sendable {
    public let header: VectorCodeRelayFrameHeader
    public let nonce: String
    public let ciphertext: String
    public let tag: String

    public init(header: VectorCodeRelayFrameHeader, nonce: String, ciphertext: String, tag: String) {
        self.header = header
        self.nonce = nonce
        self.ciphertext = ciphertext
        self.tag = tag
    }
}

public enum VectorCodeRelayOutboundMessage: Codable, Equatable, Sendable {
    case frame(VectorCodeRelayEncryptedFrame)
    case ping(String?)

    private enum CodingKeys: String, CodingKey {
        case type
        case frame
        case requestId
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .frame(let frame):
            try container.encode("relay.frame", forKey: .type)
            try container.encode(frame, forKey: .frame)
        case .ping(let requestId):
            try container.encode("relay.ping", forKey: .type)
            try container.encodeIfPresent(requestId, forKey: .requestId)
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "relay.frame":
            self = .frame(try container.decode(VectorCodeRelayEncryptedFrame.self, forKey: .frame))
        case "relay.ping":
            self = .ping(try container.decodeIfPresent(String.self, forKey: .requestId))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unsupported relay outbound message")
        }
    }
}

public enum VectorCodeRelayInboundMessage: Codable, Equatable, Sendable {
    case ready
    case peerOnline(role: String, desktopId: String, deviceId: String?)
    case peerOffline(role: String, desktopId: String, deviceId: String?)
    case frame(VectorCodeRelayEncryptedFrame)
    case pong(String?)
    case error(code: String, message: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case role
        case desktopId
        case deviceId
        case frame
        case requestId
        case code
        case message
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ready:
            try container.encode("relay.ready", forKey: .type)
        case .peerOnline(let role, let desktopId, let deviceId):
            try container.encode("relay.peer_online", forKey: .type)
            try container.encode(role, forKey: .role)
            try container.encode(desktopId, forKey: .desktopId)
            try container.encodeIfPresent(deviceId, forKey: .deviceId)
        case .peerOffline(let role, let desktopId, let deviceId):
            try container.encode("relay.peer_offline", forKey: .type)
            try container.encode(role, forKey: .role)
            try container.encode(desktopId, forKey: .desktopId)
            try container.encodeIfPresent(deviceId, forKey: .deviceId)
        case .frame(let frame):
            try container.encode("relay.frame", forKey: .type)
            try container.encode(frame, forKey: .frame)
        case .pong(let requestId):
            try container.encode("relay.pong", forKey: .type)
            try container.encodeIfPresent(requestId, forKey: .requestId)
        case .error(let code, let message):
            try container.encode("relay.error", forKey: .type)
            try container.encode(code, forKey: .code)
            try container.encode(message, forKey: .message)
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "relay.ready":
            self = .ready
        case "relay.peer_online":
            self = .peerOnline(
                role: try container.decode(String.self, forKey: .role),
                desktopId: try container.decode(String.self, forKey: .desktopId),
                deviceId: try container.decodeIfPresent(String.self, forKey: .deviceId)
            )
        case "relay.peer_offline":
            self = .peerOffline(
                role: try container.decode(String.self, forKey: .role),
                desktopId: try container.decode(String.self, forKey: .desktopId),
                deviceId: try container.decodeIfPresent(String.self, forKey: .deviceId)
            )
        case "relay.frame":
            self = .frame(try container.decode(VectorCodeRelayEncryptedFrame.self, forKey: .frame))
        case "relay.pong":
            self = .pong(try container.decodeIfPresent(String.self, forKey: .requestId))
        case "relay.error":
            self = .error(
                code: try container.decode(String.self, forKey: .code),
                message: try container.decode(String.self, forKey: .message)
            )
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unsupported relay inbound message")
        }
    }
}

public enum VectorCodeRelayFrameCrypto {
    private static let nonceBytes = 12
    private static let tagBytes = 16

    public static func encrypt<Payload: Encodable>(_ payload: Payload, header: VectorCodeRelayFrameHeader, pairingToken: String) throws -> VectorCodeRelayEncryptedFrame {
        let key = try frameKey(pairingToken)
        let nonce = try AES.GCM.Nonce(data: randomData(count: nonceBytes))
        let plaintext = try JSONEncoder().encode(payload)
        let sealedBox = try AES.GCM.seal(plaintext, using: key, nonce: nonce)
        guard let ciphertext = sealedBox.ciphertext.dataValue, let tag = sealedBox.tag.dataValue else {
            throw VectorCodeRelayFrameCryptoError.encodingFailed
        }
        return VectorCodeRelayEncryptedFrame(
            header: header,
            nonce: (nonce.dataValue ?? Data()).base64URLEncodedString(),
            ciphertext: ciphertext.base64URLEncodedString(),
            tag: tag.base64URLEncodedString()
        )
    }

    public static func decrypt<Payload: Decodable>(_ frame: VectorCodeRelayEncryptedFrame, pairingToken: String, as payloadType: Payload.Type) throws -> Payload {
        let key = try frameKey(pairingToken)
        let nonce = try AES.GCM.Nonce(data: Data(base64URLString: frame.nonce))
        let sealedBox = try AES.GCM.SealedBox(
            nonce: nonce,
            ciphertext: Data(base64URLString: frame.ciphertext),
            tag: Data(base64URLString: frame.tag)
        )
        let plaintext = try AES.GCM.open(sealedBox, using: key)
        return try JSONDecoder().decode(payloadType, from: plaintext)
    }

    private static func frameKey(_ pairingToken: String) throws -> SymmetricKey {
        let keyData = try Data(base64URLString: pairingToken)
        guard keyData.count == 32 else {
            throw VectorCodeRelayFrameCryptoError.invalidPairingToken
        }
        return SymmetricKey(data: keyData)
    }

    private static func randomData(count: Int) -> Data {
        Data((0..<count).map { _ in UInt8.random(in: .min ... .max) })
    }
}

public enum VectorCodeRelayFrameCryptoError: Error, LocalizedError {
    case invalidPairingToken
    case invalidBase64URL
    case encodingFailed

    public var errorDescription: String? {
        switch self {
        case .invalidPairingToken:
            "Invalid VectorCode pairing token."
        case .invalidBase64URL:
            "Invalid base64url frame field."
        case .encodingFailed:
            "Unable to encode relay frame."
        }
    }
}

public struct VectorCodeTerminalInputRequest: Codable, Equatable, Sendable {
    public enum Mode: String, Codable, Sendable {
        case raw
        case paste
        case command
    }

    public let terminalId: String
    public let input: String
    public let submit: Bool
    public let mode: Mode

    public init(terminalId: String, input: String, submit: Bool = false, mode: Mode? = nil) {
        self.terminalId = terminalId
        self.input = input
        self.submit = submit
        self.mode = mode ?? (submit ? .command : .paste)
    }

    private enum CodingKeys: String, CodingKey {
        case terminalId
        case input
        case submit
        case mode
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        terminalId = try container.decode(String.self, forKey: .terminalId)
        input = try container.decode(String.self, forKey: .input)
        submit = try container.decodeIfPresent(Bool.self, forKey: .submit) ?? false
        mode = try container.decodeIfPresent(Mode.self, forKey: .mode) ?? (submit ? .command : .paste)
    }
}

public struct VectorCodeTerminalInputResponse: Codable, Equatable, Sendable {
    public let terminalId: String
    public let accepted: Bool

    public init(terminalId: String, accepted: Bool) {
        self.terminalId = terminalId
        self.accepted = accepted
    }
}

public struct VectorCodeTerminalCreateRequest: Codable, Equatable, Sendable {
    public let title: String?
    public let cwd: String?

    public init(title: String? = nil, cwd: String? = nil) {
        self.title = title
        self.cwd = cwd
    }
}

public struct VectorCodeTerminalControlRequest: Codable, Equatable, Sendable {
    public enum Command: String, Codable, Sendable {
        case resize
        case interrupt
        case clear
        case rename
        case close
    }

    public let terminalId: String
    public let command: Command
    public let cols: Int?
    public let rows: Int?
    public let title: String?

    public init(terminalId: String, command: Command, cols: Int? = nil, rows: Int? = nil, title: String? = nil) {
        self.terminalId = terminalId
        self.command = command
        self.cols = cols
        self.rows = rows
        self.title = title
    }
}

public struct VectorCodeTerminalControlResponse: Codable, Equatable, Sendable {
    public let terminalId: String
    public let accepted: Bool

    public init(terminalId: String, accepted: Bool) {
        self.terminalId = terminalId
        self.accepted = accepted
    }
}

public struct VectorCodeTerminalOutputRequest: Codable, Equatable, Sendable {
    public let terminalId: String

    public init(terminalId: String) {
        self.terminalId = terminalId
    }
}

public struct VectorCodeTerminalOutputResponse: Codable, Equatable, Sendable {
    public let terminalId: String
    public let output: [String]
    public let rawOutput: String?

    public init(terminalId: String, output: [String], rawOutput: String? = nil) {
        self.terminalId = terminalId
        self.output = output
        self.rawOutput = rawOutput
    }
}

public struct VectorCodeFileTreeResponse: Codable, Equatable, Sendable {
    public let nodes: [VectorCodeFileNode]
    public let truncated: Bool

    public init(nodes: [VectorCodeFileNode], truncated: Bool = false) {
        self.nodes = nodes
        self.truncated = truncated
    }
}

public struct VectorCodeFileReadRequest: Codable, Equatable, Sendable {
    public let path: String

    public init(path: String) {
        self.path = path
    }
}

public struct VectorCodeFileTreeReadRequest: Codable, Equatable, Sendable {
    public let path: String?

    public init(path: String? = nil) {
        self.path = path
    }
}

public struct VectorCodeFileReadResponse: Codable, Equatable, Sendable {
    public let path: String
    public let content: String
    public let language: String?
    public let version: String?

    public init(path: String, content: String, language: String? = nil, version: String? = nil) {
        self.path = path
        self.content = content
        self.language = language
        self.version = version
    }
}

private extension Data {
    init(base64URLString: String) throws {
        var value = base64URLString.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        value += String(repeating: "=", count: (4 - value.count % 4) % 4)
        guard let data = Data(base64Encoded: value) else {
            throw VectorCodeRelayFrameCryptoError.invalidBase64URL
        }
        self = data
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private extension ContiguousBytes {
    var dataValue: Data? {
        withUnsafeBytes { buffer in
            guard let baseAddress = buffer.baseAddress else {
                return Data()
            }
            return Data(bytes: baseAddress, count: buffer.count)
        }
    }
}

public struct VectorCodeFileWriteRequest: Codable, Equatable, Sendable {
    public let path: String
    public let content: String
    public let expectedVersion: String?

    public init(path: String, content: String, expectedVersion: String? = nil) {
        self.path = path
        self.content = content
        self.expectedVersion = expectedVersion
    }
}

public struct VectorCodeFileWriteResponse: Codable, Equatable, Sendable {
    public let path: String
    public let version: String?

    public init(path: String, version: String? = nil) {
        self.path = path
        self.version = version
    }
}

public struct VectorCodeFileMoveRequest: Codable, Equatable, Sendable {
    public let path: String
    public let targetPath: String
    public let targetProjectId: String?
    public let overwrite: Bool

    public init(path: String, targetPath: String, targetProjectId: String? = nil, overwrite: Bool = false) {
        self.path = path
        self.targetPath = targetPath
        self.targetProjectId = targetProjectId
        self.overwrite = overwrite
    }
}

public struct VectorCodeFileMoveResponse: Codable, Equatable, Sendable {
    public let path: String
    public let targetPath: String
    public let targetProjectId: String

    public init(path: String, targetPath: String, targetProjectId: String) {
        self.path = path
        self.targetPath = targetPath
        self.targetProjectId = targetProjectId
    }
}

public struct VectorCodeFileCopyRequest: Codable, Equatable, Sendable {
    public let path: String
    public let targetPath: String
    public let targetProjectId: String
    public let overwrite: Bool

    public init(path: String, targetPath: String, targetProjectId: String, overwrite: Bool = false) {
        self.path = path
        self.targetPath = targetPath
        self.targetProjectId = targetProjectId
        self.overwrite = overwrite
    }
}

public struct VectorCodeFileCopyResponse: Codable, Equatable, Sendable {
    public let path: String
    public let targetPath: String
    public let targetProjectId: String

    public init(path: String, targetPath: String, targetProjectId: String) {
        self.path = path
        self.targetPath = targetPath
        self.targetProjectId = targetProjectId
    }
}
