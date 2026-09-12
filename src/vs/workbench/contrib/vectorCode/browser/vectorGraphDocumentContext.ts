/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphBinding, IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import { VECTOR_GRAPH_BINDING_KEY, readVectorGraphBinding } from '../common/vectorGraphBinding.js';
import { readSelectedWorkProject, readWorkProjectFolders, VECTOR_CODE_WORK_PROJECT_KEY, workProjectFolderKey } from '../common/vectorCodeWorkProject.js';

/** A selected backend project is presentation state, never a local execution grant. */
export function readDocumentBinding(storage: IStorageService, localProject: string | undefined): IVectorGraphBinding | undefined {
	const selected = readSelectedWorkProject(storage);
	if (localProject) {
		return selected && readWorkProjectFolders(storage, selected)?.includes(localProject) ? selected : readVectorGraphBinding(storage, localProject);
	}
	return selected;
}

/** Invalidates pending dialogs even when a user switches away and back again. */
export class VectorGraphDocumentContext extends Disposable {
	private valid = true;
	readonly localProject: string | undefined;
	readonly binding: IVectorGraphBinding | undefined;
	constructor(
		private readonly storage: IStorageService,
		private readonly projects: IVectorCodeWorkbenchService,
		graph: IVectorGraphService,
		private readonly workProject = false,
	) {
		super();
		this.localProject = projects.getActiveProjectUri()?.toString();
		this.binding = workProject ? readSelectedWorkProject(storage) : readDocumentBinding(storage, this.localProject);
		this._register(projects.onDidChangeActiveProject(() => { this.valid = false; }));
		this._register(graph.onDidChangeSession(() => { this.valid = false; }));
		this._register(storage.onDidChangeValue(StorageScope.WORKSPACE, VECTOR_CODE_WORK_PROJECT_KEY, this._store)(() => { this.valid = false; }));
		if (this.localProject) { this._register(storage.onDidChangeValue(StorageScope.PROFILE, VECTOR_GRAPH_BINDING_KEY + this.localProject, this._store)(() => { this.valid = false; })); }
		const selected = readSelectedWorkProject(storage);
		if (selected) { this._register(storage.onDidChangeValue(StorageScope.PROFILE, workProjectFolderKey(selected), this._store)(() => { this.valid = false; })); }
	}
	isCurrent(): boolean {
		const binding = this.workProject ? readSelectedWorkProject(this.storage) : readDocumentBinding(this.storage, this.localProject);
		return this.valid && this.localProject === this.projects.getActiveProjectUri()?.toString()
			&& binding?.workspace.id === this.binding?.workspace.id
			&& binding?.team.id === this.binding?.team.id
			&& binding?.project?.id === this.binding?.project?.id;
	}
}

/** Choose an authorized storage audience independently of any project or folder. */
export async function chooseDocumentScope(
	graph: IVectorGraphService,
	quick: IQuickInputService,
	isCurrent: () => boolean,
): Promise<IVectorGraphBinding | undefined> {
	const workspaces = await graph.listWorkspaces();
	if (!isCurrent()) { return; }
	if (!workspaces.length) { throw new Error(localize('workProjectSignIn', 'Sign in to VectorGraph in Work, then choose a workspace.')); }
	const workspace = await quick.pick(workspaces.map(value => ({ label: value.name, value })), { placeHolder: localize('workProjectWorkspace', 'Choose a workspace') });
	if (!workspace || !isCurrent()) { return; }
	const teams = await graph.listTeams(workspace.value.id);
	if (!isCurrent()) { return; }
	if (!teams.length) { throw new Error(localize('workProjectNoTeams', 'No teams are accessible in this workspace. Check your VectorGraph access.')); }
	const team = await quick.pick(teams.map(value => ({ label: value.name, description: value.identifier, value })), { placeHolder: localize('workProjectTeam', 'Choose a team') });
	if (!team || !isCurrent()) { return; }
	return { workspace: workspace.value, team: team.value };
}

/** Select an existing work project; no folder, Git or terminal APIs. */
export async function chooseDocumentWorkProject(
	graph: IVectorGraphService,
	quick: IQuickInputService,
	storage: IStorageService,
	isCurrent: () => boolean,
): Promise<IVectorGraphBinding | undefined> {
	const scope = await chooseDocumentScope(graph, quick, isCurrent);
	if (!scope || !isCurrent()) { return; }
	const projects = await graph.listProjects(scope.workspace.id, scope.team.id);
	if (!isCurrent()) { return; }
	if (!projects.length) { throw new Error(localize('workProjectNone', 'No projects are accessible in this team. Create or join a project in VectorGraph, then try again.')); }
	const project = await quick.pick(projects.map(value => ({ label: value.name, value })), { placeHolder: localize('workProjectChoose', 'Open a work project') });
	if (!project || !isCurrent()) { return; }
	const binding = { workspace: scope.workspace, team: scope.team, project: project.value };
	storage.store(VECTOR_CODE_WORK_PROJECT_KEY, binding, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	return binding;
}
