/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorGraphDocument } from '../../../../platform/vectorGraph/common/vectorGraphDocuments.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import { readVectorGraphBinding } from '../common/vectorGraphBinding.js';
import { VECTOR_GRAPH_DOCUMENT_SCHEME, VectorGraphDocumentFileSystem, vectorGraphDocumentResource } from './vectorGraphDocumentFileSystem.js';

class VectorGraphDocumentsContribution extends Disposable {
	static readonly ID = 'workbench.contrib.vectorGraphDocuments';
	constructor(@IFileService files: IFileService, @IInstantiationService instantiation: IInstantiationService) { super(); const provider = this._register(instantiation.createInstance(VectorGraphDocumentFileSystem)); this._register(files.registerProvider(VECTOR_GRAPH_DOCUMENT_SCHEME, provider)); }
}
registerWorkbenchContribution2(VectorGraphDocumentsContribution.ID, VectorGraphDocumentsContribution, WorkbenchPhase.BlockStartup);
function context(accessor: ServicesAccessor) {
	const projects = accessor.get(IVectorCodeWorkbenchService); const project = projects.getActiveProjectUri()?.toString();
	const storage = accessor.get(IStorageService); const binding = readVectorGraphBinding(storage, project);
	if (!project || !binding) { throw new Error(localize('documentChooseWorkspace', 'Choose the VectorGraph workspace in Work first.')); }
	return { projects, project, storage, binding, graph: accessor.get(IVectorGraphService), quick: accessor.get(IQuickInputService), editors: accessor.get(IEditorService) };
}
function unchanged(value: ReturnType<typeof context>): boolean { const binding = readVectorGraphBinding(value.storage, value.project); return value.projects.getActiveProjectUri()?.toString() === value.project && binding?.workspace.id === value.binding.workspace.id && binding?.team.id === value.binding.team.id && binding?.project?.id === value.binding.project?.id; }
export async function openVectorGraphDocument(editors: IEditorService, workspace: string, document: IVectorGraphDocument): Promise<void> { await editors.openEditor({ resource: vectorGraphDocumentResource(workspace, document.id), label: document.title, description: 'VectorGraph', options: { pinned: true } }); }
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.openDocuments', title: localize2('openDocuments', 'VectorGraph: Open Document'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const value = context(accessor); const documents = await value.graph.listDocuments(value.binding.workspace.id);
		if (!unchanged(value)) { return; }
		const projectId = value.binding.project?.id;
		const linked = documents.filter(document => document.teamId === value.binding.team.id && !!projectId && document.projectIds.includes(projectId));
		let selected = await value.quick.pick([...linked.map(document => ({ label: document.title, description: document.teamId ? value.binding.team.name : '', document })), { label: localize('browseWorkspaceDocuments', 'Browse all workspace documents…'), description: localize('explicitWorkspaceScope', 'Includes documents outside this project'), document: undefined }], { placeHolder: localize('projectDocuments', 'Documents linked to {0}', value.binding.project?.name ?? value.binding.team.name) });
		if (!selected || !unchanged(value)) { return; }
		if (!selected.document) { selected = await value.quick.pick(documents.map(document => ({ label: document.title, description: document.teamId === value.binding.team.id ? value.binding.team.name : localize('workspaceDocument', 'Workspace document'), document })), { placeHolder: localize('workspaceDocuments', 'All documents in {0}', value.binding.workspace.name) }); }
		if (selected?.document && unchanged(value)) { await openVectorGraphDocument(value.editors, value.binding.workspace.id, selected.document); }
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.newDocument', title: localize2('newDocument', 'VectorGraph: New Document'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const value = context(accessor); const projectId = value.binding.project?.id;
		if (!projectId) { throw new Error(localize('documentChooseProject', 'Choose a linked project in Work before creating a document.')); }
		const key = 'vectorGraph.document.create.' + value.binding.workspace.id + '.' + projectId;
		const saved = value.storage.getObject<{ title: string; id: string }>(key, StorageScope.PROFILE);
		const title = await value.quick.input({ title: localize('newDocumentTitle', 'New VectorGraph document'), value: saved?.title, prompt: localize('newDocumentProject', 'Create in {0}', value.binding.project!.name), validateInput: async text => text.trim() && text.length <= 1000 ? undefined : localize('documentTitleRequired', 'Enter a title of at most 1000 characters.') });
		if (!title || !unchanged(value)) { return; }
		const request = saved?.title === title ? saved : { title, id: generateUuid() }; value.storage.store(key, request, StorageScope.PROFILE, StorageTarget.MACHINE);
		const document = await value.graph.createDocument(value.binding.workspace.id, value.binding.team.id, projectId, title, request.id);
		value.storage.remove(key, StorageScope.PROFILE);
		if (unchanged(value)) { await openVectorGraphDocument(value.editors, value.binding.workspace.id, document); }
	}
});
