/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const DEFAULT_RESTART_DELAYS_MS = [1_000, 2_500, 5_000] as const;
const DEFAULT_STABLE_CONNECTION_MS = 30_000;

export interface IVectorCodeCodexRestart {
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly delayMs: number;
}

/** Tracks one failure burst. A connection that remains ready long enough starts a fresh burst. */
export class VectorCodeCodexRestartPolicy {
	private failureCount = 0;
	private readyAt: number | undefined;

	constructor(
		private readonly delaysMs: readonly number[] = DEFAULT_RESTART_DELAYS_MS,
		private readonly stableConnectionMs = DEFAULT_STABLE_CONNECTION_MS,
	) { }

	get maxAttempts(): number {
		return this.delaysMs.length;
	}

	markReady(now = Date.now()): void {
		this.readyAt = now;
	}

	nextRetry(now = Date.now()): IVectorCodeCodexRestart | undefined {
		if (this.readyAt !== undefined && now - this.readyAt >= this.stableConnectionMs) {
			this.failureCount = 0;
		}
		this.readyAt = undefined;
		const delayMs = this.delaysMs[this.failureCount];
		if (delayMs === undefined) {
			return undefined;
		}
		this.failureCount++;
		return {
			attempt: this.failureCount,
			maxAttempts: this.delaysMs.length,
			delayMs,
		};
	}

	reset(): void {
		this.failureCount = 0;
		this.readyAt = undefined;
	}
}
