import Foundation

public struct VectorCodePairingPayload: Codable, Equatable, Sendable {
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
        self.relayHost = relayHost
        self.userId = userId
        self.relayToken = relayToken
        self.relayTokenExpiresAt = relayTokenExpiresAt
        self.expiresAt = expiresAt
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
