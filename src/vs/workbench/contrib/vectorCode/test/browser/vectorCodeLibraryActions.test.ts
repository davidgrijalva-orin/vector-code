/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { ICommandService, CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { URI } from '../../../../../base/common/uri.js';
import { IVectorCodeRecordingsService } from '../../../../../platform/vectorCode/common/vectorCodeRecordings.js';
import { IWorkspaceEditingService } from '../../../../services/workspaces/common/workspaceEditing.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IVectorCodeLibraryService, LibraryMutation, LocalLibrary, FileRecordingRequest } from '../../../../../platform/vectorCode/common/vectorCodeLibrary.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import '../../browser/vectorCodeLibrary.contribution.js';

suite('VectorCode local work actions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(choices: (number | number[] | undefined)[], title: string | undefined) {
		const inst = store.add(new TestInstantiationService());
		const storage = store.add(new TestStorageService());
		const filings: FileRecordingRequest[] = []; const writes: LibraryMutation[] = []; const editors: unknown[] = []; const commands: unknown[][] = []; const folders: string[] = [];
		let fail = false; let dirty = false;
		const library: LocalLibrary = { version: 1, projects: [], notes: [] };
		inst.stub(IStorageService, storage);
		inst.stub(IVectorCodeRecordingsService, { file: async (request: FileRecordingRequest) => { filings.push(request); if (fail) { throw new Error('Lost reply'); } const id = request.destination.kind === 'createNote' ? request.requestId : request.destination.id; return { recordingId: request.recordingId, noteId: id, tabId: id, revision: request.expectedPlacementRevision + 1 }; } } as unknown as IVectorCodeRecordingsService);
		inst.stub(IWorkingCopyService, { isDirty: () => dirty } as unknown as IWorkingCopyService);
		inst.stub(IWorkspaceEditingService, { addFolders: async (items: { uri: URI }[]) => { folders.push(...items.map(item => item.uri.toString())); } } as unknown as IWorkspaceEditingService);
		inst.stub(ICommandService, { executeCommand: async (...args: unknown[]) => { commands.push(args); } } as unknown as ICommandService);
		inst.stub(IQuickInputService, { pick: async (items: unknown[]) => { const index = choices.shift(); return index === undefined ? undefined : Array.isArray(index) ? index.map(value => items[value]) : items[index]; }, input: async () => title } as unknown as IQuickInputService);
		inst.stub(IVectorCodeLibraryService, {
			read: async () => library,
			mutate: async (request: LibraryMutation) => { writes.push(request); if (fail) { throw new Error('Lost reply'); } return { id: request.kind === 'createTab' || request.kind === 'appendPage' ? request.id : request.requestId, revision: 1, ...(request.kind === 'createTab' ? { tabId: request.requestId } : {}), ...(request.kind === 'appendPage' ? { pageId: request.requestId } : {}) }; }
		} as unknown as IVectorCodeLibraryService);
		inst.stub(IEditorService, { openEditor: async (input: unknown) => { editors.push(input); } } as unknown as IEditorService);
		inst.stub(IFileService, {} as IFileService); inst.stub(IFileDialogService, {} as IFileDialogService);
		return { filings, runFile: async () => inst.invokeFunction(CommandsRegistry.getCommand('vectorCode.fileLocalRecording')!.handler, { id: '8e045317-a99b-4517-95ff-b2b7e56f2e69', noteId: documentId }), writes, editors, commands, folders, library, choices, setDirty: (value: boolean) => { dirty = value; }, setFail: (value: boolean) => { fail = value; }, run: async () => inst.invokeFunction(CommandsRegistry.getCommand('vectorCode.openLocalWork')!.handler) };
	}
	const documentId = '658d2b51-5118-46d4-8b60-bf1954501284';
	function addDocument(f: ReturnType<typeof fixture>) {
		f.library.notes.push({ id: documentId, title: 'Document', body: 'Original', revision: 4, contentRevision: 2, contentUpdatedAt: 1, createdAt: 1, updatedAt: 1, history: [], projectIds: [] });
	}
	test('filing a recording uses the capture API and resumes uncertain completion with the original request', async () => {
		const f = fixture([2], 'Filed audio'); addDocument(f); f.setFail(true);
		await rejects(f.runFile(), /Lost reply/); strictEqual(f.filings.length, 1); deepStrictEqual(f.writes, []);
		f.setFail(false); f.choices.push(0); await f.run();
		deepStrictEqual(f.filings[0], f.filings[1]); strictEqual(f.editors.length, 1);
		strictEqual(f.filings[0].destination.kind, 'createNote'); strictEqual(f.filings[0].expectedPlacementRevision, 0);
	});
	test('canceling recording filing does not change its destination or begin another capture', async () => {
		const f = fixture([undefined], 'Unused'); addDocument(f); await f.runFile();
		deepStrictEqual(f.filings, []); deepStrictEqual(f.writes, []); deepStrictEqual(f.commands, []);
	});
	test('new note offers a page, internal tab or separate document and preserves canceled choices', async () => {
		for (const choices of [[1, undefined], [1, 0, undefined], [1, 0, 0, undefined]]) {
			const f = fixture(choices, 'Title'); addDocument(f); await f.run(); deepStrictEqual(f.writes, []);
		}
		const f = fixture([1, 2], 'Separate'); addDocument(f); await f.run(); strictEqual(f.writes[0].kind, 'createNote');
	});
	test('next page targets the selected tab revision and refuses an unsaved local draft', async () => {
		const f = fixture([1, 0, 0, 0], ''); addDocument(f); await f.run();
		const request = f.writes[0]; strictEqual(request.kind, 'appendPage');
		if (request.kind === 'appendPage') { strictEqual(request.id, documentId); strictEqual(request.tabId, documentId); strictEqual(request.expectedRevision, 2); }
		const dirty = fixture([1, 0, 0, 0], ''); addDocument(dirty); dirty.setDirty(true);
		await rejects(dirty.run(), /preserve the open draft/); deepStrictEqual(dirty.writes, []);
	});
	test('new tab opens its own resource and does not create another document', async () => {
		const f = fixture([1, 1, 0], 'Meetings'); addDocument(f); await f.run();
		const request = f.writes[0]; strictEqual(request.kind, 'createTab');
		if (request.kind === 'createTab') { strictEqual(request.id, documentId); strictEqual(request.expectedRevision, 4); }
		strictEqual((f.editors[0] as { resource: URI }).resource.path, '/' + documentId + '/' + request.requestId + '.md');
	});
	test('creates a note in Inbox with no Graph, account or folder services registered', async () => {
		const f = fixture([1], 'Idea'); await f.run();
		strictEqual(f.writes.length, 1);
		const request = f.writes[0]; strictEqual(request.kind, 'createNote');
		if (request.kind === 'createNote') { deepStrictEqual(request.projectIds, []); strictEqual(request.title, 'Idea'); }
		strictEqual(f.editors.length, 1);
	});
	test('recording starts in Inbox without requiring a title or project selection', async () => {
		const f = fixture([4], undefined); await f.run();
		strictEqual(f.writes[0].kind, 'createNote');
		deepStrictEqual(f.commands, [['vectorCode.recordLocalNote', f.writes[0].requestId]]);
	});

	test('canceling a title does not create anything or open an editor', async () => {
		const f = fixture([1], undefined); await f.run();
		deepStrictEqual(f.writes, []); deepStrictEqual(f.editors, []);
	});
	test('creates a stable project without demanding a local folder', async () => {
		const f = fixture([0], 'Research'); await f.run();
		strictEqual(f.writes[0].kind, 'createProject'); strictEqual(f.editors.length, 0);
	});
	test('opening multiple project folders delegates only explicitly selected references to native workspace controls', async () => {
		const f = fixture([5, 4, [0, 1]], undefined);
		f.library.projects.push({ id: '658d2b51-5118-46d4-8b60-bf1954501284', title: 'Project', revision: 1, folders: ['file:///first', 'file:///second'] });
		await f.run(); deepStrictEqual(f.folders, ['file:///first', 'file:///second']); deepStrictEqual(f.writes, []);
	});

	test('a lost creation reply is retried with the original identity and payload', async () => {
		const f = fixture([1], 'Idea'); f.setFail(true); await rejects(f.run(), /Lost reply/);
		f.choices.push(0); f.setFail(false); await f.run();
		deepStrictEqual(f.writes[0], f.writes[1]); strictEqual(f.writes.length, 2);
	});
});
