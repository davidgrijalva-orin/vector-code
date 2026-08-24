/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { VectorCodeCodexRestartPolicy } from '../../common/vectorCodeCodexLifecycle.js';

suite('VectorCodeCodexRestartPolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns bounded restart attempts in order', () => {
		const policy = new VectorCodeCodexRestartPolicy([10, 20, 40], 100);

		deepStrictEqual(policy.nextRetry(0), { attempt: 1, maxAttempts: 3, delayMs: 10 });
		deepStrictEqual(policy.nextRetry(1), { attempt: 2, maxAttempts: 3, delayMs: 20 });
		deepStrictEqual(policy.nextRetry(2), { attempt: 3, maxAttempts: 3, delayMs: 40 });
		strictEqual(policy.nextRetry(3), undefined);
	});

	test('an unstable connection remains in the same failure burst', () => {
		const policy = new VectorCodeCodexRestartPolicy([10, 20], 100);

		deepStrictEqual(policy.nextRetry(0), { attempt: 1, maxAttempts: 2, delayMs: 10 });
		policy.markReady(20);
		deepStrictEqual(policy.nextRetry(50), { attempt: 2, maxAttempts: 2, delayMs: 20 });
	});

	test('a stable connection resets the retry budget', () => {
		const policy = new VectorCodeCodexRestartPolicy([10, 20], 100);

		policy.nextRetry(0);
		policy.markReady(20);
		deepStrictEqual(policy.nextRetry(120), { attempt: 1, maxAttempts: 2, delayMs: 10 });
	});

	test('manual reset starts a fresh failure burst', () => {
		const policy = new VectorCodeCodexRestartPolicy([10], 100);

		policy.nextRetry(0);
		strictEqual(policy.nextRetry(1), undefined);
		policy.reset();
		deepStrictEqual(policy.nextRetry(2), { attempt: 1, maxAttempts: 1, delayMs: 10 });
	});
});
