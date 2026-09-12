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
import { IVectorCodeLibraryService, LibraryMutation, localLibraryId } from '../../../../platform/vectorCode/common/vectorCodeLibrary.js';
import { FileSystemProviderCapabilities, FileType, IFileSystemProviderWithFileReadWriteCapability, IStat, IFileWriteOptions, createFileSystemProviderError, FileSystemProviderErrorCode } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';

export const LOCAL_NOTE_SCHEME = Schemas.vectorCodeNote;
export function localNoteResource(id: string): URI { return URI.from({ scheme: LOCAL_NOTE_SCHEME, path: '/' + localLibraryId(id) + '.md' }); }
function identity(resource: URI): string {
	if (resource.scheme !== LOCAL_NOTE_SCHEME || resource.authority || resource.query || resource.fragment || !resource.path.endsWith('.md')) { throw new Error('Invalid local note resource.'); }
	return localLibraryId(resource.path.slice(1, -3));
}
/** An API adapter. Native text-file models retain dirty drafts, hot-exit backups, encoding and Save. */
export class VectorCodeLibraryFileSystem extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {
	private readonly revisions = new Map<string, number>();
	readonly capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive;
	readonly onDidChangeCapabilities = Event.None;
	readonly onDidChangeFile = Event.None;
	constructor(@IVectorCodeLibraryService private readonly library: IVectorCodeLibraryService, @IStorageService private readonly storage: IStorageService, @IWorkingCopyService private readonly workingCopies: IWorkingCopyService) { super(); }
	private key(resource: URI, part: string): string { return 'vectorCode.localNote.' + identity(resource) + '.' + part; }
	private async fetch(resource: URI) {
		const id = identity(resource);
		const note = (await this.library.read()).notes.find(note => note.id === id);
		if (!note) { throw createFileSystemProviderError('Local note not found.', FileSystemProviderErrorCode.FileNotFound); }
		return note;
	}
	async stat(resource: URI): Promise<IStat> { const note = await this.fetch(resource); return { type: FileType.File, ctime: 0, mtime: note.updatedAt, size: VSBuffer.fromString(note.body).byteLength }; }
	async readFile(resource: URI): Promise<Uint8Array> {
		const note = await this.fetch(resource);
		if (!this.workingCopies.isDirty(resource)) { this.revisions.set(identity(resource), note.revision); this.storage.store(this.key(resource, 'revision'), note.revision, StorageScope.WORKSPACE, StorageTarget.MACHINE); this.storage.remove(this.key(resource, 'request'), StorageScope.WORKSPACE); }
		return VSBuffer.fromString(note.body).buffer;
	}
	async writeFile(resource: URI, content: Uint8Array, _options: IFileWriteOptions): Promise<void> {
		const id = identity(resource);
		const body = new TextDecoder('utf-8', { fatal: true }).decode(content);
		const expectedRevision = this.revisions.get(id) ?? this.storage.getNumber(this.key(resource, 'revision'), StorageScope.WORKSPACE);
		if (!expectedRevision) { throw new Error('Preserve the draft and reload this note before saving.'); }
		const key = this.key(resource, 'request');
		const pending = this.storage.getObject<LibraryMutation>(key, StorageScope.WORKSPACE);
		// Finish a previously uncertain write before saving subsequent edits. Never silently drop its retry identity.
		if (pending) {
			const receipt = await this.library.mutate(pending);
			this.revisions.set(id, receipt.revision);
			this.storage.store(this.key(resource, 'revision'), receipt.revision, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			this.storage.remove(key, StorageScope.WORKSPACE);
			if (pending.kind === 'saveNote' && pending.body === body) { return; }
			return this.writeFile(resource, content, _options);
		}
		const request: LibraryMutation = { version: 1, requestId: generateUuid(), kind: 'saveNote', id, expectedRevision, body };
		this.storage.store(key, request, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const receipt = await this.library.mutate(request);
		this.revisions.set(id, receipt.revision);
		this.storage.store(this.key(resource, 'revision'), receipt.revision, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this.storage.remove(key, StorageScope.WORKSPACE);
	}
	watch(): IDisposable { return { dispose() { } }; }
	private unsupported(): Promise<never> { return Promise.reject(createFileSystemProviderError('Use local work actions for this operation.', FileSystemProviderErrorCode.NoPermissions)); }
	mkdir(): Promise<void> { return this.unsupported(); }
	readdir(): Promise<[string, FileType][]> { return this.unsupported(); }
	delete(): Promise<void> { return this.unsupported(); }
	rename(): Promise<void> { return this.unsupported(); }
}
