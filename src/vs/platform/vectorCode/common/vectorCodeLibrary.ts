/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { URI } from '../../../base/common/uri.js';

export const VECTOR_CODE_LIBRARY_CHANNEL = 'vectorCodeLibraryV1';
export const IVectorCodeLibraryService = createDecorator<IVectorCodeLibraryService>('vectorCodeLibraryService');
export interface LocalProject { id: string; title: string; folders: string[]; revision: number }
export interface LocalNoteRevision { body: string; revision: number; updatedAt: number }
export interface LocalNote extends LocalNoteRevision { createdAt: number; id: string; title: string; projectIds: string[]; history: LocalNoteRevision[] }
export interface LocalLibrary { version: 1; projects: LocalProject[]; notes: LocalNote[] }
export type LibraryMutation = { version: 1; requestId: string } & (
	{ kind: 'createProject'; title: string } |
	{ kind: 'createNote'; title: string; projectIds: string[] } |
	{ kind: 'saveNote'; id: string; expectedRevision: number; body: string } |
	{ kind: 'assignNote'; id: string; expectedRevision: number; projectIds: string[] } |
	{ kind: 'setFolders'; id: string; expectedRevision: number; folders: string[] }
);
export interface LibraryReceipt { id: string; revision: number }
export interface IVectorCodeLibraryService {
	readonly _serviceBrand: undefined;
	read(): Promise<LocalLibrary>;
	findNotes(query: string): Promise<LocalNote[]>;
	mutate(request: LibraryMutation): Promise<LibraryReceipt>;
}
export function localLibraryId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) { throw new Error('Invalid local work identity.'); }
	return value;
}
/** Validate at the service boundary, including calls originating outside the workbench. */
export function validateLibraryMutation(value: unknown): LibraryMutation {
	if (!value || typeof value !== 'object') { throw new Error('Invalid local work request.'); }
	const request = value as LibraryMutation;
	if (request.version !== 1) { throw new Error('Unsupported local work API version.'); }
	localLibraryId(request.requestId);
	const title = (text: unknown): string => {
		if (typeof text !== 'string' || !text.trim() || text.length > 1000) { throw new Error('Enter a title of at most 1000 characters.'); }
		return text.trim();
	};
	const ids = (values: unknown): string[] => {
		if (!Array.isArray(values) || values.length > 100) { throw new Error('Invalid project assignments.'); }
		return [...new Set(values.map(localLibraryId))].sort();
	};
	const base = { version: 1 as const, requestId: request.requestId };
	switch (request.kind) {
		case 'createProject': return { ...base, kind: request.kind, title: title(request.title) };
		case 'createNote': return { ...base, kind: request.kind, title: title(request.title), projectIds: ids(request.projectIds) };
		case 'saveNote': case 'assignNote': case 'setFolders': {
			localLibraryId(request.id);
			if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) { throw new Error('Invalid local work revision.'); }
			const edit = { ...base, kind: request.kind, id: request.id, expectedRevision: request.expectedRevision };
			if (request.kind === 'saveNote') {
				if (typeof request.body !== 'string' || request.body.length > 1024 * 1024) { throw new Error('Notes support up to one million characters.'); }
				return { ...edit, kind: request.kind, body: request.body };
			}
			if (request.kind === 'assignNote') { return { ...edit, kind: request.kind, projectIds: ids(request.projectIds) }; }
			if (!Array.isArray(request.folders) || request.folders.length > 100) { throw new Error('Invalid folder references.'); }
			const folders = request.folders.map(folder => {
				if (typeof folder !== 'string' || folder.length > 8192) { throw new Error('Invalid folder reference.'); }
				const uri = URI.parse(folder);
				if (uri.scheme !== 'file' || uri.query || uri.fragment || !uri.path.startsWith('/')) { throw new Error('Choose a local folder.'); }
				return uri.toString();
			});
			return { ...edit, kind: request.kind, folders: [...new Set(folders)] };
		}
		default: throw new Error('Unsupported local work operation.');
	}
}
/** Only the versioned library API is callable; no paths, filesystem access or arbitrary methods. */
export class VectorCodeLibraryChannel implements IServerChannel {
	constructor(private readonly service: IVectorCodeLibraryService) { }
	listen<T>(): Event<T> { throw new Error('Unsupported local work event.'); }
	async call<T>(_context: unknown, command: string, args: unknown): Promise<T> {
		if (!Array.isArray(args)) { throw new Error('Invalid local work arguments.'); }
		if (command === 'read' && args.length === 0) { return await this.service.read() as T; }
		if (command === 'findNotes' && args.length === 1 && typeof args[0] === 'string') { return await this.service.findNotes(args[0]) as T; }
		if (command === 'mutate' && args.length === 1) { return await this.service.mutate(validateLibraryMutation(args[0])) as T; }
		throw new Error('Unsupported local work operation.');
	}
}
