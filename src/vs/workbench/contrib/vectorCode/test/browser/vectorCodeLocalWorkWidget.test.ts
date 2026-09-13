/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { strictEqual, deepStrictEqual } from 'assert';
import { getWindow } from '../../../../../base/browser/dom.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IVectorCodeLibraryService, LocalLibrary, localPageBreak } from '../../../../../platform/vectorCode/common/vectorCodeLibrary.js';
import { IVectorCodeRecordingsService } from '../../../../../platform/vectorCode/common/vectorCodeRecordings.js';
import { IVectorCodeAudioService } from '../../../../../platform/vectorCode/browser/vectorCodeAudio.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { VectorCodeLocalWorkWidget } from '../../browser/vectorCodeLocalWorkWidget.js';

suite('VectorCode permanent local workspace', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const inst = workbenchInstantiationService({}, store); const storage = store.add(new TestStorageService());
		const calls: unknown[][] = [];
		const data: LocalLibrary = { version: 1, projects: [{ id: 'project', title: 'Research', folders: ['file:///first', 'file:///second'], revision: 1 }, { id: 'empty', title: 'Ideas', folders: [], revision: 1 }], notes: [{ id: 'note', title: '<b>Brief</b>', body: '# First' + localPageBreak('8e045317-a99b-4517-95ff-b2b7e56f2e69') + '# Second', revision: 1, contentRevision: 1, contentUpdatedAt: 1, createdAt: 1, updatedAt: 1, projectIds: ['project'], history: [], additionalTabs: [{ id: 'tab', title: 'Discussion', body: 'Key decision', revision: 1, contentRevision: 1, contentUpdatedAt: 1, createdAt: 1, updatedAt: 1, history: [] }] }] };
		inst.stub(IStorageService, storage);
		inst.stub(ICommandService, { onDidExecuteCommand: Event.None, executeCommand: async (...args: unknown[]) => { calls.push(args); } });
		inst.stub(IFileService, { onDidFilesChange: Event.None });
		inst.stub(IVectorCodeAudioService, { onDidFinish: Event.None });
		inst.stub(IEditorService, { onDidActiveEditorChange: Event.None });
		inst.stub(IVectorCodeRecordingsService, { list: async () => [] });
		inst.stub(IVectorCodeLibraryService, { read: async () => data, findNotes: async () => data.notes });
		const widget = store.add(inst.createInstance(VectorCodeLocalWorkWidget)); const root = document.createElement('div'); widget.render(root);
		return { widget, root, data, calls, storage, inst };
	}
	test('shows optional folder projects, navigates tabs/pages through shared actions and never interprets titles as HTML', async () => {
		const f = fixture(); f.widget.setVisible(true); await f.widget.refresh();
		strictEqual(f.root.textContent?.includes('Research · 2 folders'), true);
		strictEqual(f.root.textContent?.includes('Ideas · 0 folders'), true);
		const button = [...f.root.querySelectorAll('button')].find(button => button.textContent === '<b>Brief</b>')!; button.click(); await timeout(0);
		strictEqual(f.root.querySelector('b'), null);
		strictEqual(f.root.textContent?.includes('Discussion'), true);
		[...f.root.querySelectorAll('button')].find(button => button.textContent === 'Page 2 · Second')!.click(); await timeout(0);
		deepStrictEqual(f.calls.at(-1), ['vectorCode.localWorkAction', { kind: 'page', id: 'note', tabId: 'note', pageId: '8e045317-a99b-4517-95ff-b2b7e56f2e69' }]);
	});
	test('Inbox is independent from folder count and project selection survives refresh', async () => {
		const f = fixture(); f.storage.store('vectorCode.localWork.scope', 'inbox', StorageScope.PROFILE, StorageTarget.MACHINE);
		f.widget.setVisible(true); await f.widget.refresh(); strictEqual(f.root.querySelector('nav')?.textContent, '');
		const scope = f.root.querySelector('select')!; scope.value = 'project'; scope.dispatchEvent(new (getWindow(scope).Event)('change')); await timeout(0);
		strictEqual(f.root.querySelector('nav')?.textContent, '<b>Brief</b>'); await f.widget.refresh(); strictEqual(scope.value, 'project');
	});
	test('a hidden workspace discards a pending library response', async () => {
		const f = fixture(); const pending = new DeferredPromise<LocalLibrary>();
		f.inst.stub(IVectorCodeLibraryService, { read: () => pending.p });
		// The existing instance retains its original service. Use a new widget for the delayed boundary.
		const widget = store.add(f.inst.createInstance(VectorCodeLocalWorkWidget)); const root = document.createElement('div'); widget.render(root);
		widget.setVisible(true); widget.setVisible(false); await pending.complete(f.data); await timeout(0);
		strictEqual(root.querySelector('nav')?.textContent, '');
	});
});
