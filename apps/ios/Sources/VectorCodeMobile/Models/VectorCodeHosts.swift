import Foundation

public enum VectorCodeHosts {
    public static let canonicalHost = VectorCodeGeneratedConfig.canonicalHost
    public static let releaseDownloadURL = VectorCodeGeneratedConfig.releaseDownloadURL
    public static let updateFeedURL = VectorCodeGeneratedConfig.updateFeedURL
    public static let canonicalRelayHost = VectorCodeGeneratedConfig.canonicalRelayHost
    public static let defaultUserId = VectorCodeGeneratedConfig.defaultUserId
    public static let legacyRelayHosts = VectorCodeGeneratedConfig.legacyRelayHosts

    public static func normalizeRelayHost(_ value: String) -> String? {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedValue.isEmpty else {
            return nil
        }

        let urlInput = trimmedValue.range(of: "^[A-Za-z][A-Za-z0-9+.-]*://", options: .regularExpression) == nil ? "wss://\(trimmedValue)" : trimmedValue
        guard let components = URLComponents(string: urlInput), let host = components.host?.lowercased() else {
            return nil
        }

        let relayHost = components.port.map { "\(host):\($0)" } ?? host
        if legacyRelayHosts.contains(host) {
            return canonicalRelayHost
        }
        guard relayHost.range(of: VectorCodeGeneratedConfig.relayHostPattern, options: .regularExpression) != nil else {
            return nil
        }
        return relayHost
    }
}
