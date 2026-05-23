/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorInputWithOptions } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ADD_ROOT_FOLDER_COMMAND_ID } from '../../../browser/actions/workspaceCommands.js';
import { GroupsOrder, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { REVEAL_IN_EXPLORER_COMMAND_ID } from '../../files/browser/fileConstants.js';
import { VIEW_ID as EXPLORER_FILE_VIEW_ID, VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';
import { ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { TERMINAL_VIEW_ID } from '../../terminal/common/terminal.js';
import { IVectorCodeMobileRelayService, IVectorCodeProjectSummary, IVectorCodeWorkbenchService, VECTOR_CODE_VIEW_CONTAINER_ID } from '../common/vectorCode.js';

const SET_ACTIVE_PROJECT_ROOT_COMMAND_ID = 'workbench.files.action.setActiveProjectRoot';

interface IVectorCodeEditorEntry {
	readonly editor: EditorInput;
	readonly groupIndex: number;
	readonly index: number;
	readonly pinned: boolean;
	readonly sticky: boolean;
	readonly active: boolean;
}

interface IVectorCodeEditorState {
	readonly entries: readonly IVectorCodeEditorEntry[];
}

interface IVectorCodeTerminalLayoutState {
	readonly panelVisible: boolean;
	readonly terminalVisible: boolean;
}

class VectorCodeWorkbenchService extends Disposable implements IVectorCodeWorkbenchService {
	readonly _serviceBrand: undefined;
	private readonly _onDidChangeActiveProject = this._register(new Emitter<URI | undefined>());
	readonly onDidChangeActiveProject = this._onDidChangeActiveProject.event;

	private activeProjectUri: URI | undefined;
	private readonly projectEditorStates = new Map<string, IVectorCodeEditorState>();
	private readonly projectTerminalInstances = new Map<string, ITerminalInstance[]>();
	private readonly projectActiveTerminalInstances = new Map<string, ITerminalInstance>();
	private readonly terminalProjectKeys = new Map<number, string>();
	private projectSwitching = false;
	private projectSwitchQueue = Promise.resolve();

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IVectorCodeMobileRelayService private readonly mobileRelayService: IVectorCodeMobileRelayService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITerminalGroupService private readonly terminalGroupService: ITerminalGroupService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IViewsService private readonly viewsService: IViewsService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this._register(this.terminalService.onDidCreateInstance(instance => this.adoptTerminalInstance(instance)));
		this._register(this.terminalService.onDidDisposeInstance(instance => this.forgetTerminalInstance(instance)));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.pruneProjectState()));
	}

	getProjectStatusLabel(): string {
		const projectCount = this.workspaceContextService.getWorkspace().folders.length;
		if (projectCount === 0) {
			return localize('vectorCodeProjectsEmpty', 'No projects');
		}
		if (projectCount === 1) {
			return localize('vectorCodeProjectsSingle', '1 project');
		}
		return localize('vectorCodeProjectsMany', '{0} projects', projectCount);
	}

	getProjectSummaries(): readonly IVectorCodeProjectSummary[] {
		return this.workspaceContextService.getWorkspace().folders.map(folder => ({
			name: folder.name,
			uri: folder.uri,
			uriLabel: this.labelService.getUriLabel(folder.uri, { appendWorkspaceSuffix: true })
		}));
	}

	getActiveProjectUri(): URI | undefined {
		return this.activeProjectUri;
	}

	isProjectSwitching(): boolean {
		return this.projectSwitching;
	}

	async switchProject(projectUri: URI | undefined): Promise<void> {
		const run = async () => this.doSwitchProject(projectUri);
		this.projectSwitchQueue = this.projectSwitchQueue.then(run, run);
		await this.projectSwitchQueue;
	}

	async addProjectToWorkspace(): Promise<void> {
		await this.commandService.executeCommand(ADD_ROOT_FOLDER_COMMAND_ID);
		await this.viewsService.openViewContainer(EXPLORER_VIEWLET_ID, true);
	}

	async connectMobileApp(): Promise<void> {
		await this.viewsService.openViewContainer(VECTOR_CODE_VIEW_CONTAINER_ID, true);
		const status = await this.mobileRelayService.startPairing();
		this.notificationService.info(status.detail);
	}

	private async doSwitchProject(projectUri: URI | undefined): Promise<void> {
		const previousProjectUri = this.activeProjectUri;
		const previousProjectKey = previousProjectUri?.toString();
		const nextProjectKey = projectUri?.toString();
		const terminalLayoutState = this.captureTerminalLayoutState();

		if (previousProjectKey === nextProjectKey) {
			await this.showProjectFiles(projectUri);
			return;
		}

		this.projectSwitching = true;
		try {
			let previousTerminalInstances: readonly ITerminalInstance[] = [];

			if (previousProjectKey) {
				this.saveProjectEditorState(previousProjectKey);
				previousTerminalInstances = this.captureProjectTerminalState(previousProjectKey);
				this.activeProjectUri = projectUri;
				await this.restoreProjectEditorState(nextProjectKey);
				await this.restoreProjectTerminalState(nextProjectKey);
				this.hideTerminalInstances(previousTerminalInstances);
			} else {
				this.activeProjectUri = projectUri;
				if (nextProjectKey) {
					this.captureProjectTerminalState(nextProjectKey);
				}
			}

			await this.showProjectFiles(projectUri);
			await this.restoreTerminalLayoutState(terminalLayoutState);
			this._onDidChangeActiveProject.fire(projectUri);
		} finally {
			this.projectSwitching = false;
		}
	}

	private saveProjectEditorState(projectKey: string): void {
		const entries: IVectorCodeEditorEntry[] = [];
		const groups = this.editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
		for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
			const group = groups[groupIndex];
			const groupIsActive = group === this.editorGroupsService.activeGroup;
			for (const editor of group.editors) {
				entries.push({
					editor,
					groupIndex,
					index: group.getIndexOfEditor(editor),
					pinned: group.isPinned(editor),
					sticky: group.isSticky(editor),
					active: groupIsActive && group.activeEditor === editor
				});
			}
		}

		this.projectEditorStates.set(projectKey, { entries });
	}

	private async restoreProjectEditorState(projectKey: string | undefined): Promise<void> {
		await this.closeVisibleEditorsForProjectSwitch();

		if (!projectKey) {
			return;
		}

		const state = this.projectEditorStates.get(projectKey);
		if (!state?.entries.length) {
			return;
		}

		const activeEntry = state.entries.find(entry => entry.active) ?? state.entries.at(-1);
		const groups = this.editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
		const entriesByGroup = new Map<number, IVectorCodeEditorEntry[]>();
		for (const entry of state.entries) {
			const groupEntries = entriesByGroup.get(entry.groupIndex) ?? [];
			groupEntries.push(entry);
			entriesByGroup.set(entry.groupIndex, groupEntries);
		}

		for (const [groupIndex, entries] of entriesByGroup) {
			const targetGroup = groups[groupIndex] ?? groups.at(-1) ?? this.editorGroupsService.activeGroup;
			const inactiveEditors: EditorInputWithOptions[] = entries.map(entry => ({
				editor: entry.editor,
				options: {
					index: entry.index,
					pinned: entry.pinned,
					sticky: entry.sticky,
					preserveFocus: true,
					inactive: true
				}
			}));
			await targetGroup.openEditors(inactiveEditors);
		}

		if (activeEntry) {
			const activeGroups = this.editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
			const targetGroup = activeGroups[activeEntry.groupIndex] ?? activeGroups.at(-1) ?? this.editorGroupsService.activeGroup;
			await targetGroup.openEditor(activeEntry.editor, {
				index: activeEntry.index,
				pinned: activeEntry.pinned,
				sticky: activeEntry.sticky,
				preserveFocus: true
			});
		}
	}

	private async closeVisibleEditorsForProjectSwitch(): Promise<void> {
		const preserveEditorGroups = this.editorGroupsService.enforcePartOptions({ closeEmptyGroups: false });
		try {
			for (const group of this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
				await group.closeAllEditors({ excludeConfirming: true });
			}
		} finally {
			preserveEditorGroups.dispose();
		}
	}

	private captureProjectTerminalState(projectKey: string): readonly ITerminalInstance[] {
		const visibleInstances = this.terminalGroupService.instances.filter(instance => !instance.isDisposed);
		const activeInstance = this.terminalGroupService.activeGroup?.activeInstance;
		const existingInstances = (this.projectTerminalInstances.get(projectKey) ?? []).filter(instance => !instance.isDisposed && this.terminalProjectKeys.get(instance.instanceId) === projectKey);

		for (const instance of visibleInstances) {
			this.adoptTerminalInstance(instance, projectKey);
		}

		this.projectTerminalInstances.set(projectKey, this.uniqueTerminalInstances([...existingInstances, ...visibleInstances]));
		if (activeInstance && visibleInstances.includes(activeInstance)) {
			this.projectActiveTerminalInstances.set(projectKey, activeInstance);
		} else {
			this.projectActiveTerminalInstances.delete(projectKey);
		}

		return visibleInstances;
	}

	private captureTerminalLayoutState(): IVectorCodeTerminalLayoutState {
		return {
			panelVisible: this.layoutService.isVisible(Parts.PANEL_PART),
			terminalVisible: this.viewsService.isViewVisible(TERMINAL_VIEW_ID)
		};
	}

	private async restoreTerminalLayoutState(state: IVectorCodeTerminalLayoutState): Promise<void> {
		if (state.panelVisible && state.terminalVisible) {
			if (!this.layoutService.isVisible(Parts.PANEL_PART)) {
				this.layoutService.setPartHidden(false, Parts.PANEL_PART);
			}
			await this.terminalGroupService.showPanel(false);
			return;
		}

		if (!state.panelVisible && this.layoutService.isVisible(Parts.PANEL_PART) && this.viewsService.isViewVisible(TERMINAL_VIEW_ID)) {
			this.layoutService.setPartHidden(true, Parts.PANEL_PART);
		}
	}

	private async restoreProjectTerminalState(projectKey: string | undefined): Promise<void> {
		if (!projectKey) {
			return;
		}

		const instances = (this.projectTerminalInstances.get(projectKey) ?? []).filter(instance => !instance.isDisposed && this.terminalProjectKeys.get(instance.instanceId) === projectKey);
		this.projectTerminalInstances.set(projectKey, instances);

		for (const instance of instances) {
			this.terminalProjectKeys.set(instance.instanceId, projectKey);
			await this.terminalService.showBackgroundTerminal(instance, true);
		}

		const activeInstance = this.projectActiveTerminalInstances.get(projectKey);
		if (activeInstance && !activeInstance.isDisposed && instances.includes(activeInstance)) {
			this.terminalService.setActiveInstance(activeInstance);
		} else if (instances.length) {
			this.terminalService.setActiveInstance(instances[0]);
		}
	}

	private hideTerminalInstances(instances: readonly ITerminalInstance[]): void {
		for (const instance of instances) {
			if (!instance.isDisposed && this.terminalGroupService.getGroupForInstance(instance)) {
				this.terminalService.moveToBackground(instance);
			}
		}
	}

	private adoptTerminalInstance(instance: ITerminalInstance, projectKey = this.activeProjectUri?.toString()): void {
		if (!projectKey || instance.isDisposed) {
			return;
		}
		if (this.terminalProjectKeys.has(instance.instanceId)) {
			return;
		}

		this.terminalProjectKeys.set(instance.instanceId, projectKey);
		const instances = this.projectTerminalInstances.get(projectKey) ?? [];
		this.projectTerminalInstances.set(projectKey, this.uniqueTerminalInstances([...instances, instance]));
	}

	private uniqueTerminalInstances(instances: readonly ITerminalInstance[]): ITerminalInstance[] {
		const seen = new Set<number>();
		const uniqueInstances: ITerminalInstance[] = [];
		for (const instance of instances) {
			if (seen.has(instance.instanceId) || instance.isDisposed) {
				continue;
			}
			seen.add(instance.instanceId);
			uniqueInstances.push(instance);
		}
		return uniqueInstances;
	}

	private async showProjectFiles(projectUri: URI | undefined): Promise<void> {
		await this.commandService.executeCommand(SET_ACTIVE_PROJECT_ROOT_COMMAND_ID, projectUri);
		if (!projectUri) {
			return;
		}

		await this.viewsService.openView(EXPLORER_FILE_VIEW_ID, true);
		await this.commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, projectUri);
	}

	private forgetTerminalInstance(instance: ITerminalInstance): void {
		this.terminalProjectKeys.delete(instance.instanceId);
		for (const [projectKey, instances] of this.projectTerminalInstances) {
			this.projectTerminalInstances.set(projectKey, instances.filter(candidate => candidate !== instance));
		}

		for (const [projectKey, activeInstance] of this.projectActiveTerminalInstances) {
			if (activeInstance === instance) {
				this.projectActiveTerminalInstances.delete(projectKey);
			}
		}
	}

	private pruneProjectState(): void {
		const projectKeys = new Set(this.getProjectSummaries().map(project => project.uri.toString()));
		for (const projectKey of this.projectEditorStates.keys()) {
			if (!projectKeys.has(projectKey)) {
				this.projectEditorStates.delete(projectKey);
			}
		}
		for (const projectKey of this.projectTerminalInstances.keys()) {
			if (!projectKeys.has(projectKey)) {
				for (const instance of this.projectTerminalInstances.get(projectKey) ?? []) {
					this.terminalProjectKeys.delete(instance.instanceId);
				}
				this.projectTerminalInstances.delete(projectKey);
			}
		}
		for (const projectKey of this.projectActiveTerminalInstances.keys()) {
			if (!projectKeys.has(projectKey)) {
				this.projectActiveTerminalInstances.delete(projectKey);
			}
		}

		const activeProjectKey = this.activeProjectUri?.toString();
		if (activeProjectKey && !projectKeys.has(activeProjectKey)) {
			const nextProject = this.getProjectSummaries()[0]?.uri;
			void this.switchProject(nextProject);
		}
	}
}

registerSingleton(IVectorCodeWorkbenchService, VectorCodeWorkbenchService, InstantiationType.Delayed);
