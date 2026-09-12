/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { basename } from '../../../../base/common/resources.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorCodeLibraryService, LibraryMutation, LocalNote, LocalProject, localDocumentTabs, FileRecordingRequest, RecordingDestination, LibraryReceipt, validateLibraryMutation, localPageBreak } from '../../../../platform/vectorCode/common/vectorCodeLibrary.js';
import { IVectorCodeRecordingsService, LocalRecording } from '../../../../platform/vectorCode/common/vectorCodeRecordings.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { LOCAL_NOTE_SCHEME, localNoteResource, VectorCodeLibraryFileSystem } from './vectorCodeLibraryFileSystem.js';

class LocalLibraryContribution extends Disposable {
	static readonly ID = 'workbench.contrib.vectorCodeLocalLibrary';
	constructor(@IFileService files: IFileService, @IInstantiationService instantiation: IInstantiationService) { super(); const provider = this._register(instantiation.createInstance(VectorCodeLibraryFileSystem)); this._register(files.registerProvider(LOCAL_NOTE_SCHEME, provider)); }
}
registerWorkbenchContribution2(LocalLibraryContribution.ID, LocalLibraryContribution, WorkbenchPhase.BlockStartup);
const pendingKey = 'vectorCode.localLibrary.pending';
function context(accessor: ServicesAccessor) {
	return { recordings: accessor.get(IVectorCodeRecordingsService), workingCopies: accessor.get(IWorkingCopyService), workspaces: accessor.get(IWorkspaceEditingService), commands: accessor.get(ICommandService), storage: accessor.get(IStorageService), library: accessor.get(IVectorCodeLibraryService), quick: accessor.get(IQuickInputService), editors: accessor.get(IEditorService), dialogs: accessor.get(IFileDialogService), files: accessor.get(IFileService) };
}
type LocalWorkContext = ReturnType<typeof context>;

