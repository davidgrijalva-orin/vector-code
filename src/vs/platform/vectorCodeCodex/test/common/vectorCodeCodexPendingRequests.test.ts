/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { isCancellationError } from '../../../../base/common/errors.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { VectorCodeRuntimeError, VectorCodeRuntimeErrorCode } from '../../../vectorCode/common/vectorCodeRuntime.js';
import { VectorCodeCodexPendingRequests } from '../../common/vectorCodeCodexPendingRequests.js';

suite('VectorCodeCodexPendingRequests', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('settles a correlated response exactly once', async () => {
		const requests = new VectorCodeCodexPendingRequests();
		const result = requests.create<string>('request-1', 'account/read', 1_000);

		strictEqual(requests.resolve('request-1', 'ready'), true);
		strictEqual(requests.resolve('request-1', 'late'), false);
		strictEqual(requests.reject('request-1', new Error('late')), false);
		strictEqual(await result, 'ready');
		strictEqual(requests.size, 0);
	});

	test('cancellation rejects and ignores a late response', async () => {
		const requests = new VectorCodeCodexPendingRequests();
		const result = requests.create<string>('request-2', 'thread/list', 1_000);

		strictEqual(requests.cancel('request-2'), true);
		strictEqual(requests.resolve('request-2', 'late'), false);
		await result.then(
			() => strictEqual(true, false, 'Expected cancellation to reject the request.'),
			error => strictEqual(isCancellationError(error), true),
		);
	});

	test('timeout rejects and ignores a late response', async () => {
		const requests = new VectorCodeCodexPendingRequests();
		const result = requests.create<string>('request-3', 'model/list', 1);

		await result.then(
			() => strictEqual(true, false, 'Expected the request to time out.'),
			error => {
				strictEqual(error.message, 'Codex App Server request timed out: model/list');
				strictEqual(error.code, VectorCodeRuntimeErrorCode.RequestTimeout);
				strictEqual(error.retryable, true);
				strictEqual(error.correlationId, 'request-3');
			},
		);
		strictEqual(requests.resolve('request-3', 'late'), false);
	});

	test('shutdown rejects every pending request', async () => {
		const requests = new VectorCodeCodexPendingRequests();
		const first = requests.create('request-4', 'thread/read', 1_000).catch(error => error);
		const second = requests.create('request-5', 'plugin/list', 1_000).catch(error => error);

		const shutdownError = new VectorCodeRuntimeError(
			VectorCodeRuntimeErrorCode.ConnectionLost,
			'Codex stopped.',
			'The helper exited during shutdown.',
			true,
			'codex-shutdown-1',
		);
		requests.rejectAll(shutdownError);
		strictEqual(await first, shutdownError);
		strictEqual(await second, shutdownError);
		strictEqual(requests.size, 0);
	});

	test('rejects duplicate correlation identifiers without replacing the original', async () => {
		const requests = new VectorCodeCodexPendingRequests();
		const original = requests.create<string>('request-6', 'thread/list', 1_000);
		const duplicate = requests.create<string>('request-6', 'thread/read', 1_000);

		await duplicate.then(
			() => strictEqual(true, false, 'Expected the duplicate request to reject.'),
			error => {
				strictEqual(error.message, 'Duplicate Codex App Server request identifier: request-6');
				strictEqual(error.code, VectorCodeRuntimeErrorCode.InvalidState);
				strictEqual(error.retryable, false);
			},
		);
		strictEqual(requests.resolve('request-6', 'original'), true);
		strictEqual(await original, 'original');
	});
});
