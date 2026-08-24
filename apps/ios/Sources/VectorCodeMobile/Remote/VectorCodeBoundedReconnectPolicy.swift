import Foundation

public struct VectorCodeReconnectAttempt: Equatable, Sendable {
    public let attempt: Int
    public let totalAttempts: Int
    public let delay: TimeInterval
}

public struct VectorCodeBoundedReconnectPolicy: Sendable {
    private let delays: [TimeInterval]
    private var nextIndex = 0

    public init(delays: [TimeInterval]) {
        precondition(delays.allSatisfy { $0.isFinite && $0 > 0 }, "Reconnect delays must be positive finite values.")
        self.delays = delays
    }

    public mutating func nextRetry() -> VectorCodeReconnectAttempt? {
        guard nextIndex < delays.count else {
            return nil
        }
        defer { nextIndex += 1 }
        return VectorCodeReconnectAttempt(
            attempt: nextIndex + 1,
            totalAttempts: delays.count,
            delay: delays[nextIndex]
        )
    }
}
