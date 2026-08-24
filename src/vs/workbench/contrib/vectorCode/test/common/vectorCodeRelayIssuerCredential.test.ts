/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { matchVectorCodeRelayIssuerCredential } from '../../common/vectorCodeRelayIssuerCredential.js';

suite('VectorCodeRelayIssuerCredential', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns a credential only for its saved relay origin', () => {
		const stored = JSON.stringify({ relayHost: 'relay.example.test', token: 'secret-token' });

		deepStrictEqual(matchVectorCodeRelayIssuerCredential(stored, 'relay.example.test'), {
			token: 'secret-token',
			requiresMigration: false
		});
		strictEqual(matchVectorCodeRelayIssuerCredential(stored, 'other.example.test'), undefined);
	});

	test('rejects malformed structured credentials', () => {
		strictEqual(matchVectorCodeRelayIssuerCredential(JSON.stringify({ relayHost: 'relay.example.test' }), 'relay.example.test'), undefined);
		strictEqual(matchVectorCodeRelayIssuerCredential(JSON.stringify({ relayHost: 'relay.example.test', token: '   ' }), 'relay.example.test'), undefined);
	});

	test('migrates a legacy token only for the previously saved origin', () => {
		deepStrictEqual(matchVectorCodeRelayIssuerCredential('legacy-token', 'relay.example.test', 'relay.example.test'), {
			token: 'legacy-token',
			requiresMigration: true
		});
		strictEqual(matchVectorCodeRelayIssuerCredential('legacy-token', 'other.example.test', 'relay.example.test'), undefined);
	});
});
