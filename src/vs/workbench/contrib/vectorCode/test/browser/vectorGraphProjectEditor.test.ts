/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { strictEqual } from 'assert';
import { getWindow } from '../../../../../base/browser/dom.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IVectorGraphService } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorGraphDocument } from '../../../../../platform/vectorGraph/common/vectorGraphDocuments.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IVectorCodeWorkbenchService } from '../../common/vectorCode.js';
import { IVectorGraphWorkService } from '../../common/vectorGraphWork.js';
import { VectorGraphProjectWidget, isProjectSection } from '../../browser/vectorGraphProjectEditor.js';

suite('VectorGraph project workspace', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('standalone home and code tools do not call VectorGraph', async () => {
		const instantiation = workbenchInstantiationService({}, store);
		const commands: string[] = [];
		instantiation.stub(ICommandService, { executeCommand: async (id: string) => { commands.push(id); } });
		instantiation.stub(IVectorGraphService, { onDidChangeSession: Event.None, getSession: () => { throw new Error('Graph must not be required for local tools'); } });
		instantiation.stub(IVectorGraphWorkService, { getActive: () => undefined });
		const project = URI.file('/local');
		instantiation.stub(IVectorCodeWorkbenchService, { onDidChangeActiveProject: Event.None, getActiveProjectUri: () => project, getProjectSummaries: () => [{ uri: project, name: 'Local project', uriLabel: '/local' }] });
		const editor = store.add(instantiation.createInstance(VectorGraphProjectWidget));
		const root = document.createElement('div'); editor.render(root);
		await editor.selectSection('overview');
		document.body.appendChild(root); store.add(toDisposable(() => root.remove()));
		root.style.setProperty('--vectorcode-button-background', 'rgb(7, 133, 140)');
		const primary = root.querySelector<HTMLButtonElement>('.vector-project__button.primary')!;
		strictEqual(getWindow(root).getComputedStyle(primary).backgroundColor, 'rgb(7, 133, 140)', 'project actions must consume the native theme namespace');
		strictEqual(root.querySelector('h1')?.textContent, 'Local project');
		strictEqual(root.textContent?.includes('No VectorGraph account required'), true);
		root.querySelector<HTMLButtonElement>('[data-section="code"]')!.click();
		await timeout(0);
		[...root.querySelectorAll('button')].find(button => button.textContent === 'Browse files')!.click(); await timeout(0);
		strictEqual(commands[0], 'workbench.view.explorer');
	});
	test('project switch discards pending document data from the previous workspace', async () => {
		const instantiation = workbenchInstantiationService({}, store);
		const changed = store.add(new Emitter<URI | undefined>());
		let project = URI.file('/alpha');
		const pending = new DeferredPromise<readonly IVectorGraphDocument[]>();
		instantiation.stub(IVectorGraphService, { onDidChangeSession: Event.None, listDocuments: () => pending.p });
		instantiation.stub(IVectorGraphWorkService, { getActive: () => undefined });
		instantiation.stub(IVectorCodeWorkbenchService, { onDidChangeActiveProject: changed.event, getActiveProjectUri: () => project, getProjectSummaries: () => [] });
		instantiation.get(IStorageService).store('vectorCode.vectorGraph.binding.' + project.toString(), { workspace: { id: 'alpha', name: 'Alpha' }, team: { id: 'team', name: 'Team', identifier: 'VC' }, project: { id: 'project', name: 'Project' } }, StorageScope.PROFILE, StorageTarget.MACHINE);
		const editor = store.add(instantiation.createInstance(VectorGraphProjectWidget));
		const root = document.createElement('div'); editor.render(root);
		const loading = editor.selectSection('documents');
		await timeout(0); project = URI.file('/beta'); changed.fire(project);
		await pending.complete([{ id: 'document', title: 'Private alpha document', body: '', teamId: 'team', projectIds: ['project'], revisionNumber: 1, versionNumber: 1, updatedAt: '2026-09-12T00:00:00Z' }]); await loading;
		strictEqual(root.textContent?.includes('Private alpha document'), false);
		strictEqual(root.textContent?.includes('Local files and Markdown editing work without an account'), true);
	});
	test('accepts only supported project sections', () => {
		strictEqual(isProjectSection('billing'), false);
		strictEqual(isProjectSection(null), false);
		strictEqual(isProjectSection('code'), true);
	});
});
