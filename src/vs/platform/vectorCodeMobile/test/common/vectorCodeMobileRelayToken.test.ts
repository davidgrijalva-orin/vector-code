/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { normalizeVectorCodeRelayTokenResponse } from '../../common/vectorCodeMobileRelayToken.js';

suite('VectorCodeMobileRelayToken', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const now = Date.parse('2026-08-24T05:00:00.000Z');
	const expiresAt = '2026-08-24T06:00:00.000Z';

	test('normalizes current and legacy response field names', () => {
		deepStrictEqual(normalizeVectorCodeRelayTokenResponse({ relayToken: ' token ', relayTokenExpiresAt: ` ${expiresAt} ` }, now), {
			relayToken: 'token',
			relayTokenExpiresAt: expiresAt
		});
		deepStrictEqual(normalizeVectorCodeRelayTokenResponse({ token: 'token', expiresAt }, now), {
			relayToken: 'token',
			relayTokenExpiresAt: expiresAt
		});
	});

	test('rejects missing, malformed, expired, and near-expiry responses', () => {
		strictEqual(normalizeVectorCodeRelayTokenResponse(undefined, now), undefined);
		strictEqual(normalizeVectorCodeRelayTokenResponse({ token: '', expiresAt }, now), undefined);
		strictEqual(normalizeVectorCodeRelayTokenResponse({ token: 'token', expiresAt: 'invalid' }, now), undefined);
		strictEqual(normalizeVectorCodeRelayTokenResponse({ token: 'token', expiresAt: '2026-08-24T05:00:00.000Z' }, now), undefined);
		strictEqual(normalizeVectorCodeRelayTokenResponse({ token: 'token', expiresAt: '2026-08-24T05:01:00.000Z' }, now), undefined);
	});
});
