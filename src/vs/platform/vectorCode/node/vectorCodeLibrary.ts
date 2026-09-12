/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { hasKey } from '../../../base/common/types.js';
import { join } from '../../../base/common/path.js';
import { IVectorCodeLibraryService, LibraryMutation, LibraryReceipt, LocalLibrary, LocalNote, validateLibraryMutation } from '../common/vectorCodeLibrary.js';

interface LibraryEvent { request: LibraryMutation; at: number }
interface LibraryState { library: LocalLibrary; receipts: Map<string, { fingerprint: string; result: LibraryReceipt }> }
function empty(): LibraryState { return { library: { version: 1, projects: [], notes: [] }, receipts: new Map() }; }
function apply(state: LibraryState, event: LibraryEvent): LibraryReceipt {
	const request = validateLibraryMutation(event.request);
	if (!Number.isSafeInteger(event.at) || event.at < 0) { throw new Error('Invalid local work timestamp.'); }
	const fingerprint = JSON.stringify(request);
	const prior = state.receipts.get(request.requestId);
	if (prior) {
		if (prior.fingerprint !== fingerprint) { throw new Error('This request was already used for a different change.'); }
		return prior.result;
	}
	const { projects, notes } = state.library;
	const checkProjects = (ids: string[]) => { if (ids.some(id => !projects.some(project => project.id === id))) { throw new Error('A selected project no longer exists.'); } };
	let result: LibraryReceipt;
	if (request.kind === 'createProject') {
		projects.push({ id: request.requestId, title: request.title, folders: [], revision: 1 });
		result = { id: request.requestId, revision: 1 };
	} else if (request.kind === 'createNote') {
		checkProjects(request.projectIds);
		notes.push({ id: request.requestId, title: request.title, projectIds: request.projectIds, body: '', revision: 1, createdAt: event.at, updatedAt: event.at, history: [] });
		result = { id: request.requestId, revision: 1 };
	} else {
		const item = request.kind === 'setFolders' ? projects.find(project => project.id === request.id) : notes.find(note => note.id === request.id);
		if (!item) { throw new Error('The local work item does not exist.'); }
		if (item.revision !== request.expectedRevision) { throw new Error('This item changed in another window. Preserve your draft and reload before retrying.'); }
		if (request.kind === 'setFolders' && hasKey(item, { folders: true })) { item.folders = request.folders; }
		if (request.kind !== 'setFolders' && hasKey(item, { body: true })) {
			if (request.kind === 'assignNote') { checkProjects(request.projectIds); item.projectIds = request.projectIds; }
			if (request.kind === 'saveNote') {
				item.history.push({ body: item.body, revision: item.revision, updatedAt: item.updatedAt });
				item.body = request.body;
			}
			item.updatedAt = Math.max(event.at, item.updatedAt + 1);
		}
		item.revision++;
		result = { id: item.id, revision: item.revision };
	}
	state.receipts.set(request.requestId, { fingerprint, result });
	return result;
}
/** One main-process owner serializes windows. The committed journal is the durable source of truth. */
export class VectorCodeLibrary implements IVectorCodeLibraryService {
	declare readonly _serviceBrand: undefined;
	private queue: Promise<unknown> = Promise.resolve();
	private events: LibraryEvent[] | undefined;
	private state = empty();
	constructor(private readonly directory: string) { }
	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.catch(() => undefined);
		return result;
	}
	private async load(): Promise<void> {
		if (this.events) { return; }
		let text: string;
		try { text = await fs.readFile(join(this.directory, 'library-v1.json'), 'utf8'); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.events = []; return; } throw error; }
		const data = JSON.parse(text);
		if (data.version !== 1 || !Array.isArray(data.events)) { throw new Error('The local library cannot be read. Its saved data has been preserved.'); }
		const state = empty();
		for (const event of data.events) { apply(state, event); }
		this.events = data.events;
		this.state = state;
	}
	read(): Promise<LocalLibrary> { return this.serial(async () => { await this.load(); return structuredClone(this.state.library); }); }
	async findNotes(query: string): Promise<LocalNote[]> {
		if (typeof query !== 'string' || query.length > 1000) { throw new Error('Enter a search of at most 1000 characters.'); }
		const library = await this.read();
		const search = query.trim().toLocaleLowerCase();
		return library.notes.filter(note => [note.title, note.body, ...note.projectIds.map(id => library.projects.find(project => project.id === id)?.title ?? '')].some(text => text.toLocaleLowerCase().includes(search)));
	}
	mutate(input: LibraryMutation): Promise<LibraryReceipt> {
		// Copy before queueing so callers cannot change an in-flight request.
		const request = validateLibraryMutation(input);
		return this.serial(async () => {
			await this.load();
			const event = { request, at: Date.now() };
			const candidate = structuredClone(this.state);
			const result = apply(candidate, event);
			if (this.state.receipts.has(request.requestId)) { return { ...result }; }
			const events = [...this.events!, event];
			const text = JSON.stringify({ version: 1, events });
			if (Buffer.byteLength(text) > 64 * 1024 * 1024) { throw new Error('The local library reached its current 64 MB limit. Export your work before adding more.'); }
			await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
			const temporary = join(this.directory, 'library-v1.pending');
			const handle = await fs.open(temporary, 'w', 0o600);
			try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
			// A crash before rename leaves the previous complete journal; retry IDs survive a lost reply after rename.
			await fs.rename(temporary, join(this.directory, 'library-v1.json'));
			this.events = events;
			this.state = candidate;
			if (process.platform !== 'win32') {
				const directory = await fs.open(this.directory, 'r');
				try { await directory.sync(); } finally { await directory.close(); }
			}
			return { ...result };
		});
	}
}
