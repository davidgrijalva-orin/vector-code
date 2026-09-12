/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { FileSystemProviderCapabilities, FileType, IFileSystemProviderWithFileReadWriteCapability, IStat, IFileWriteOptions, createFileSystemProviderError, FileSystemProviderErrorCode } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { vectorGraphId } from '../../../../platform/vectorGraph/common/vectorGraphWork.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IVectorGraphDocument } from '../../../../platform/vectorGraph/common/vectorGraphDocuments.js';

export const VECTOR_GRAPH_DOCUMENT_SCHEME = Schemas.vectorGraphDocument;
export function vectorGraphDocumentResource(workspace: string, document: string): URI { return URI.from({ scheme: VECTOR_GRAPH_DOCUMENT_SCHEME, authority: vectorGraphId(workspace), path: '/' + vectorGraphId(document) + '.md' }); }
function identity(resource: URI): { workspace: string; document: string } {
	if (resource.scheme !== VECTOR_GRAPH_DOCUMENT_SCHEME || resource.query || resource.fragment || !/^\/[a-f0-9-]+\.md$/i.test(resource.path)) { throw new Error('Invalid VectorGraph document resource.'); }
	return { workspace: vectorGraphId(resource.authority), document: vectorGraphId(resource.path.slice(1, -3)) };
}
interface BaseRevision { revision: number; version: number }
interface SaveRequest { body: string; revision: number; version: number; id: string }
/** Native text-file models own editing, dirty state, hot-exit backups and Save. */
export class VectorGraphDocumentFileSystem extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {
	readonly capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive;
	readonly onDidChangeCapabilities = Event.None;
	readonly onDidChangeFile = Event.None;
	constructor(@IVectorGraphService private readonly graph: IVectorGraphService, @IStorageService private readonly storage: IStorageService, @IWorkingCopyService private readonly workingCopies: IWorkingCopyService) { super(); }
	private key(resource: URI, suffix: string): string { identity(resource); return 'vectorGraph.document.' + suffix + '.' + resource.toString(); }
	private async fetch(resource: URI): Promise<IVectorGraphDocument> { const id = identity(resource); return this.graph.getDocument(id.workspace, id.document); }
	async stat(resource: URI): Promise<IStat> {
		const record = await this.fetch(resource); const mtime = Date.parse(record.updatedAt);
		if (!Number.isFinite(mtime)) { throw new Error('VectorGraph returned an invalid document timestamp.'); }
		return { type: FileType.File, ctime: 0, mtime, size: VSBuffer.fromString(record.body).byteLength };
	}
	async readFile(resource: URI): Promise<Uint8Array> {
		const record = await this.fetch(resource);
		// A background read must not move the revision under a dirty editor. A clean reload deliberately adopts the new revision.
		if (!this.workingCopies.isDirty(resource)) {
			this.storage.store(this.key(resource, 'base'), { revision: record.revisionNumber, version: record.versionNumber }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		return VSBuffer.fromString(record.body).buffer;
	}
	async writeFile(resource: URI, content: Uint8Array, _options: IFileWriteOptions): Promise<void> {
		const id = identity(resource); const body = new TextDecoder('utf-8', { fatal: true }).decode(content);
		const baseline = this.storage.getObject<BaseRevision>(this.key(resource, 'base'), StorageScope.WORKSPACE);
		if (!baseline) { throw new Error('Reload the document before saving. Recover any unsaved draft first.'); }
		const key = this.key(resource, 'request'); const saved = this.storage.getObject<SaveRequest>(key, StorageScope.WORKSPACE);
		const request = saved?.body === body && saved.revision === baseline.revision && saved.version === baseline.version ? saved : { body, ...baseline, id: generateUuid() };
		this.storage.store(key, request, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const result = await this.graph.saveDocument(id.workspace, id.document, { body, expectedRevisionNumber: request.revision, expectedVersionNumber: request.version }, request.id);
		this.storage.store(this.key(resource, 'base'), { revision: result.revisionNumber, version: result.versionNumber }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this.storage.remove(key, StorageScope.WORKSPACE);
	}
	watch(): IDisposable { return { dispose() { } }; }
	private unsupported(): Promise<never> { return Promise.reject(createFileSystemProviderError('Use VectorGraph document actions for this operation.', FileSystemProviderErrorCode.NoPermissions)); }
	mkdir(): Promise<void> { return this.unsupported(); }
	readdir(): Promise<[string, FileType][]> { return this.unsupported(); }
	delete(): Promise<void> { return this.unsupported(); }
	rename(): Promise<void> { return this.unsupported(); }
}
