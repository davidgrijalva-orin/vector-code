/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorCodeLibraryService, LocalNote, localDocumentTabs, localDocumentPages } from '../../../../platform/vectorCode/common/vectorCodeLibrary.js';
import { IVectorCodeRecordingsService } from '../../../../platform/vectorCode/common/vectorCodeRecordings.js';
import { IVectorCodeAudioService } from '../../../../platform/vectorCode/browser/vectorCodeAudio.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { LOCAL_NOTE_SCHEME, localDocumentIdentity } from './vectorCodeLibraryFileSystem.js';
import './media/vectorCodeLocalWork.css';

/** Presentation only. Commands and capability APIs own edits, placement and recovery. */
export class VectorCodeLocalWorkWidget extends Disposable {
	private root!: HTMLElement;
	private list!: HTMLElement;
	private details!: HTMLElement;
	private status!: HTMLElement;
	private scope!: HTMLSelectElement;
	private query!: HTMLInputElement;
	private projectActions!: HTMLElement;
	private selected: string | undefined;
	private generation = 0;
	private visible = false;
	private readonly rows = this._register(new DisposableStore());
	private readonly controls = this._register(new DisposableStore());
	constructor(
		@IVectorCodeLibraryService private readonly library: IVectorCodeLibraryService,
		@IVectorCodeRecordingsService private readonly recordings: IVectorCodeRecordingsService,
		@IVectorCodeAudioService audio: IVectorCodeAudioService,
		@ICommandService private readonly commands: ICommandService,
		@IEditorService editors: IEditorService,
		@IFileService files: IFileService,
		@IStorageService private readonly storage: IStorageService,
	) {
		super();
		this.selected = storage.get('vectorCode.localWork.document', StorageScope.PROFILE);
		this._register(commands.onDidExecuteCommand(event => { if (event.commandId.startsWith('vectorCode.') && this.visible) { void this.refresh(); } }));
		this._register(files.onDidFilesChange(event => { if (this.visible && event.rawUpdated.some(item => item.scheme === LOCAL_NOTE_SCHEME)) { void this.refresh(); } }));
		this._register(audio.onDidFinish(() => { if (this.visible) { void this.refresh(); } }));
		this._register(editors.onDidActiveEditorChange(() => {
			const resource = editors.activeEditor?.resource;
			if (resource?.scheme === LOCAL_NOTE_SCHEME) { this.selected = localDocumentIdentity(resource).id; if (this.visible) { void this.refresh(); } }
		}));
	}
	render(parent: HTMLElement): void {
		this.root = append(parent, $('.vector-local-work'));
		append(this.root, $('h1')).textContent = 'Local work';
		append(this.root, $('p')).textContent = 'Documents, notes and recordings saved on this computer. No account needed.';
		const toolbar = append(this.root, $('.vector-local-work__actions'));
		this.button(toolbar, 'New project', () => this.commands.executeCommand('vectorCode.newLocalProject'), this.controls);
		this.button(toolbar, 'New note', () => this.runForProject('create'), this.controls);
		this.button(toolbar, 'Record in Inbox', () => this.commands.executeCommand('vectorCode.newLocalRecording'), this.controls);
		this.button(toolbar, 'Refresh', () => this.refresh(), this.controls);
		this.scope = append(this.root, $<HTMLSelectElement>('select', { 'aria-label': 'Local project or Inbox' }));
		this.controls.add(addDisposableListener(this.scope, EventType.CHANGE, () => { this.storage.store('vectorCode.localWork.scope', this.scope.value, StorageScope.PROFILE, StorageTarget.MACHINE); void this.refresh(); }));
		this.query = append(this.root, $<HTMLInputElement>('input', { type: 'search', placeholder: 'Search documents and all tabs', 'aria-label': 'Search local documents' }));
		this.controls.add(addDisposableListener(this.query, EventType.INPUT, () => { void this.refresh(); }));
		this.status = append(this.root, $('p', { role: 'status' }));
		this.projectActions = append(this.root, $('.vector-local-work__actions'));
		this.list = append(this.root, $('nav', { 'aria-label': 'Local documents' }));
		this.details = append(this.root, $('section', { 'aria-label': 'Selected document contents' }));
		this.button(this.root, 'Pending changes and recovery…', () => this.commands.executeCommand('vectorCode.localWorkPalette'), this.controls);
	}
	setVisible(visible: boolean): void { this.visible = visible; if (visible) { void this.refresh(); } else { this.generation++; } }
	private button(parent: HTMLElement, title: string, action: () => Promise<unknown>, store = this.rows): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button', { type: 'button' })); button.textContent = title;
		store.add(addDisposableListener(button, EventType.CLICK, () => {
			button.disabled = true;
			void action().then(() => this.refresh(), error => { if (!this._store.isDisposed) { this.status.textContent = toErrorMessage(error); } }).finally(() => { button.disabled = false; });
		})); return button;
	}
	private runForProject(action: 'create' | 'rename' | 'add' | 'folders' | 'openFolders'): Promise<unknown> {
		const id = this.scope.value;
		return id && id !== 'inbox' ? this.commands.executeCommand('vectorCode.localWorkAction', { kind: 'project', id, action }) : this.commands.executeCommand('vectorCode.newLocalNote');
	}
	async refresh(): Promise<void> {
		if (!this.visible || !this.root) { return; }
		const generation = ++this.generation; const query = this.query.value;
		try {
			const library = await this.library.read();
			const notes = query.trim() ? await this.library.findNotes(query) : library.notes;
			if (generation !== this.generation || this._store.isDisposed) { return; }
			const scope = this.storage.get('vectorCode.localWork.scope', StorageScope.PROFILE, '');
			clearNode(this.scope);
			for (const [id, title] of [['', 'All documents'], ['inbox', 'Inbox'], ...library.projects.map(project => [project.id, project.title + ' · ' + project.folders.length + ' folders'])]) {
				const option = append(this.scope, $<HTMLOptionElement>('option')); option.value = id; option.textContent = title;
			}
			this.scope.value = library.projects.some(project => project.id === scope) || scope === 'inbox' ? scope : '';
			this.rows.clear(); clearNode(this.list); clearNode(this.details); clearNode(this.projectActions);
			if (this.scope.value && this.scope.value !== 'inbox') {
				for (const [title, action] of [['Rename project', 'rename'], ['Add folders', 'add'], ['Manage folders', 'folders'], ['Open folders', 'openFolders']] as const) { this.button(this.projectActions, title, () => this.runForProject(action)); }
			}
			const filtered = notes.filter(note => !this.scope.value || (this.scope.value === 'inbox' ? !note.projectIds.length : note.projectIds.includes(this.scope.value)));
			this.status.textContent = filtered.length ? filtered.length + ' documents' : 'No documents here yet. Create a note or record now and organize it later.';
			for (const note of filtered) {
				const button = this.button(this.list, note.title, async () => {
					this.selected = note.id; this.storage.store('vectorCode.localWork.document', note.id, StorageScope.PROFILE, StorageTarget.MACHINE);
					await this.commands.executeCommand('vectorCode.localWorkAction', { kind: 'page', id: note.id, tabId: note.id });
				}); button.setAttribute('aria-current', String(note.id === this.selected));
			}
			const note = filtered.find(note => note.id === this.selected);
			if (note) { await this.renderDocument(note, generation); }
		} catch (error) { if (generation === this.generation && !this._store.isDisposed) { this.status.textContent = toErrorMessage(error); } }
	}
	private async renderDocument(note: LocalNote, generation: number): Promise<void> {
		append(this.details, $('h2')).textContent = note.title;
		const actions = append(this.details, $('.vector-local-work__actions'));
		for (const [title, action] of [['Add page or tab', 'addContent'], ['Record here', 'record'], ['Move or link', 'assign'], ['Rename', 'rename'], ['Export', 'export'], ['History', 'history']] as const) {
			this.button(actions, title, () => this.commands.executeCommand('vectorCode.localWorkAction', { kind: 'note', id: note.id, action }));
		}
		append(this.details, $('h3')).textContent = 'Tabs and pages';
		for (const tab of localDocumentTabs(note)) {
			const group = append(this.details, $('section.vector-local-work__tab')); append(group, $('h4')).textContent = tab.title;
			for (const [index, page] of localDocumentPages(tab).entries()) {
				this.button(group, 'Page ' + (index + 1) + ' · ' + page.title, () => this.commands.executeCommand('vectorCode.localWorkAction', { kind: 'page', id: note.id, tabId: tab.id, pageId: page.id }));
			}
		}
		const recordingsRoot = append(this.details, $('section')); append(recordingsRoot, $('h3')).textContent = 'Recordings';
		try {
			const recordings = await this.recordings.list(note.id);
			if (generation !== this.generation || this._store.isDisposed) { return; }
			if (!recordings.length) { append(recordingsRoot, $('p')).textContent = 'No recordings in this document.'; }
			for (const recording of recordings) {
				const row = append(recordingsRoot, $('.vector-local-work__recording'));
				append(row, $('p')).textContent = new Date(recording.createdAt).toLocaleString() + ' · ' + (recording.status === 'stopped' ? Math.round((recording.durationMs ?? 0) / 1000) + ' seconds' : 'Capturing or unfinished');
				this.button(row, 'Play, file or export recording', () => this.commands.executeCommand('vectorCode.localNoteRecordings', note.id, recording.id));
			}
		} catch (error) { if (generation === this.generation && !this._store.isDisposed) { append(recordingsRoot, $('p', { role: 'status' })).textContent = toErrorMessage(error); this.button(recordingsRoot, 'Retry recordings', () => this.refresh()); } }
	}
}