type PendingChange = LibraryMutation | { kind: 'fileRecordingRequest'; request: FileRecordingRequest };
async function executeChange(value: LocalWorkContext, request: PendingChange): Promise<LibraryReceipt> {
	if (request.kind !== 'fileRecordingRequest') { return value.library.mutate(request); }
	const placement = await value.recordings.file(request.request);
	return { id: placement.noteId, tabId: placement.tabId, pageId: placement.pageId, revision: placement.revision };
}
async function mutate(value: LocalWorkContext, request: PendingChange) {
	const storage = value.storage;
	if (storage.getObject(pendingKey, StorageScope.WORKSPACE)) { throw new Error('Open Local Work and retry the pending change first.'); }
	storage.store(pendingKey, request, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	await storage.flush();
	const result = await executeChange(value, request);
	storage.remove(pendingKey, StorageScope.WORKSPACE);
	await storage.flush();
	return result;
}
async function create(value: LocalWorkContext, kind: 'createProject' | 'createNote', projectIds: string[] = [], record = false) {
	const title = record ? 'Recording ' + new Date().toLocaleString() : await value.quick.input({ prompt: kind === 'createProject' ? 'Name this local project. Folders are optional.' : 'Name this note. It is saved on this computer.', validateInput: async value => !value.trim() || value.length > 1000 ? 'Enter a title of at most 1000 characters.' : undefined });
	if (!title) { return; }
	const request = { version: 1 as const, requestId: generateUuid(), title };
	const result = await mutate(value, kind === 'createProject' ? { ...request, kind } : { ...request, kind, projectIds });
	if (kind === 'createNote') { await value.editors.openEditor({ resource: localNoteResource(result.id), label: title, options: { pinned: true } }); if (record) { await value.commands.executeCommand('vectorCode.recordLocalNote', result.id); } }
}
async function chooseDocumentDestination(value: LocalWorkContext, note?: LocalNote, projectIds: string[] = [], record = false): Promise<RecordingDestination | undefined> {
	const documents = (await value.library.read()).notes;
	const choice = documents.length || note ? await value.quick.pick([
		{ label: 'Next page in an existing document tab', kind: 'appendPage' as const },
		{ label: 'New tab in an existing document', kind: 'createTab' as const },
		{ label: 'New document', kind: 'createNote' as const }
	], { title: record ? 'Where should this recording go?' : 'Choose a document destination' }) : { kind: 'createNote' as const };
	if (!choice) { return; }
	if (choice.kind === 'createNote') {
		const title = record ? 'Recording ' + new Date().toLocaleString() : await value.quick.input({ prompt: 'Name the new document.', validateInput: async text => !text.trim() || text.length > 1000 ? 'Enter a title of at most 1000 characters.' : undefined });
		return title ? { kind: 'createNote', title, projectIds } : undefined;
	}
	if (!note) {
		const selected = await value.quick.pick(documents.map(note => ({ label: note.title, note })), { placeHolder: 'Choose the document.' });
		if (!selected) { return; } note = selected.note;
	}
	if (choice.kind === 'createTab') {
		const title = await value.quick.input({ prompt: 'Name the new document tab.', validateInput: async text => !text.trim() || text.length > 1000 ? 'Enter a title of at most 1000 characters.' : undefined });
		return title ? { kind: 'createTab', id: note.id, expectedRevision: note.revision, title } : undefined;
	}
	const selected = await value.quick.pick(localDocumentTabs(note).map(tab => ({ label: tab.title, tab })), { placeHolder: 'Choose the tab to append to.' });
	if (!selected) { return; }
	if (value.workingCopies.isDirty(localNoteResource(note.id, selected.tab.id))) { throw new Error('Save or preserve the open draft in this tab before adding a page.'); }
	return { kind: 'appendPage', id: note.id, tabId: selected.tab.id, expectedRevision: selected.tab.contentRevision };
}
async function openDestination(value: LocalWorkContext, receipt: LibraryReceipt): Promise<void> {
	const note = (await value.library.read()).notes.find(note => note.id === receipt.id);
	const tab = note && localDocumentTabs(note).find(tab => tab.id === (receipt.tabId ?? note.id));
	const marker = receipt.pageId ? localPageBreak(receipt.pageId) : undefined;
	const offset = marker && tab ? tab.body.indexOf(marker) : -1;
	const selection = offset >= 0 && marker && tab ? { startLineNumber: tab.body.slice(0, offset + marker.length).split('\n').length, startColumn: 1 } : undefined;
	await value.editors.openEditor({ resource: localNoteResource(receipt.id, receipt.tabId), label: note ? note.title + ' · ' + (tab?.title ?? 'Notes') : undefined, options: { pinned: true, forceReload: !!receipt.pageId, selection } });
}
async function addDocumentContent(value: LocalWorkContext, note?: LocalNote, projectIds: string[] = [], record = false) {
	const destination = await chooseDocumentDestination(value, note, projectIds, record);
	if (!destination) { return; }
	const request = validateLibraryMutation({ ...destination, version: 1, requestId: generateUuid(), ...(destination.kind === 'appendPage' ? { body: '' } : {}) });
	const receipt = await mutate(value, request);
	await openDestination(value, receipt);
	if (record) { await value.commands.executeCommand('vectorCode.recordLocalNote', receipt.id, receipt.tabId, receipt.pageId); }
}
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.fileLocalRecording', title: localize2('fileLocalRecording', 'Work: File a Recording in a Document'), f1: false }); }
	async run(accessor: ServicesAccessor, recording: LocalRecording): Promise<void> {
		const value = context(accessor);
		const destination = await chooseDocumentDestination(value);
		if (!destination) { return; }
		const receipt = await mutate(value, { kind: 'fileRecordingRequest', request: { version: 1, requestId: generateUuid(), recordingId: recording.id, expectedPlacementRevision: recording.placement?.revision ?? 0, destination } });
		await openDestination(value, receipt);
	}
});
async function openDocument(value: LocalWorkContext, note: LocalNote) {
	const tabs = localDocumentTabs(note);
	const tab = tabs.length === 1 ? tabs[0] : (await value.quick.pick(tabs.map(tab => ({ label: tab.title, tab })), { title: note.title, placeHolder: 'Open a document tab.' }))?.tab;
	if (tab) { await value.editors.openEditor({ resource: localNoteResource(note.id, tab.id), label: note.title + ' · ' + tab.title, options: { pinned: true } }); }
}
async function rename(value: LocalWorkContext, item: LocalNote | LocalProject, kind: 'renameNote' | 'renameProject') {
	const title = await value.quick.input({ value: item.title, prompt: 'Rename this local work item.', validateInput: async text => !text.trim() || text.length > 1000 ? 'Enter a title of at most 1000 characters.' : undefined });
	if (title && title !== item.title) { await mutate(value, { version: 1, requestId: generateUuid(), kind, id: item.id, expectedRevision: item.revision, title }); }
}
async function noteActions(value: LocalWorkContext, note: LocalNote) {
	const quick = value.quick; const editors = value.editors;
	const action = await quick.pick([
		{ label: 'Open document tab…', kind: 'open' }, { label: 'Rename document…', kind: 'rename' }, { label: 'Start recording in this document…', kind: 'record' }, { label: 'Play or export recordings…', kind: 'recordings' }, { label: 'Move or link to projects…', kind: 'assign' },
		{ label: 'Export saved document as Markdown…', kind: 'export' }, { label: 'Open a previous revision as a draft…', kind: 'history' }, { label: 'Add note: next page, new tab, or new document…', kind: 'addContent' }
	], { title: note.title });
	if (!action) { return; }
	if (action.kind === 'rename') { await rename(value, note, 'renameNote'); }
	if (action.kind === 'record') { await addDocumentContent(value, note, note.projectIds, true); }
	if (action.kind === 'recordings') { await value.commands.executeCommand('vectorCode.localNoteRecordings', note.id); }
	if (action.kind === 'open') { await openDocument(value, note); }
	if (action.kind === 'addContent') { await addDocumentContent(value, note, note.projectIds); }
	if (action.kind === 'assign') {
		const library = await value.library.read();
		const selected = await quick.pick(library.projects.map(project => ({ label: project.title, id: project.id, picked: note.projectIds.includes(project.id) })), { canPickMany: true, placeHolder: 'Choose projects; clear all to return this note to Inbox.' });
		if (selected) { await mutate(value, { version: 1, requestId: generateUuid(), kind: 'assignNote', id: note.id, expectedRevision: note.revision, projectIds: selected.map(project => project.id) }); }
	}
	if (action.kind === 'export') {
		const target = await value.dialogs.showSaveDialog({ title: 'Export saved document', filters: [{ name: 'Markdown', extensions: ['md'] }] });
		if (target) { const current = (await value.library.read()).notes.find(value => value.id === note.id); if (current) { const tabs = localDocumentTabs(current); await value.files.writeFile(target, VSBuffer.fromString(tabs.length === 1 ? tabs[0].body : tabs.map(tab => '# ' + tab.title + '\n\n' + tab.body).join('\n\n'))); } }
	}
	if (action.kind === 'history') {
		const selected = await quick.pick(localDocumentTabs(note).map(tab => ({ label: tab.title, tab })), { placeHolder: 'Choose a document tab.' });
		if (!selected) { return; }
		const revision = await quick.pick([...selected.tab.history].reverse().map(revision => ({ label: 'Revision ' + revision.revision, description: new Date(revision.updatedAt).toLocaleString(), revision })), { placeHolder: 'Open a copy without overwriting the saved note.' });
		if (revision) { await editors.openEditor({ contents: revision.revision.body, languageId: 'markdown', options: { pinned: true } }); }
	}
}
async function projectActions(value: LocalWorkContext, project: LocalProject) {
	const quick = value.quick;
	const library = await value.library.read();
	const action = await quick.pick([
		{ label: 'New note', kind: 'create', note: undefined },
		{ label: 'Rename project…', kind: 'rename', note: undefined },
		{ label: 'Add folders…', kind: 'add', note: undefined },
		{ label: 'Manage folder references…', kind: 'folders', note: undefined },
		...(project.folders.length ? [{ label: 'Open project folders…', kind: 'openFolders', note: undefined }] : []),
		...library.notes.filter(note => note.projectIds.includes(project.id)).map(note => ({ label: note.title, kind: 'note', note }))
	], { title: project.title, placeHolder: 'Local project · ' + project.folders.length + ' folders' });
	if (!action) { return; }
	if (action.kind === 'openFolders') {
		const selected = await quick.pick(project.folders.map(folder => ({ label: basename(URI.parse(folder)), description: URI.parse(folder).fsPath, folder, picked: true })), { canPickMany: true, placeHolder: 'Open selected folders in this window using the normal workspace and trust controls.' });
		if (selected?.length) { await value.workspaces.addFolders(selected.map(item => ({ uri: URI.parse(item.folder) }))); }
	}
	if (action.kind === 'rename') { await rename(value, project, 'renameProject'); }
	if (action.kind === 'create') { await addDocumentContent(value, undefined, [project.id]); }
	if (action.note) { await noteActions(value, action.note); }
	let folders: string[] | undefined;
	if (action.kind === 'add') {
		const selected = await value.dialogs.showOpenDialog({ title: 'Add project folder references', canSelectFolders: true, canSelectFiles: false, canSelectMany: true });
		if (selected) { folders = [...project.folders, ...selected.map(uri => uri.toString())]; }
	}
	if (action.kind === 'folders') {
		const selected = await quick.pick(project.folders.map(folder => ({ label: basename(URI.parse(folder)), description: URI.parse(folder).fsPath, folder, picked: true })), { canPickMany: true, placeHolder: 'Keep selected references. Files and folder permissions are unchanged.' });
		if (selected) { folders = selected.map(item => item.folder); }
	}
	if (folders) { await mutate(value, { version: 1, requestId: generateUuid(), kind: 'setFolders', id: project.id, expectedRevision: project.revision, folders }); }
}
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.openLocalWork', title: localize2('openLocalWork', 'Work: Open Local Work'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const value = context(accessor);
		const quick = value.quick; const service = value.library; const storage = value.storage;
		const pending = storage.getObject<PendingChange>(pendingKey, StorageScope.WORKSPACE);
		if (pending) {
			const retry = await quick.pick([{ label: 'Retry pending change', retry: true, dismiss: false }, { label: 'Keep the pending change for later', retry: false, dismiss: false }, { label: 'Dismiss request and inspect saved work', retry: false, dismiss: true }], { placeHolder: 'The previous change may have been saved. Retry safely with its original identity.' });
			if (retry?.dismiss) { storage.remove(pendingKey, StorageScope.WORKSPACE); }
			if (retry?.retry) { const receipt = await executeChange(value, pending); storage.remove(pendingKey, StorageScope.WORKSPACE); await storage.flush(); if (pending.kind === 'fileRecordingRequest') { await openDestination(value, receipt); } }
			return;
		}
		const library = await service.read();
		const choice = await quick.pick([
			{ label: 'New local project', kind: 'project', project: undefined },
			{ label: 'New note…', kind: 'note', project: undefined },
			{ label: 'Inbox', description: String(library.notes.filter(note => !note.projectIds.length).length) + ' notes', kind: 'inbox', project: undefined },
			{ label: 'Find a note…', kind: 'find', project: undefined },
			{ label: 'Start a recording in Inbox…', kind: 'record', project: undefined },
			...library.projects.map(project => ({ label: project.title, kind: 'open', project }))
		], { title: 'Local Work', placeHolder: 'Saved on this computer · no account needed' });
		if (!choice) { return; }
		if (choice.kind === 'project') { await create(value, 'createProject'); }
		if (choice.kind === 'record') { await create(value, 'createNote', [], true); }
		if (choice.kind === 'note') { await addDocumentContent(value); }
		if (choice.project) { await projectActions(value, choice.project); }
		if (choice.kind === 'inbox' || choice.kind === 'find') {
			const query = choice.kind === 'find' ? await quick.input({ prompt: 'Search the full text of local notes, titles, and project names.' }) : '';
			if (query === undefined) { return; }
			const notes = choice.kind === 'inbox' ? library.notes.filter(note => !note.projectIds.length) : await service.findNotes(query);
			const selected = await quick.pick(notes.map(note => ({ label: note.title, description: note.projectIds.map(id => library.projects.find(project => project.id === id)?.title).join(', ') || 'Inbox', detail: note.body.replace(/\s+/g, ' ').slice(0, 2000), note })), { matchOnDescription: true, matchOnDetail: true, placeHolder: choice.kind === 'inbox' ? 'Notes without a project' : 'Matching notes · filter the results by title' });
			if (selected) { await noteActions(value, selected.note); }
		}
	}
});

for (const action of [
	{ id: 'vectorCode.newLocalNote', title: localize2('newLocalNote', 'Work: New Local Note'), kind: 'createNote' as const, record: false },
	{ id: 'vectorCode.newLocalProject', title: localize2('newLocalProject', 'Work: New Local Project'), kind: 'createProject' as const, record: false },
	{ id: 'vectorCode.newLocalRecording', title: localize2('newLocalRecording', 'Work: Start Recording in Inbox'), kind: 'createNote' as const, record: true }
]) {
	registerAction2(class extends Action2 {
		constructor() { super({ id: action.id, title: action.title, f1: true }); }
		async run(accessor: ServicesAccessor): Promise<void> { const value = context(accessor); if (action.kind === 'createNote' && !action.record) { await addDocumentContent(value); } else { await create(value, action.kind, [], action.record); } }
	});
}
