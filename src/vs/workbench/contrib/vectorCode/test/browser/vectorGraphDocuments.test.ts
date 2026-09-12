/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileWriteOptions } from '../../../../../platform/files/common/files.js';
import { IVectorGraphService } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorGraphDocumentSave } from '../../../../../platform/vectorGraph/common/vectorGraphDocuments.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { EncodingOracle } from '../../../../services/textfile/browser/textFileService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { VectorGraphDocumentFileSystem, vectorGraphDocumentResource } from '../../browser/vectorGraphDocumentFileSystem.js';

suite('VectorGraph native documents', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const workspace = 'bf275fab-fe03-44c3-b993-ced522c45a07';
	const document = '658d2b51-5118-46d4-8b60-bf1954501284';
	const resource = vectorGraphDocumentResource(workspace, document);
	const options: IFileWriteOptions = { create: false, overwrite: true, unlock: false, atomic: false };
	test('uses API UTF-8 even when local files use another encoding', async () => {
		const encoding = store.add(workbenchInstantiationService({}, store).createInstance(EncodingOracle));
		deepStrictEqual(await encoding.getPreferredReadEncoding(resource, { encoding: 'utf16le' }), { encoding: 'utf8', hasBOM: false });
		deepStrictEqual(await encoding.getPreferredWriteEncoding(resource, 'windows1252'), { encoding: 'utf8', hasBOM: false });
	});
	test('keeps dirty draft revisions across background reads and reuses uncertain save IDs', async () => {
		const storage = store.add(new TestStorageService());
		let revision = 1; let dirty = false; let fail = true;
		const calls: { save: IVectorGraphDocumentSave; key: string }[] = [];
		const record = () => ({ id: document, title: 'Design', body: '# Body', projectIds: [], revisionNumber: revision, versionNumber: revision, updatedAt: '2026-09-12T16:00:00.000Z' });
		const graph = {
			getDocument: async () => record(),
			saveDocument: async (_workspace: string, _document: string, save: IVectorGraphDocumentSave, key: string) => { calls.push({ save, key }); if (fail) { throw new Error('Connection lost'); } return record(); }
		} as unknown as IVectorGraphService;
		const provider = store.add(new VectorGraphDocumentFileSystem(graph, storage, { isDirty: () => dirty } as unknown as IWorkingCopyService));
		await provider.readFile(resource);
		dirty = true; revision = 2;
		await provider.stat(resource); await provider.readFile(resource);
		const content = VSBuffer.fromString('# Draft').buffer;
		await rejects(provider.writeFile(resource, content, options), /Connection lost/);
		// Reconstruct the provider as after a reload: durable draft baseline and retry key survive.
		const restored = store.add(new VectorGraphDocumentFileSystem(graph, storage, { isDirty: () => dirty } as unknown as IWorkingCopyService));
		fail = false;
		await restored.writeFile(resource, content, options);
		deepStrictEqual(calls[0], calls[1]);
		strictEqual(calls[1].save.expectedRevisionNumber, 1);
		await restored.writeFile(resource, VSBuffer.fromString('# Next').buffer, options);
		strictEqual(calls[2].save.expectedRevisionNumber, 2);
		strictEqual(calls[2].key === calls[1].key, false);
	});
	test('exposes the server timestamp as epoch milliseconds and rejects malformed timestamps', async () => {
		let updatedAt = '2026-09-12T16:00:00.000Z';
		const graph = { getDocument: async () => ({ body: 'Document', revisionNumber: 8, updatedAt }) } as unknown as IVectorGraphService;
		const provider = store.add(new VectorGraphDocumentFileSystem(graph, store.add(new TestStorageService()), { isDirty: () => false } as unknown as IWorkingCopyService));
		strictEqual((await provider.stat(resource)).mtime, Date.parse(updatedAt));
		updatedAt = 'not a timestamp';
		await rejects(provider.stat(resource), /invalid document timestamp/);
	});
	test('requires a loaded base, validates identity and refuses generic filesystem mutations', async () => {
		const graph = { getDocument: async () => { throw new Error('Not authorized'); } } as unknown as IVectorGraphService;
		const provider = store.add(new VectorGraphDocumentFileSystem(graph, store.add(new TestStorageService()), { isDirty: () => false } as unknown as IWorkingCopyService));
		await rejects(provider.writeFile(resource, new Uint8Array(), options), /Reload/);
		await rejects(provider.readFile(resource.with({ query: 'other' })), /Invalid/);
		await rejects(provider.readFile(resource), /Not authorized/);
		await rejects(provider.delete(), /document actions/);
		await rejects(provider.rename(), /document actions/);
		strictEqual(resource.toString(), vectorGraphDocumentResource(workspace, document).toString());
		strictEqual(resource.toString() === vectorGraphDocumentResource(document, workspace).toString(), false);
	});
});
