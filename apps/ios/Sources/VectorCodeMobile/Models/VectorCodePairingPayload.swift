import Foundation

public struct VectorCodePairingPayload: Codable, Equatable, Sendable {
    private enum CodingKeys: String, CodingKey {
        case protocolVersion
        case desktopId
        case pairingId
        case desktopPublicKey
        case desktopPublicKeyFingerprint
        case pairingToken
        case relayHost
        case userId
        case relayToken
        case relayTokenExpiresAt
        case expiresAt
    }

    private static let canonicalRelayHost = "relay.vectorcode.app"
    private static let legacyRelayHosts: Set<String> = [
        "relay-production-e21f.up.railway.app",
        "sskpzvaw.up.railway.app",
    ]

    public let protocolVersion: Int
    public let desktopId: String
    public let pairingId: String
    public let desktopPublicKey: String
    public let desktopPublicKeyFingerprint: String
    public let pairingToken: String
    public let relayHost: String
    public let userId: String?
    public let relayToken: String?
    public let relayTokenExpiresAt: String?
    public let expiresAt: String

    public init(
        protocolVersion: Int = 1,
        desktopId: String,
        pairingId: String,
        desktopPublicKey: String,
        desktopPublicKeyFingerprint: String,
        pairingToken: String,
        relayHost: String,
        userId: String? = "default",
        relayToken: String? = nil,
        relayTokenExpiresAt: String? = nil,
        expiresAt: String
    ) {
        self.protocolVersion = protocolVersion
        self.desktopId = desktopId
        self.pairingId = pairingId
        self.desktopPublicKey = desktopPublicKey
        self.desktopPublicKeyFingerprint = desktopPublicKeyFingerprint
        self.pairingToken = pairingToken
        self.relayHost = Self.normalizeRelayHost(relayHost)
        self.userId = userId
        self.relayToken = relayToken
        self.relayTokenExpiresAt = relayTokenExpiresAt
        self.expiresAt = expiresAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            protocolVersion: try container.decode(Int.self, forKey: .protocolVersion),
            desktopId: try container.decode(String.self, forKey: .desktopId),
            pairingId: try container.decode(String.self, forKey: .pairingId),
            desktopPublicKey: try container.decode(String.self, forKey: .desktopPublicKey),
            desktopPublicKeyFingerprint: try container.decode(String.self, forKey: .desktopPublicKeyFingerprint),
            pairingToken: try container.decode(String.self, forKey: .pairingToken),
            relayHost: try container.decode(String.self, forKey: .relayHost),
            userId: try container.decodeIfPresent(String.self, forKey: .userId),
            relayToken: try container.decodeIfPresent(String.self, forKey: .relayToken),
            relayTokenExpiresAt: try container.decodeIfPresent(String.self, forKey: .relayTokenExpiresAt),
            expiresAt: try container.decode(String.self, forKey: .expiresAt)
        )
    }

    public static func decode(from json: String) throws -> VectorCodePairingPayload {
        let data = Data(json.utf8)
        let payload = try JSONDecoder().decode(VectorCodePairingPayload.self, from: data)
        try payload.validate()
        return payload
    }

    public func validate(now: Date = Date()) throws {
        try validateRequiredFields()
        let expiry = try VectorCodeISO8601.date(from: expiresAt, field: "expiresAt")
        guard expiry > now else {
            throw VectorCodePairingError.expired
        }
        if let relayTokenExpiresAt {
            let tokenExpiry = try VectorCodeISO8601.date(from: relayTokenExpiresAt, field: "relayTokenExpiresAt")
            guard tokenExpiry > now else {
                throw VectorCodePairingError.expired
            }
        }
    }

    public func validateStoredSession(now: Date = Date()) throws {
        try validateRequiredFields()
        guard relayToken?.isEmpty == false else {
            throw VectorCodePairingError.missingField("relayToken")
        }
        guard let relayTokenExpiresAt else {
            throw VectorCodePairingError.missingField("relayTokenExpiresAt")
        }
        let tokenExpiry = try VectorCodeISO8601.date(from: relayTokenExpiresAt, field: "relayTokenExpiresAt")
        guard tokenExpiry > now else {
            throw VectorCodePairingError.expired
        }
    }

    private func validateRequiredFields() throws {
        guard protocolVersion == 1 else {
            throw VectorCodePairingError.unsupportedProtocol(protocolVersion)
        }
        guard !desktopId.isEmpty else {
            throw VectorCodePairingError.missingField("desktopId")
        }
        guard !pairingId.isEmpty else {
            throw VectorCodePairingError.missingField("pairingId")
        }
        guard !desktopPublicKey.isEmpty else {
            throw VectorCodePairingError.missingField("desktopPublicKey")
        }
        guard !desktopPublicKeyFingerprint.isEmpty else {
            throw VectorCodePairingError.missingField("desktopPublicKeyFingerprint")
        }
        guard !pairingToken.isEmpty else {
            throw VectorCodePairingError.missingField("pairingToken")
        }
        guard !relayHost.isEmpty else {
            throw VectorCodePairingError.missingField("relayHost")
        }
        _ = try VectorCodeISO8601.date(from: expiresAt, field: "expiresAt")
    }

    private static func normalizeRelayHost(_ value: String) -> String {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedValue.isEmpty else {
            return trimmedValue
        }

        let hostInput: String
        if let components = URLComponents(string: trimmedValue), let host = components.host {
            hostInput = components.port.map { "\(host):\($0)" } ?? host
        } else {
            hostInput = trimmedValue
        }

        let lowercasedHost = hostInput.lowercased()
        if legacyRelayHosts.contains(lowercasedHost) {
            return canonicalRelayHost
        }
        return lowercasedHost
    }
}

public enum VectorCodePairingError: Error, Equatable, LocalizedError {
    case unsupportedProtocol(Int)
    case missingField(String)
    case invalidDate(String)
    case expired

    public var errorDescription: String? {
        switch self {
        case .unsupportedProtocol(let version):
            "Unsupported VectorCode mobile protocol: \(version)"
        case .missingField(let field):
            "Missing pairing field: \(field)"
        case .invalidDate(let field):
            "Invalid pairing date: \(field)"
        case .expired:
            "The pairing QR has expired."
        }
    }
}

public enum VectorCodeISO8601 {
    public static func string(from date: Date) -> String {
        makeFormatter(withFractionalSeconds: true).string(from: date)
    }

    public static func date(from value: String, field: String) throws -> Date {
        if let date = makeFormatter(withFractionalSeconds: true).date(from: value) {
            return date
        }
        if let date = makeFormatter(withFractionalSeconds: false).date(from: value) {
            return date
        }
        throw VectorCodePairingError.invalidDate(field)
    }

    private static func makeFormatter(withFractionalSeconds: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = withFractionalSeconds ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter
    }
}
