/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { ICommandService, CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkspaceEditingService } from '../../../../services/workspaces/common/workspaceEditing.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IVectorCodeLibraryService, LibraryMutation, LocalLibrary } from '../../../../../platform/vectorCode/common/vectorCodeLibrary.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import '../../browser/vectorCodeLibrary.contribution.js';

suite('VectorCode local work actions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(choices: (number | number[] | undefined)[], title: string | undefined) {
		const inst = store.add(new TestInstantiationService());
		const storage = store.add(new TestStorageService());
		const writes: LibraryMutation[] = []; const editors: unknown[] = []; const commands: unknown[][] = []; const folders: string[] = [];
		let fail = false;
		const library: LocalLibrary = { version: 1, projects: [], notes: [] };
		inst.stub(IStorageService, storage);
		inst.stub(IWorkspaceEditingService, { addFolders: async (items: { uri: URI }[]) => { folders.push(...items.map(item => item.uri.toString())); } } as unknown as IWorkspaceEditingService);
		inst.stub(ICommandService, { executeCommand: async (...args: unknown[]) => { commands.push(args); } } as unknown as ICommandService);
		inst.stub(IQuickInputService, { pick: async (items: unknown[]) => { const index = choices.shift(); return index === undefined ? undefined : Array.isArray(index) ? index.map(value => items[value]) : items[index]; }, input: async () => title } as unknown as IQuickInputService);
		inst.stub(IVectorCodeLibraryService, {
			read: async () => library,
			mutate: async (request: LibraryMutation) => { writes.push(request); if (fail) { throw new Error('Lost reply'); } return { id: request.requestId, revision: 1 }; }
		} as unknown as IVectorCodeLibraryService);
		inst.stub(IEditorService, { openEditor: async (input: unknown) => { editors.push(input); } } as unknown as IEditorService);
		inst.stub(IFileService, {} as IFileService); inst.stub(IFileDialogService, {} as IFileDialogService);
		return { writes, editors, commands, folders, library, choices, setFail: (value: boolean) => { fail = value; }, run: async () => inst.invokeFunction(CommandsRegistry.getCommand('vectorCode.openLocalWork')!.handler) };
	}
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
