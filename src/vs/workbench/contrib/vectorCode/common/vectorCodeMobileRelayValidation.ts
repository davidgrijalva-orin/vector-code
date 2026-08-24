/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorCodeMobilePairingPayload } from './vectorCode.js';
import { IVectorCodeMobileRemoteEnvelope, IVectorCodeMobileRelayEncryptedFrame, VectorCodeMobileRelayFrameDirection, VECTOR_CODE_MOBILE_REMOTE_ACTION_VALUES, VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION } from './vectorCodeMobileProtocol.js';

export const VECTOR_CODE_MOBILE_RELAY_MAX_FRAME_AGE_MS = 5 * 60_000;
export const VECTOR_CODE_MOBILE_RELAY_MAX_FUTURE_SKEW_MS = 60_000;

export class VectorCodeMobileRelayReplayGuard {
	private readonly seenFrames = new Set<string>();

	constructor(private readonly capacity = 2_048) {
		if (!Number.isSafeInteger(capacity) || capacity <= 0) {
			throw new Error('Replay guard capacity must be a positive safe integer.');
		}
	}

	record(frame: IVectorCodeMobileRelayEncryptedFrame): boolean {
		const key = `${frame.nonce}.${frame.tag}`;
		if (this.seenFrames.has(key)) {
			return false;
		}
		this.seenFrames.add(key);
		if (this.seenFrames.size > this.capacity) {
			const oldestKey = this.seenFrames.values().next().value;
			if (oldestKey !== undefined) {
				this.seenFrames.delete(oldestKey);
			}
		}
		return true;
	}
}

export function isValidVectorCodePhoneRelayFrame(value: unknown, payload: IVectorCodeMobilePairingPayload, now = Date.now()): value is IVectorCodeMobileRelayEncryptedFrame {
	if (!isRecord(value) || !isRecord(value.header)) {
		return false;
	}
	const header = value.header;
	return header.protocolVersion === VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION
		&& isNonEmptyString(header.frameId)
		&& header.desktopId === payload.desktopId
		&& isNonEmptyString(header.phoneId)
		&& header.sessionId === payload.pairingId
		&& isNonEmptyString(header.streamId)
		&& (header.channel === 'control' || header.channel === 'terminal' || header.channel === 'file' || header.channel === 'audit')
		&& header.direction === VectorCodeMobileRelayFrameDirection.PhoneToDesktop
		&& typeof header.seq === 'number'
		&& Number.isSafeInteger(header.seq)
		&& header.seq > 0
		&& isFreshIssuedAt(header.issuedAt, now)
		&& typeof header.action === 'string'
		&& (VECTOR_CODE_MOBILE_REMOTE_ACTION_VALUES as readonly string[]).includes(header.action)
		&& isNonEmptyString(value.nonce)
		&& isNonEmptyString(value.ciphertext)
		&& isNonEmptyString(value.tag);
}

export function isValidVectorCodeRemoteRequest(value: unknown): value is IVectorCodeMobileRemoteEnvelope {
	if (!isRecord(value)) {
		return false;
	}
	return value.kind === 'request'
		&& value.protocolVersion === VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION
		&& isNonEmptyString(value.requestId)
		&& typeof value.action === 'string'
		&& (VECTOR_CODE_MOBILE_REMOTE_ACTION_VALUES as readonly string[]).includes(value.action)
		&& (value.projectId === undefined || typeof value.projectId === 'string')
		&& (value.payload === undefined || isRecord(value.payload));
}

function isFreshIssuedAt(value: unknown, now: number): boolean {
	if (typeof value !== 'string') {
		return false;
	}
	const issuedAt = Date.parse(value);
	return Number.isFinite(issuedAt)
		&& issuedAt >= now - VECTOR_CODE_MOBILE_RELAY_MAX_FRAME_AGE_MS
		&& issuedAt <= now + VECTOR_CODE_MOBILE_RELAY_MAX_FUTURE_SKEW_MS;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
