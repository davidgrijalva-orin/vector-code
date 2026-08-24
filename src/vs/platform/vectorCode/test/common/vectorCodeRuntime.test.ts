/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { hasVectorCodeRuntimeCapability, recoverVectorCodeJsonState, runVectorCodeRuntimeWithTimeout, sanitizeVectorCodeDiagnosticText, VectorCodeRuntimeController, VectorCodeRuntimeError, VectorCodeRuntimeErrorCode, VectorCodeRuntimeState } from '../../common/vectorCodeRuntime.js';

suite('VectorCodeRuntime', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('exposes capability-level readiness through retry and shutdown', () => {
		let now = 10;
		const runtime = new VectorCodeRuntimeController('codex', () => now);

		runtime.transition(VectorCodeRuntimeState.Starting);
		now = 20;
		runtime.transition(VectorCodeRuntimeState.Retrying, { attempt: 1, nextRetryAt: 120 });
		now = 30;
		const ready = runtime.transition(VectorCodeRuntimeState.Ready, { capabilities: ['codex.message', 'codex.threads', 'codex.message'] });

		deepStrictEqual(ready.capabilities, ['codex.message', 'codex.threads']);
		strictEqual(hasVectorCodeRuntimeCapability(ready, 'codex.message'), true);
		strictEqual(hasVectorCodeRuntimeCapability(ready, 'codex.plugins'), false);
		now = 40;
		strictEqual(runtime.transition(VectorCodeRuntimeState.Stopped).state, VectorCodeRuntimeState.Stopped);
		strictEqual(runtime.getDiagnosticSummary(['Restart the service.']).recentEvents.length, 4);
	});

	test('returns a stable safe error for a missing dependency', () => {
		const error = new VectorCodeRuntimeError(
			VectorCodeRuntimeErrorCode.DependencyMissing,
			'Codex CLI is not installed.',
			'Could not launch C:\\Users\\person\\project with Bearer secret-value and sk-example123456789.',
			false,
			'codex-missing-1',
		);

		strictEqual(error.code, VectorCodeRuntimeErrorCode.DependencyMissing);
		strictEqual(error.userMessage, 'Codex CLI is not installed.');
		strictEqual(error.retryable, false);
		strictEqual(error.correlationId, 'codex-missing-1');
		strictEqual(error.cause.includes('secret-value'), false);
		strictEqual(error.cause.includes('sk-example123456789'), false);
		strictEqual(error.cause.includes('person'), false);
	});

	test('bounds slow startup and cleans up a late helper', async () => {
		let resolveStartup!: (value: string) => void;
		const startup = new Promise<string>(resolve => resolveStartup = resolve);
		const cleaned: string[] = [];
		const timeout = new VectorCodeRuntimeError(
			VectorCodeRuntimeErrorCode.StartupTimeout,
			'Codex took too long to start.',
			'Startup exceeded 5 ms.',
			true,
			'codex-timeout-1',
		);

		await runVectorCodeRuntimeWithTimeout(startup, 5, timeout, value => { cleaned.push(value); }).then(
			() => strictEqual(true, false, 'Expected startup to time out.'),
			error => strictEqual(error, timeout),
		);
		resolveStartup('late-connection');
		await new Promise(resolve => setTimeout(resolve, 0));
		deepStrictEqual(cleaned, ['late-connection']);
	});

	test('rolls corrupt state back to a known-good snapshot or resets safely', () => {
		interface IState { readonly version: number }
		const isState = (value: unknown): value is IState => typeof value === 'object' && value !== null && (value as IState).version === 1;
		const knownGood = JSON.stringify({ version: 1 });

		const rolledBack = recoverVectorCodeJsonState('{broken', knownGood, isState);
		strictEqual(rolledBack.action, 'rolled_back');
		deepStrictEqual(rolledBack.value, { version: 1 });
		strictEqual(rolledBack.quarantinedValue, '{broken');

		const reset = recoverVectorCodeJsonState('{broken', '{also-broken', isState);
		strictEqual(reset.action, 'reset');
		strictEqual(reset.value, undefined);
	});

	test('redacts secret and project detail from diagnostic text', () => {
		const diagnostic = sanitizeVectorCodeDiagnosticText('authorization=my-secret relayToken: "relay-secret" "apiKey":"api-secret" /Users/person/project/file.ts C:\\Users\\person\\source.ts \\\\server\\private\\file.ts https://relay.test/path?token=hidden vta_1234567890abcdef');
		strictEqual(diagnostic.includes('my-secret'), false);
		strictEqual(diagnostic.includes('relay-secret'), false);
		strictEqual(diagnostic.includes('api-secret'), false);
		strictEqual(diagnostic.includes('person'), false);
		strictEqual(diagnostic.includes('server'), false);
		strictEqual(diagnostic.includes('relay.test'), false);
		strictEqual(diagnostic.includes('vta_'), false);
	});

	test('normalizes external runtime errors before storing them', () => {
		const runtime = new VectorCodeRuntimeController('relay');
		const status = runtime.transition(VectorCodeRuntimeState.Degraded, {
			error: {
				code: VectorCodeRuntimeErrorCode.StorageUnavailable,
				userMessage: 'Secure storage is unavailable.',
				cause: 'relayToken: "must-not-survive"',
				retryable: true,
				correlationId: 'relay-storage-1',
			},
		});

		strictEqual(status.error?.cause.includes('must-not-survive'), false);
		strictEqual(status.error?.correlationId, 'relay-storage-1');
		strictEqual(runtime.getDiagnosticSummary([]).recentEvents.at(-1)?.correlationId, 'relay-storage-1');
	});
});
