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

const WORK_PROJECT_KEY = 'vectorGraph.document.workProject';

/** A selected backend project is presentation state, never a local execution grant. */
export function readDocumentBinding(storage: IStorageService, localProject: string | undefined): IVectorGraphBinding | undefined {
	if (localProject) { return readVectorGraphBinding(storage, localProject); }
	return storage.getObject<IVectorGraphBinding>(WORK_PROJECT_KEY, StorageScope.WORKSPACE);
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
	) {
		super();
		this.localProject = projects.getActiveProjectUri()?.toString();
		this.binding = readDocumentBinding(storage, this.localProject);
		this._register(projects.onDidChangeActiveProject(() => { this.valid = false; }));
		this._register(graph.onDidChangeSession(() => { this.valid = false; }));
		this._register(storage.onDidChangeValue(this.localProject ? StorageScope.PROFILE : StorageScope.WORKSPACE, this.localProject ? VECTOR_GRAPH_BINDING_KEY + this.localProject : WORK_PROJECT_KEY, this._store)(() => { this.valid = false; }));
	}
	isCurrent(): boolean {
		const binding = readDocumentBinding(this.storage, this.localProject);
		return this.valid && this.localProject === this.projects.getActiveProjectUri()?.toString()
			&& binding?.workspace.id === this.binding?.workspace.id
			&& binding?.team.id === this.binding?.team.id
			&& binding?.project?.id === this.binding?.project?.id;
	}
}

/** Select an existing work project in an empty window; no folder, Git or terminal APIs. */
export async function chooseDocumentWorkProject(
	graph: IVectorGraphService,
	quick: IQuickInputService,
	storage: IStorageService,
	isCurrent: () => boolean,
): Promise<IVectorGraphBinding | undefined> {
	const workspaces = await graph.listWorkspaces();
	if (!isCurrent()) { return; }
	if (!workspaces.length) { throw new Error(localize('workProjectSignIn', 'Sign in to VectorGraph in Work, then open a work project.')); }
	const workspace = await quick.pick(workspaces.map(value => ({ label: value.name, value })), { placeHolder: localize('workProjectWorkspace', 'Choose a workspace') });
	if (!workspace || !isCurrent()) { return; }
	const teams = await graph.listTeams(workspace.value.id);
	if (!isCurrent()) { return; }
	if (!teams.length) { throw new Error(localize('workProjectNoTeams', 'No teams are accessible in this workspace. Check your VectorGraph access.')); }
	const team = await quick.pick(teams.map(value => ({ label: value.name, description: value.identifier, value })), { placeHolder: localize('workProjectTeam', 'Choose a team') });
	if (!team || !isCurrent()) { return; }
	const projects = await graph.listProjects(workspace.value.id, team.value.id);
	if (!isCurrent()) { return; }
	if (!projects.length) { throw new Error(localize('workProjectNone', 'No projects are accessible in this team. Create or join a project in VectorGraph, then try again.')); }
	const project = await quick.pick(projects.map(value => ({ label: value.name, value })), { placeHolder: localize('workProjectChoose', 'Open a work project') });
	if (!project || !isCurrent()) { return; }
	const binding = { workspace: workspace.value, team: team.value, project: project.value };
	storage.store(WORK_PROJECT_KEY, binding, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	return binding;
}
