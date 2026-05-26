import Foundation
import Security

public final class VectorCodePairingStore {
    private struct StoredPairing: Codable {
        let payload: VectorCodePairingPayload
        let phoneId: String
    }

    private let service = "com.orintech.vectorcode.mobile"
    private let account = "desktop-pairing"
    private let legacyDefaultsKey = "com.orintech.vectorcode.mobile.pairing"

    public init() {}

    public func load() -> (payload: VectorCodePairingPayload, phoneId: String)? {
        if let stored = loadFromKeychain() {
            return validatedStoredPairing(stored) {
                clear()
            }
        }

        guard let legacy = loadLegacyDefaultsPairing() else {
            return nil
        }
        guard let stored = validatedStoredPairing(legacy, onInvalid: {
            clearLegacyDefaultsPairing()
        }) else {
            return nil
        }
        save(payload: stored.payload, phoneId: stored.phoneId)
        clearLegacyDefaultsPairing()
        return stored
    }

    public func save(payload: VectorCodePairingPayload, phoneId: String) {
        let stored = StoredPairing(payload: payload, phoneId: phoneId)
        guard let data = try? JSONEncoder().encode(stored) else {
            return
        }

        let query = baseQuery()
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var addQuery = query
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(addQuery as CFDictionary, nil)
        }
        clearLegacyDefaultsPairing()
    }

    public func clear() {
        SecItemDelete(baseQuery() as CFDictionary)
        clearLegacyDefaultsPairing()
    }

    private func loadFromKeychain() -> StoredPairing? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(StoredPairing.self, from: data)
    }

    private func loadLegacyDefaultsPairing() -> StoredPairing? {
        guard let data = UserDefaults.standard.data(forKey: legacyDefaultsKey) else {
            return nil
        }
        return try? JSONDecoder().decode(StoredPairing.self, from: data)
    }

    private func validatedStoredPairing(
        _ stored: StoredPairing,
        onInvalid: () -> Void
    ) -> (payload: VectorCodePairingPayload, phoneId: String)? {
        do {
            try stored.payload.validateStoredSession()
            return (stored.payload, stored.phoneId)
        } catch {
            onInvalid()
            return nil
        }
    }

    private func clearLegacyDefaultsPairing() {
        UserDefaults.standard.removeObject(forKey: legacyDefaultsKey)
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
