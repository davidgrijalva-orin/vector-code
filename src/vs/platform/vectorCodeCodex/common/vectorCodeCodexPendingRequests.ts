/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '../../../base/common/errors.js';
import { VectorCodeCodexRequestId } from './vectorCodeCodexBridge.js';

interface IVectorCodeCodexPendingRequest {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

/**
 * Owns request settlement independently of the process transport so responses, cancellation,
 * timeouts, and shutdown can race without resolving or rejecting a promise more than once.
 */
export class VectorCodeCodexPendingRequests {
	private readonly requests = new Map<VectorCodeCodexRequestId, IVectorCodeCodexPendingRequest>();

	get size(): number {
		return this.requests.size;
	}

	create<TResult>(requestId: VectorCodeCodexRequestId, method: string, timeoutMs: number): Promise<TResult> {
		return new Promise<TResult>((resolve, reject) => {
			if (this.requests.has(requestId)) {
				reject(new Error(`Duplicate Codex App Server request identifier: ${requestId}`));
				return;
			}
			const timeout = setTimeout(() => {
				this.reject(requestId, new Error(`Codex App Server request timed out: ${method}`));
			}, timeoutMs);
			this.requests.set(requestId, {
				resolve: value => resolve(value as TResult),
				reject,
				timeout,
			});
		});
	}

	resolve(requestId: VectorCodeCodexRequestId, value: unknown): boolean {
		return this.settle(requestId, pending => pending.resolve(value));
	}

	reject(requestId: VectorCodeCodexRequestId, error: Error): boolean {
		return this.settle(requestId, pending => pending.reject(error));
	}

	cancel(requestId: VectorCodeCodexRequestId): boolean {
		return this.reject(requestId, new CancellationError());
	}

	rejectAll(error: Error): void {
		for (const requestId of [...this.requests.keys()]) {
			this.reject(requestId, error);
		}
	}

	private settle(requestId: VectorCodeCodexRequestId, settle: (pending: IVectorCodeCodexPendingRequest) => void): boolean {
		const pending = this.requests.get(requestId);
		if (!pending) {
			return false;
		}
		this.requests.delete(requestId);
		clearTimeout(pending.timeout);
		settle(pending);
		return true;
	}
}
