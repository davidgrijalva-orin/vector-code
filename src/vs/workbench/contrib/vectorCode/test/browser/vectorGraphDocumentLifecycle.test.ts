/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { createTextBufferFactory } from '../../../../../editor/common/model/textModel.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IVectorGraphService } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { IWorkingCopyBackupService } from '../../../../services/workingCopy/common/workingCopyBackup.js';
import { TextFileEditorModel } from '../../../../services/textfile/common/textFileEditorModel.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { VECTOR_GRAPH_DOCUMENT_SCHEME, VectorGraphDocumentFileSystem, vectorGraphDocumentResource } from '../../browser/vectorGraphDocumentFileSystem.js';

suite('VectorGraph document file-model lifecycle', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('edit, save, reopen, conflict and hot-exit recovery use the real file model and provider', async () => {
		const workspace = 'bf275fab-fe03-44c3-b993-ced522c45a07';
		const id = '658d2b51-5118-46d4-8b60-bf1954501284';
		const resource = vectorGraphDocumentResource(workspace, id);
		let record = { id, title: 'Brief', body: '# Original', projectIds: [], revisionNumber: 1, versionNumber: 1, updatedAt: '2026-09-12T19:00:00.000Z' };
		const graph = {
			getDocument: async () => ({ ...record }),
			saveDocument: async (_workspace: string, _id: string, save: { body: string; expectedRevisionNumber: number }) => {
				if (save.expectedRevisionNumber !== record.revisionNumber) { throw new Error('Document version conflict'); }
				record = { ...record, body: save.body, revisionNumber: record.revisionNumber + 1, versionNumber: record.versionNumber + 1 };
				return { ...record };
			}
		} as unknown as IVectorGraphService;
		const files = store.add(new FileService(new NullLogService()));
		const inst = workbenchInstantiationService({ fileService: () => files }, store);
		const provider = store.add(new VectorGraphDocumentFileSystem(graph, inst.get(IStorageService), inst.get(IWorkingCopyService)));
		store.add(files.registerProvider(VECTOR_GRAPH_DOCUMENT_SCHEME, provider));
		const model = store.add(inst.createInstance(TextFileEditorModel, resource, 'utf8', undefined));
		await model.resolve();
		strictEqual(model.textEditorModel!.getValue(), '# Original');
		model.updateTextEditorModel(createTextBufferFactory('# Saved brief'));
		strictEqual(await model.save(), true);
		strictEqual(record.body, '# Saved brief'); strictEqual(record.revisionNumber, 2);
		model.dispose();
		const reopened = store.add(inst.createInstance(TextFileEditorModel, resource, 'utf8', undefined));
		await reopened.resolve();
		strictEqual(reopened.textEditorModel!.getValue(), '# Saved brief');
		reopened.updateTextEditorModel(createTextBufferFactory('# Unsaved local revision'));
		record = { ...record, body: '# Concurrent web revision', revisionNumber: 3, versionNumber: 3 };
		strictEqual(await reopened.save(), false);
		strictEqual(reopened.isDirty(), true);
		strictEqual(reopened.textEditorModel!.getValue(), '# Unsaved local revision');
		strictEqual(record.body, '# Concurrent web revision');
		const backup = await reopened.backup(CancellationToken.None);
		await inst.get(IWorkingCopyBackupService).backup(reopened, backup.content, undefined, backup.meta);
		reopened.dispose();
		const restored = store.add(inst.createInstance(TextFileEditorModel, resource, 'utf8', undefined));
		await restored.resolve();
		strictEqual(restored.isDirty(), true);
		strictEqual(restored.textEditorModel!.getValue(), '# Unsaved local revision');
		strictEqual(await restored.save(), false);
		strictEqual(record.body, '# Concurrent web revision');
	});
});
