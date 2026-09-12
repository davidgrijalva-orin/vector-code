/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphBinding, IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorGraphDocument } from '../../../../platform/vectorGraph/common/vectorGraphDocuments.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import { readSelectedWorkProject } from '../common/vectorCodeWorkProject.js';
import { manageWorkProjectFolders, workProjectFolderItems } from './vectorCodeWorkProject.js';
import { chooseDocumentScope, chooseDocumentWorkProject, VectorGraphDocumentContext } from './vectorGraphDocumentContext.js';
import { VECTOR_GRAPH_DOCUMENT_SCHEME, VectorGraphDocumentFileSystem, vectorGraphDocumentResource } from './vectorGraphDocumentFileSystem.js';

class VectorGraphDocumentsContribution extends Disposable {
	static readonly ID = 'workbench.contrib.vectorGraphDocuments';
	constructor(@IFileService files: IFileService, @IInstantiationService instantiation: IInstantiationService) { super(); const provider = this._register(instantiation.createInstance(VectorGraphDocumentFileSystem)); this._register(files.registerProvider(VECTOR_GRAPH_DOCUMENT_SCHEME, provider)); }
}
registerWorkbenchContribution2(VectorGraphDocumentsContribution.ID, VectorGraphDocumentsContribution, WorkbenchPhase.BlockStartup);
function context(accessor: ServicesAccessor, workProject = false) {
	const projects = accessor.get(IVectorCodeWorkbenchService);
	const storage = accessor.get(IStorageService); const graph = accessor.get(IVectorGraphService);
	const selection = new VectorGraphDocumentContext(storage, projects, graph, workProject);
	const binding = selection.binding;
	if (!binding) {
		selection.dispose();
		throw new Error(localize('documentChooseWorkspace', 'Choose a linked project in Work, or use Open Work Project.'));
	}
	return { selection, storage, binding, graph, quick: accessor.get(IQuickInputService), editors: accessor.get(IEditorService) };
}
function unchanged(value: ReturnType<typeof context>): boolean { return value.selection.isCurrent(); }
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.openWorkProject', title: localize2('openWorkProject', 'VectorGraph: Open Work Project'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const projects = accessor.get(IVectorCodeWorkbenchService); const graph = accessor.get(IVectorGraphService);
		const storage = accessor.get(IStorageService); const quick = accessor.get(IQuickInputService); const commands = accessor.get(ICommandService);
		const selection = new VectorGraphDocumentContext(storage, projects, graph);
		try {
			const binding = await chooseDocumentWorkProject(graph, quick, storage, () => selection.isCurrent());
			if (binding) { await commands.executeCommand('vectorCode.showWorkProject'); }
		} finally { selection.dispose(); }
	}
});
async function openDocument(editors: IEditorService, workspace: string, document: IVectorGraphDocument): Promise<void> { await editors.openEditor({ resource: vectorGraphDocumentResource(workspace, document.id), label: document.title, description: 'VectorGraph', options: { pinned: true } }); }
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.openDocuments', title: localize2('openDocuments', 'VectorGraph: Open Document'), f1: true }); }
	async run(accessor: ServicesAccessor, workProject = false): Promise<void> {
		const value = context(accessor, workProject);
		try {
			const documents = await value.graph.listDocuments(value.binding.workspace.id);
			if (!unchanged(value)) { return; }
			const projectId = value.binding.project?.id;
			const linked = documents.filter(document => document.teamId === value.binding.team.id && !!projectId && document.projectIds.includes(projectId));
			let selected = await value.quick.pick([...linked.map(document => ({ label: document.title, description: document.teamId ? value.binding.team.name : '', document })), { label: localize('browseWorkspaceDocuments', 'Browse all workspace documents…'), description: localize('explicitWorkspaceScope', 'Includes documents outside this project'), document: undefined }], { placeHolder: localize('projectDocuments', 'Documents linked to {0}', value.binding.project?.name ?? value.binding.team.name) });
			if (!selected || !unchanged(value)) { return; }
			if (!selected.document) { selected = await value.quick.pick(documents.map(document => ({ label: document.title, description: document.teamId === value.binding.team.id ? value.binding.team.name : localize('workspaceDocument', 'Workspace document'), document })), { placeHolder: localize('workspaceDocuments', 'All documents in {0}', value.binding.workspace.name) }); }
			if (selected?.document && unchanged(value)) { await openDocument(value.editors, value.binding.workspace.id, selected.document); }
		} finally { value.selection.dispose(); }
	}
});
async function createDocument(value: { storage: IStorageService; graph: IVectorGraphService; quick: IQuickInputService; editors: IEditorService; selection: VectorGraphDocumentContext }, binding: IVectorGraphBinding): Promise<void> {
	const projectId = binding.project?.id;
	const key = projectId ? 'vectorGraph.document.create.' + binding.workspace.id + '.' + projectId
		: 'vectorGraph.note.create.' + binding.workspace.id + '.' + binding.team.id;
	type PendingCreate = { title: string; id: string };
	const pending = value.storage.getObject<PendingCreate>(key, StorageScope.PROFILE);
	let title: string | undefined;
	if (pending) {
		const retry = await value.quick.pick([{ label: localize('retryDocumentCreation', 'Retry creating {0}', pending.title), value: pending.title }], {
			placeHolder: localize('pendingDocumentCreation', 'The previous save is not confirmed. Retry it to recover the original result.')
		});
		title = retry?.value;
	} else {
		title = await value.quick.input({
			title: projectId ? localize('newDocumentTitle', 'New VectorGraph document') : localize('newNoteTitle', 'New note'),
			prompt: projectId ? localize('newDocumentProject', 'Create in {0}', binding.project!.name)
				: localize('newNoteAudience', 'Save without a project. Workspace: {0}. Team: {1}.', binding.workspace.name, binding.team.name),
			validateInput: async text => text.trim() && text.length <= 1000 ? undefined : localize('documentTitleRequired', 'Enter a title of at most 1000 characters.')
		});
	}
	if (!title || !value.selection.isCurrent()) { return; }
	const current = value.storage.getObject<PendingCreate>(key, StorageScope.PROFILE);
	if (current && current.title !== title) { throw new Error(localize('otherDocumentPending', 'Another document save is awaiting confirmation. Retry that save first.')); }
	const request = current ?? pending ?? { title, id: generateUuid() };
	value.storage.store(key, request, StorageScope.PROFILE, StorageTarget.MACHINE);
	const document = await value.graph.createDocument(binding.workspace.id, binding.team.id, projectId, request.title, request.id);
	if (value.storage.getObject<PendingCreate>(key, StorageScope.PROFILE)?.id === request.id) { value.storage.remove(key, StorageScope.PROFILE); }
	if (value.selection.isCurrent()) { await openDocument(value.editors, binding.workspace.id, document); }
}

registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.newDocument', title: localize2('newDocument', 'VectorGraph: New Document'), f1: true }); }
	async run(accessor: ServicesAccessor, workProject = false): Promise<void> {
		const value = context(accessor, workProject);
		try {
			const projectId = value.binding.project?.id;
			if (!projectId) { throw new Error(localize('documentChooseProject', 'Choose a linked project in Work before creating a document.')); }
			await createDocument(value, value.binding);
		} finally { value.selection.dispose(); }
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.showWorkProject', title: localize2('showWorkProject', 'VectorGraph: Show Work Project'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const projects = accessor.get(IVectorCodeWorkbenchService); const storage = accessor.get(IStorageService);
		const graph = accessor.get(IVectorGraphService); const quick = accessor.get(IQuickInputService); const commands = accessor.get(ICommandService);
		const binding = readSelectedWorkProject(storage);
		if (!binding) { await commands.executeCommand('vectorCode.openWorkProject'); return; }
		const selection = new VectorGraphDocumentContext(storage, projects, graph, true);
		try {
			const folders = workProjectFolderItems(storage, binding, projects.getProjectSummaries());
			const action = await quick.pick([
				{ label: localize('workProjectOpenDocument', 'Open Document'), command: 'vectorCode.openDocuments', folder: undefined },
				{ label: localize('workProjectNewDocument', 'New Document'), command: 'vectorCode.newDocument', folder: undefined },
				{ label: localize('workProjectManageFolders', 'Manage Folders…'), command: 'folders', folder: undefined },
				{ label: localize('workProjectChange', 'Choose Another Work Project…'), command: 'vectorCode.openWorkProject', folder: undefined },
				...folders.map(folder => ({ label: folder.label, description: folder.description, command: '', folder }))
			], { title: binding.project!.name, placeHolder: localize('workProjectResources', '{0} folders • {1} / {2}', folders.length, binding.workspace.name, binding.team.name) });
			if (!action || !selection.isCurrent()) { return; }
			if (action.folder) {
				if (!projects.getProjectSummaries().some(folder => folder.uri.toString() === action.folder!.uri)) {
					throw new Error(localize('workProjectFolderUnavailable', 'This folder is still associated with the project. Add it to this window to open it.'));
				}
				await projects.switchProject(URI.parse(action.folder.uri));
			} else if (action.command === 'folders') {
				await manageWorkProjectFolders(storage, quick, binding, projects.getProjectSummaries(), () => selection.isCurrent());
			} else { await commands.executeCommand(action.command, true); }
		} finally { selection.dispose(); }
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.newNote', title: localize2('newNote', 'VectorGraph: New Note Without a Project'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const projects = accessor.get(IVectorCodeWorkbenchService); const storage = accessor.get(IStorageService); const graph = accessor.get(IVectorGraphService);
		const quick = accessor.get(IQuickInputService); const editors = accessor.get(IEditorService);
		const selection = new VectorGraphDocumentContext(storage, projects, graph);
		try {
			const binding = await chooseDocumentScope(graph, quick, () => selection.isCurrent());
			if (binding && selection.isCurrent()) { await createDocument({ storage, graph, quick, editors, selection }, binding); }
		} finally { selection.dispose(); }
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.browseDocuments', title: localize2('browseDocuments', 'VectorGraph: Browse Team Documents'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const projects = accessor.get(IVectorCodeWorkbenchService); const storage = accessor.get(IStorageService); const graph = accessor.get(IVectorGraphService);
		const quick = accessor.get(IQuickInputService); const editors = accessor.get(IEditorService);
		const selection = new VectorGraphDocumentContext(storage, projects, graph);
		try {
			const binding = await chooseDocumentScope(graph, quick, () => selection.isCurrent());
			if (!binding || !selection.isCurrent()) { return; }
			const documents = await graph.listDocuments(binding.workspace.id);
			if (!selection.isCurrent()) { return; }
			const selected = await quick.pick(documents.filter(document => document.teamId === binding.team.id).map(document => ({ label: document.title, document })), {
				title: localize('teamDocuments', 'Documents in {0} / {1}', binding.workspace.name, binding.team.name),
				placeHolder: localize('teamDocumentsHint', 'Includes notes saved without choosing a project')
			});
			if (selected && selection.isCurrent()) { await openDocument(editors, binding.workspace.id, selected.document); }
		} finally { selection.dispose(); }
	}
});
