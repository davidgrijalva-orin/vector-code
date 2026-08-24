/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IVectorCodeReconnectAttempt {
	readonly attempt: number;
	readonly delayMs: number;
}

/**
 * Produces an indefinite, capped reconnect backoff. A connection must remain
 * ready for the configured stability window before a later failure starts a
 * fresh retry burst.
 */
export class VectorCodeReconnectPolicy {
	private failureCount = 0;
	private readyAt: number | undefined;

	constructor(
		private readonly retryDelaysMs: readonly number[],
		private readonly stableAfterMs: number,
	) {
		if (!retryDelaysMs.length || retryDelaysMs.some(delay => !Number.isFinite(delay) || delay <= 0)) {
			throw new Error('Reconnect delays must contain positive finite values.');
		}
		if (!Number.isFinite(stableAfterMs) || stableAfterMs < 0) {
			throw new Error('Reconnect stability window must be a non-negative finite value.');
		}
	}

	nextRetry(now = Date.now()): IVectorCodeReconnectAttempt {
		if (this.readyAt !== undefined && now - this.readyAt >= this.stableAfterMs) {
			this.failureCount = 0;
		}
		this.readyAt = undefined;
		this.failureCount += 1;
		return {
			attempt: this.failureCount,
			delayMs: this.retryDelaysMs[Math.min(this.failureCount - 1, this.retryDelaysMs.length - 1)]
		};
	}

	markReady(now = Date.now()): void {
		this.readyAt = now;
	}

	reset(): void {
		this.failureCount = 0;
		this.readyAt = undefined;
	}
}
