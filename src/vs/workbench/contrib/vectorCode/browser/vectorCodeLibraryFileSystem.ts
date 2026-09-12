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
import { IVectorCodeLibraryService, LibraryMutation, localLibraryId, localDocumentTabs } from '../../../../platform/vectorCode/common/vectorCodeLibrary.js';
import { FileSystemProviderCapabilities, FileType, IFileSystemProviderWithFileReadWriteCapability, IStat, IFileWriteOptions, createFileSystemProviderError, FileSystemProviderErrorCode } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';

export const LOCAL_NOTE_SCHEME = Schemas.vectorCodeNote;
export function localNoteResource(id: string, tabId?: string): URI { return URI.from({ scheme: LOCAL_NOTE_SCHEME, path: '/' + localLibraryId(id) + (tabId && tabId !== id ? '/' + localLibraryId(tabId) : '') + '.md' }); }
function identity(resource: URI): string {
	if (resource.scheme !== LOCAL_NOTE_SCHEME || resource.authority || resource.query || resource.fragment || !resource.path.endsWith('.md')) { throw new Error('Invalid local note resource.'); }
	const parts = resource.path.slice(1, -3).split('/');
	if (parts.length > 2 || (parts.length === 2 && parts[0] === parts[1])) { throw new Error('Invalid local document tab resource.'); }
	return parts.map(localLibraryId).join('/');
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
		const [id, tabId] = identity(resource).split('/');
		const note = (await this.library.read()).notes.find(note => note.id === id);
		if (!note) { throw createFileSystemProviderError('Local note not found.', FileSystemProviderErrorCode.FileNotFound); }
		if (!tabId) { return note; }
		const tab = localDocumentTabs(note).find(tab => tab.id === tabId);
		if (!tab) { throw createFileSystemProviderError('Local document tab not found.', FileSystemProviderErrorCode.FileNotFound); }
		return tab;
	}
	async stat(resource: URI): Promise<IStat> { const note = await this.fetch(resource); return { type: FileType.File, ctime: note.createdAt ?? 0, mtime: note.contentUpdatedAt ?? note.updatedAt, size: VSBuffer.fromString(note.body).byteLength }; }
	async readFile(resource: URI): Promise<Uint8Array> {
		const note = await this.fetch(resource);
		if (!this.workingCopies.isDirty(resource)) { this.revisions.set(identity(resource), note.contentRevision ?? note.revision); this.storage.store(this.key(resource, 'revision'), note.contentRevision ?? note.revision, StorageScope.WORKSPACE, StorageTarget.MACHINE); this.storage.remove(this.key(resource, 'request'), StorageScope.WORKSPACE); }
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
			this.revisions.set(id, (receipt.contentRevision ?? receipt.revision));
			this.storage.store(this.key(resource, 'revision'), (receipt.contentRevision ?? receipt.revision), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			this.storage.remove(key, StorageScope.WORKSPACE);
			await this.storage.flush();
			if ((pending.kind === 'saveNote' || pending.kind === 'saveTab') && pending.body === body) { return; }
			return this.writeFile(resource, content, _options);
		}
		const [documentId, tabId] = id.split('/');
		const base = { version: 1 as const, requestId: generateUuid(), id: documentId, expectedRevision, body };
		const request: LibraryMutation = tabId ? { ...base, kind: 'saveTab', tabId } : { ...base, kind: 'saveNote', expectedContentRevision: expectedRevision };
		this.storage.store(key, request, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		await this.storage.flush();
		const receipt = await this.library.mutate(request);
		this.revisions.set(id, (receipt.contentRevision ?? receipt.revision));
		this.storage.store(this.key(resource, 'revision'), (receipt.contentRevision ?? receipt.revision), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this.storage.remove(key, StorageScope.WORKSPACE);
		await this.storage.flush();
	}
	watch(): IDisposable { return { dispose() { } }; }
	private unsupported(): Promise<never> { return Promise.reject(createFileSystemProviderError('Use local work actions for this operation.', FileSystemProviderErrorCode.NoPermissions)); }
	mkdir(): Promise<void> { return this.unsupported(); }
	readdir(): Promise<[string, FileType][]> { return this.unsupported(); }
	delete(): Promise<void> { return this.unsupported(); }
	rename(): Promise<void> { return this.unsupported(); }
}
