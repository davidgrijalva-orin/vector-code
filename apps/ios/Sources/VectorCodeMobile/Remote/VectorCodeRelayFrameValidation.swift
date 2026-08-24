import Foundation

public enum VectorCodeRelayFrameValidation {
    public static let maxFrameAge: TimeInterval = 5 * 60
    public static let maxFutureSkew: TimeInterval = 60

    public static func acceptsDesktopFrame(
        _ header: VectorCodeRelayFrameHeader,
        configuration: VectorCodeRelayConfiguration,
        now: Date = Date()
    ) -> Bool {
        guard header.protocolVersion == vectorCodeMobileProtocolVersion,
              !header.frameId.isEmpty,
              header.desktopId == configuration.desktopId,
              header.phoneId == configuration.phoneId,
              header.sessionId == configuration.pairingId,
              !header.streamId.isEmpty,
              header.direction == .desktopToPhone,
              header.seq > 0,
              let issuedAt = try? VectorCodeISO8601.date(from: header.issuedAt, field: "issuedAt") else {
            return false
        }
        return issuedAt >= now.addingTimeInterval(-maxFrameAge)
            && issuedAt <= now.addingTimeInterval(maxFutureSkew)
    }
}
