/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileWriteOptions } from '../../../../../platform/files/common/files.js';
import { IVectorCodeLibraryService, LibraryMutation, LocalNote } from '../../../../../platform/vectorCode/common/vectorCodeLibrary.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { EncodingOracle } from '../../../../services/textfile/browser/textFileService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { VectorCodeLibraryFileSystem, localNoteResource } from '../../browser/vectorCodeLibraryFileSystem.js';

suite('VectorCode local note editor API', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const id = '658d2b51-5118-46d4-8b60-bf1954501284';
	const resource = localNoteResource(id);
	const options: IFileWriteOptions = { create: false, overwrite: true, unlock: false, atomic: false };
	test('local notes keep UTF-8 even when filesystem preferences select another encoding', async () => {
		const encoding = store.add(workbenchInstantiationService({}, store).createInstance(EncodingOracle));
		deepStrictEqual(await encoding.getPreferredReadEncoding(resource, { encoding: 'utf16le' }), { encoding: 'utf8', hasBOM: false });
		deepStrictEqual(await encoding.getPreferredWriteEncoding(resource, 'windows1252'), { encoding: 'utf8', hasBOM: false });
	});
	test('uncertain save retries survive reconstruction and precede subsequent edits', async () => {
		const storage = store.add(new TestStorageService());
		let dirty = false; let fail = true; let revision = 1;
		const calls: LibraryMutation[] = [];
		const library = {
			read: async () => ({ notes: [{ id, body: 'Saved', revision, updatedAt: 1 }] }),
			mutate: async (request: LibraryMutation) => { calls.push(request); if (fail) { throw new Error('Lost reply'); } return { id, revision: ++revision }; }
		} as unknown as IVectorCodeLibraryService;
		const provider = store.add(new VectorCodeLibraryFileSystem(library, storage, { isDirty: () => dirty } as unknown as IWorkingCopyService));
		await provider.readFile(resource); dirty = true;
		await rejects(provider.writeFile(resource, VSBuffer.fromString('First edit').buffer, options), /Lost reply/);
		await provider.readFile(resource);
		fail = false;
		const restored = store.add(new VectorCodeLibraryFileSystem(library, storage, { isDirty: () => dirty } as unknown as IWorkingCopyService));
		await restored.writeFile(resource, VSBuffer.fromString('Second edit').buffer, options);
		deepStrictEqual(calls[0], calls[1]);
		strictEqual(calls[2].kind === 'saveNote' && calls[2].expectedRevision, 2);
		strictEqual(calls[2].kind === 'saveNote' && calls[2].body, 'Second edit');
	});
	test('dirty reads preserve conflict checks and deliberate clean reload permits recovery', async () => {
		let dirty = false;
		const note: LocalNote = { id, title: 'Idea', body: 'Original', revision: 1, contentRevision: 1, contentUpdatedAt: 1, createdAt: 1, updatedAt: 1, history: [], projectIds: [] };
		const library = {
			read: async () => ({ notes: [note] }),
			mutate: async (request: LibraryMutation) => {
				if (request.kind !== 'saveNote' || request.expectedRevision !== note.revision) { throw new Error('Conflict'); }
				note.body = request.body; return { id, revision: ++note.revision };
			}
		} as unknown as IVectorCodeLibraryService;
		const provider = store.add(new VectorCodeLibraryFileSystem(library, store.add(new TestStorageService()), { isDirty: () => dirty } as unknown as IWorkingCopyService));
		await provider.readFile(resource); dirty = true; note.revision = 2; note.contentRevision = 2; note.body = 'Other window';
		await provider.readFile(resource);
		await rejects(provider.writeFile(resource, VSBuffer.fromString('My draft').buffer, options), /Conflict/);
		strictEqual(note.body, 'Other window');
		dirty = false; await provider.readFile(resource); dirty = true;
		await provider.writeFile(resource, VSBuffer.fromString('Resolved').buffer, options);
		strictEqual(note.body, 'Resolved'); strictEqual(note.revision, 3);
	});
	test('additional tab resources retain independent save baselines and uncertain retry identities', async () => {
		const tabId = 'b2470f8e-e052-4e3a-881d-ab967858f66e';
		const tabResource = localNoteResource(id, tabId);
		const note: LocalNote = { id, title: 'Document', body: 'First', revision: 8, contentRevision: 4, contentUpdatedAt: 1, createdAt: 1, updatedAt: 1, history: [], projectIds: [], additionalTabs: [{ id: tabId, title: 'Second', body: 'Second', revision: 2, contentRevision: 2, contentUpdatedAt: 1, createdAt: 1, updatedAt: 1, history: [] }] };
		let fail = true; const calls: LibraryMutation[] = [];
		const library = { read: async () => ({ notes: [note] }), mutate: async (request: LibraryMutation) => { calls.push(request); if (fail) { throw new Error('Lost reply'); } return { id, tabId, revision: 9, contentRevision: 3 }; } } as unknown as IVectorCodeLibraryService;
		const storage = store.add(new TestStorageService());
		const provider = store.add(new VectorCodeLibraryFileSystem(library, storage, { isDirty: () => false } as unknown as IWorkingCopyService));
		await provider.readFile(resource); strictEqual(VSBuffer.wrap(await provider.readFile(tabResource)).toString(), 'Second');
		await rejects(provider.writeFile(tabResource, VSBuffer.fromString('Draft').buffer, options));
		fail = false;
		const restored = store.add(new VectorCodeLibraryFileSystem(library, storage, { isDirty: () => true } as unknown as IWorkingCopyService));
		await restored.writeFile(tabResource, VSBuffer.fromString('Draft').buffer, options);
		deepStrictEqual(calls[0], calls[1]); strictEqual(calls.length, 2);
		const request = calls[0]; strictEqual(request.kind, 'saveTab');
		if (request.kind === 'saveTab') { strictEqual(request.expectedRevision, 2); strictEqual(request.id, id); strictEqual(request.tabId, tabId); }
		await rejects(provider.readFile(localNoteResource(id, '8e045317-a99b-4517-95ff-b2b7e56f2e69')), /not found/);
	});
	test('invalid identities, unsupported operations and invalid UTF-8 fail before writes', async () => {
		let calls = 0;
		const library = { read: async () => ({ notes: [] }), mutate: async () => { calls++; } } as unknown as IVectorCodeLibraryService;
		const provider = store.add(new VectorCodeLibraryFileSystem(library, store.add(new TestStorageService()), { isDirty: () => false } as unknown as IWorkingCopyService));
		await rejects(provider.readFile(resource.with({ authority: 'remote' })));
		await rejects(provider.readFile(resource), /not found/);
		await rejects(provider.writeFile(resource, new Uint8Array([0xff]), options));
		await rejects(provider.delete()); await rejects(provider.rename()); await rejects(provider.mkdir());
		strictEqual(calls, 0);
	});
});
