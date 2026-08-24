/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IVectorCodeMobilePairingPayload } from '../../common/vectorCode.js';
import { VectorCodeMobileRelayReplayGuard, isValidVectorCodePhoneRelayFrame, isValidVectorCodeRemoteRequest, VECTOR_CODE_MOBILE_RELAY_MAX_FRAME_AGE_MS, VECTOR_CODE_MOBILE_RELAY_MAX_FUTURE_SKEW_MS } from '../../common/vectorCodeMobileRelayValidation.js';
import { IVectorCodeMobileRelayEncryptedFrame, VectorCodeMobileRelayFrameChannel, VectorCodeMobileRelayFrameDirection, VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION } from '../../common/vectorCodeMobileProtocol.js';

suite('VectorCodeMobileRelayValidation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const now = Date.parse('2026-08-24T05:00:00.000Z');
	const payload: IVectorCodeMobilePairingPayload = {
		protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
		desktopId: 'desktop-1',
		pairingId: 'pairing-1',
		desktopPublicKey: 'public-key',
		desktopPublicKeyFingerprint: 'fingerprint',
		pairingToken: 'pairing-token',
		relayHost: 'relay.example.test',
		expiresAt: new Date(now + 60_000).toISOString()
	};

	const frame = (overrides: Partial<IVectorCodeMobileRelayEncryptedFrame['header']> = {}, nonce = 'nonce'): IVectorCodeMobileRelayEncryptedFrame => ({
		header: {
			protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
			frameId: 'frame-1',
			desktopId: payload.desktopId,
			phoneId: 'phone-1',
			sessionId: payload.pairingId,
			streamId: 'stream-1',
			channel: VectorCodeMobileRelayFrameChannel.Control,
			direction: VectorCodeMobileRelayFrameDirection.PhoneToDesktop,
			seq: 1,
			issuedAt: new Date(now).toISOString(),
			action: 'state.read',
			...overrides
		},
		nonce,
		ciphertext: 'ciphertext',
		tag: `tag-${nonce}`
	});

	test('accepts a fresh frame for the exact pairing session', () => {
		strictEqual(isValidVectorCodePhoneRelayFrame(frame(), payload, now), true);
	});

	test('rejects missing, mismatched, stale, and future session frames', () => {
		strictEqual(isValidVectorCodePhoneRelayFrame(frame({ sessionId: undefined }), payload, now), false);
		strictEqual(isValidVectorCodePhoneRelayFrame(frame({ sessionId: 'pairing-2' }), payload, now), false);
		strictEqual(isValidVectorCodePhoneRelayFrame(frame({ issuedAt: new Date(now - VECTOR_CODE_MOBILE_RELAY_MAX_FRAME_AGE_MS - 1).toISOString() }), payload, now), false);
		strictEqual(isValidVectorCodePhoneRelayFrame(frame({ issuedAt: new Date(now + VECTOR_CODE_MOBILE_RELAY_MAX_FUTURE_SKEW_MS + 1).toISOString() }), payload, now), false);
	});

	test('validates the decrypted request envelope', () => {
		strictEqual(isValidVectorCodeRemoteRequest({
			kind: 'request',
			protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
			requestId: 'request-1',
			action: 'state.read',
			payload: {}
		}), true);
		strictEqual(isValidVectorCodeRemoteRequest({
			kind: 'response',
			protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
			requestId: 'request-1',
			action: 'state.read',
			payload: {}
		}), false);
	});

	test('rejects a replay and evicts only after reaching capacity', () => {
		const guard = new VectorCodeMobileRelayReplayGuard(2);
		const first = frame({}, 'nonce-1');
		const second = frame({}, 'nonce-2');
		const third = frame({}, 'nonce-3');

		strictEqual(guard.record(first), true);
		strictEqual(guard.record(first), false);
		strictEqual(guard.record(second), true);
		strictEqual(guard.record(third), true);
		strictEqual(guard.record(first), true);
	});
});
