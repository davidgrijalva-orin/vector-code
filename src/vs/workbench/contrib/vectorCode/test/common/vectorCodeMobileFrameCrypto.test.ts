/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { cryptoRandomVectorCodeBase64Url } from '../../common/vectorCodeMobileEncoding.js';
import { decryptVectorCodeMobileFramePayload, encryptVectorCodeMobileFramePayload } from '../../common/vectorCodeMobileFrameCrypto.js';
import { VECTOR_CODE_MOBILE_FRAME_AUTHENTICATION_CASE } from '../../common/vectorCodeGeneratedConfig.js';
import { IVectorCodeMobileRelayFrameHeader, VectorCodeMobileRelayFrameChannel, VectorCodeMobileRelayFrameDirection, VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION } from '../../common/vectorCodeMobileProtocol.js';

suite('VectorCodeMobileFrameCrypto', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const header: IVectorCodeMobileRelayFrameHeader = {
		protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
		frameId: 'frame-1',
		desktopId: 'desktop-1',
		phoneId: 'phone-1',
		sessionId: 'pairing-1',
		streamId: 'state',
		channel: VectorCodeMobileRelayFrameChannel.Control,
		direction: VectorCodeMobileRelayFrameDirection.PhoneToDesktop,
		seq: 1,
		issuedAt: '2026-08-24T05:00:00.000Z',
		action: 'state.read'
	};

	test('round trips a frame and authenticates its routing header', async () => {
		const pairingToken = cryptoRandomVectorCodeBase64Url(32);
		const payload = { kind: 'request', requestId: 'request-1', action: 'state.read' };
		const frame = await encryptVectorCodeMobileFramePayload({ pairingToken, header, payload });

		deepStrictEqual(await decryptVectorCodeMobileFramePayload({ pairingToken, frame }), payload);
		await rejects(decryptVectorCodeMobileFramePayload({
			pairingToken,
			frame: {
				...frame,
				header: { ...frame.header, issuedAt: '2026-08-24T05:01:00.000Z' }
			}
		}));
	});

	test('decrypts the shared cross-platform authentication fixture', async () => {
		const fixture = VECTOR_CODE_MOBILE_FRAME_AUTHENTICATION_CASE;
		deepStrictEqual(await decryptVectorCodeMobileFramePayload({
			pairingToken: fixture.pairingToken,
			frame: {
				header: {
					...fixture.header,
					channel: VectorCodeMobileRelayFrameChannel.Control,
					direction: VectorCodeMobileRelayFrameDirection.PhoneToDesktop
				},
				nonce: fixture.nonce,
				ciphertext: fixture.ciphertext,
				tag: fixture.tag
			}
		}), fixture.payload);
	});
});
