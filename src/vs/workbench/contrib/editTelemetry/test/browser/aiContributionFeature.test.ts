/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { AnnotatedDocuments, UriVisibilityProvider } from '../../browser/helpers/annotatedDocuments.js';
import { StringEditWithReason } from '../../browser/helpers/observableWorkspace.js';
import { AiContributionFeature } from '../../browser/aiContributionFeature.js';
import { EditSources } from '../../../../../editor/common/textModelEditSource.js';
import { DiffService } from '../../browser/helpers/documentWithAnnotatedEdits.js';
import { computeStringDiff } from '../../../../../editor/common/services/editorWebWorker.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { MutableObservableWorkspace } from './editTelemetry.test.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { timeout } from '../../../../../base/common/async.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';

suite('AiContributionFeature', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let disposables: DisposableStore;
	let workspace: MutableObservableWorkspace;

	const fileA = URI.parse('file:///a.ts');
	const fileB = URI.parse('file:///b.ts');

	const userEdit = EditSources.cursor({ kind: 'type' });

	const inlineCompletionEdit = EditSources.inlineCompletionAccept({
		nes: false,
		requestUuid: 'test-uuid',
		languageId: 'plaintext',
		correlationId: undefined,
	});

	function setup(): void {
		disposables = new DisposableStore();
		const instantiationService = disposables.add(new TestInstantiationService(new ServiceCollection(), false, undefined, true));
		instantiationService.stubInstance(DiffService, { computeDiff: async (original, modified) => computeStringDiff(original, modified, { maxComputationTimeMs: 500 }, 'advanced') });
		instantiationService.stubInstance(UriVisibilityProvider, { isVisible: () => true });
		instantiationService.stub(ILogService, new NullLogService());

		workspace = new MutableObservableWorkspace();
		const annotatedDocuments = disposables.add(new AnnotatedDocuments(workspace, instantiationService));
		disposables.add(instantiationService.createInstance(AiContributionFeature, annotatedDocuments));
	}

	function hasAiContributions(uris: URI[]): boolean {
		return CommandsRegistry.getCommand('_aiEdits.hasAiContributions')!.handler(undefined!, uris) as unknown as boolean;
	}

	function clearAiContributions(uris: URI[]): void {
		CommandsRegistry.getCommand('_aiEdits.clearAiContributions')!.handler(undefined!, uris);
	}

	function clearAllAiContributions(): void {
		CommandsRegistry.getCommand('_aiEdits.clearAllAiContributions')!.handler(undefined!);
	}

	test('no contributions initially', () => runWithFakedTimers({}, async () => {
		setup();
		const d = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		await timeout(1500);
		assert.strictEqual(hasAiContributions([d.uri]), false);
		disposables.dispose();
	}));

	test('detects inline completion AI edits', () => runWithFakedTimers({}, async () => {
		setup();
		const d = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		await timeout(1500);

		d.applyEdit(StringEditWithReason.replace(d.findRange('hello'), 'world', inlineCompletionEdit));
		await timeout(1500);

		assert.strictEqual(hasAiContributions([d.uri]), true);
		disposables.dispose();
	}));

	test('detects inline completion AI edits across resources', () => runWithFakedTimers({}, async () => {
		setup();
		const d = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		await timeout(1500);

		d.applyEdit(StringEditWithReason.replace(d.findRange('hello'), 'world', inlineCompletionEdit));
		await timeout(1500);

		assert.strictEqual(hasAiContributions([d.uri, fileB]), true);
		disposables.dispose();
	}));

	test('does not detect user edits as AI', () => runWithFakedTimers({}, async () => {
		setup();
		const d = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		await timeout(1500);

		d.applyEdit(StringEditWithReason.replace(d.findRange('hello'), 'world', userEdit));
		await timeout(1500);

		assert.strictEqual(hasAiContributions([d.uri]), false);
		disposables.dispose();
	}));

	test('clear resets contributions for specific resources', () => runWithFakedTimers({}, async () => {
		setup();
		const dA = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		const dB = disposables.add(workspace.createDocument({ uri: fileB, initialValue: 'world' }, undefined));
		await timeout(1500);

		dA.applyEdit(StringEditWithReason.replace(dA.findRange('hello'), 'foo', inlineCompletionEdit));
		dB.applyEdit(StringEditWithReason.replace(dB.findRange('world'), 'bar', inlineCompletionEdit));
		await timeout(1500);

		assert.strictEqual(hasAiContributions([dA.uri]), true);
		assert.strictEqual(hasAiContributions([dB.uri]), true);

		clearAiContributions([dA.uri]);

		assert.strictEqual(hasAiContributions([dA.uri]), false);
		assert.strictEqual(hasAiContributions([dB.uri]), true);
		disposables.dispose();
	}));

	test('clearAll resets all contributions', () => runWithFakedTimers({}, async () => {
		setup();
		const dA = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		const dB = disposables.add(workspace.createDocument({ uri: fileB, initialValue: 'world' }, undefined));
		await timeout(1500);

		dA.applyEdit(StringEditWithReason.replace(dA.findRange('hello'), 'foo', inlineCompletionEdit));
		dB.applyEdit(StringEditWithReason.replace(dB.findRange('world'), 'bar', inlineCompletionEdit));
		await timeout(1500);

		clearAllAiContributions();

		assert.strictEqual(hasAiContributions([dA.uri]), false);
		assert.strictEqual(hasAiContributions([dB.uri]), false);
		disposables.dispose();
	}));

	test('tracks new edits after clear', () => runWithFakedTimers({}, async () => {
		setup();
		const d = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		await timeout(1500);

		d.applyEdit(StringEditWithReason.replace(d.findRange('hello'), 'world', inlineCompletionEdit));
		await timeout(1500);

		clearAiContributions([d.uri]);
		assert.strictEqual(hasAiContributions([d.uri]), false);

		d.applyEdit(StringEditWithReason.replace(d.findRange('world'), 'again', inlineCompletionEdit));
		await timeout(1500);

		assert.strictEqual(hasAiContributions([d.uri]), true);
		disposables.dispose();
	}));

	test('cleans up tracker when document is closed', () => runWithFakedTimers({}, async () => {
		setup();
		const d = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		await timeout(1500);

		d.applyEdit(StringEditWithReason.replace(d.findRange('hello'), 'world', inlineCompletionEdit));
		await timeout(1500);

		assert.strictEqual(hasAiContributions([d.uri]), true);

		d.dispose();
		await timeout(1500);

		assert.strictEqual(hasAiContributions([fileA]), false);
		disposables.dispose();
	}));

	test('returns false for unknown URIs', () => runWithFakedTimers({}, async () => {
		setup();
		assert.strictEqual(hasAiContributions([URI.parse('file:///unknown.ts')]), false);
		disposables.dispose();
	}));

	test('checks multiple resources', () => runWithFakedTimers({}, async () => {
		setup();
		const dA = disposables.add(workspace.createDocument({ uri: fileA, initialValue: 'hello' }, undefined));
		disposables.add(workspace.createDocument({ uri: fileB, initialValue: 'world' }, undefined));
		await timeout(1500);

		dA.applyEdit(StringEditWithReason.replace(dA.findRange('hello'), 'foo', inlineCompletionEdit));
		await timeout(1500);

		// Returns true if any of the resources has AI contributions
		assert.strictEqual(hasAiContributions([fileA, fileB]), true);
		assert.strictEqual(hasAiContributions([fileB, fileA]), true);
		assert.strictEqual(hasAiContributions([fileB]), false);
		disposables.dispose();
	}));
});
