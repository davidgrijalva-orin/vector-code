/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { VectorCodeReconnectPolicy } from '../../common/vectorCodeReconnectPolicy.js';

suite('VectorCodeReconnectPolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('caps the delay while continuing to retry', () => {
		const policy = new VectorCodeReconnectPolicy([10, 20, 40], 100);

		deepStrictEqual(policy.nextRetry(0), { attempt: 1, delayMs: 10 });
		deepStrictEqual(policy.nextRetry(1), { attempt: 2, delayMs: 20 });
		deepStrictEqual(policy.nextRetry(2), { attempt: 3, delayMs: 40 });
		deepStrictEqual(policy.nextRetry(3), { attempt: 4, delayMs: 40 });
	});

	test('keeps an unstable connection in the same failure burst', () => {
		const policy = new VectorCodeReconnectPolicy([10, 20, 40], 100);

		deepStrictEqual(policy.nextRetry(0), { attempt: 1, delayMs: 10 });
		policy.markReady(20);
		deepStrictEqual(policy.nextRetry(50), { attempt: 2, delayMs: 20 });
	});

	test('a stable connection resets the failure burst', () => {
		const policy = new VectorCodeReconnectPolicy([10, 20, 40], 100);

		deepStrictEqual(policy.nextRetry(0), { attempt: 1, delayMs: 10 });
		policy.markReady(20);
		deepStrictEqual(policy.nextRetry(120), { attempt: 1, delayMs: 10 });
	});

	test('manual reset starts a fresh failure burst', () => {
		const policy = new VectorCodeReconnectPolicy([10, 20, 40], 100);

		deepStrictEqual(policy.nextRetry(0), { attempt: 1, delayMs: 10 });
		deepStrictEqual(policy.nextRetry(1), { attempt: 2, delayMs: 20 });
		policy.reset();
		deepStrictEqual(policy.nextRetry(2), { attempt: 1, delayMs: 10 });
	});
});
