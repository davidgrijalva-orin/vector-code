/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isEqualOrParent } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { FileType, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
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
import { IVectorCodeMobileRemoteEnvelope, IVectorCodeMobileRemoteEditorTab, IVectorCodeMobileRemoteFileCopyResponse, IVectorCodeMobileRemoteFileMoveResponse, IVectorCodeMobileRemoteFileNode, IVectorCodeMobileRemoteFileReadResponse, IVectorCodeMobileRemoteFileTreeResponse, IVectorCodeMobileRemoteFileWriteResponse, IVectorCodeMobileRemoteTerminalControlResponse, IVectorCodeMobileRemoteTerminalInputResponse, IVectorCodeMobileRemoteTerminalOutputResponse, IVectorCodeMobileRemoteTerminalTab, IVectorCodeMobileRemoteWorkspaceSnapshot, VectorCodeMobileRemoteAction, VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION } from '../common/vectorCodeMobileProtocol.js';

const SET_ACTIVE_PROJECT_ROOT_COMMAND_ID = 'workbench.files.action.setActiveProjectRoot';
const VECTOR_CODE_MOBILE_FILE_TREE_MAX_DEPTH = 8;
const VECTOR_CODE_MOBILE_FILE_TREE_MAX_CHILDREN_PER_FOLDER = 500;
const VECTOR_CODE_MOBILE_TERMINAL_OUTPUT_MAX_LINES = 200;
const VECTOR_CODE_MOBILE_TERMINAL_RAW_OUTPUT_MAX_CHARS = 120_000;
const VECTOR_CODE_MOBILE_FILE_TREE_EXCLUDED_NAMES = new Set([
	'.git',
	'.hg',
	'.svn',
	'.turbo',
	'.next',
	'.venv',
	'node_modules',
	'out',
	'dist',
	'coverage',
]);

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
	private readonly terminalOutputLines = new Map<number, string[]>();
	private readonly terminalOutputDisposables = new Map<number, readonly { dispose(): void }[]>();
	private projectSwitching = false;
	private projectSwitchQueue = Promise.resolve();

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IFileService private readonly fileService: IFileService,
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
		this._register(this.terminalService.onDidChangeActiveInstance(instance => {
			const projectKey = instance ? this.terminalProjectKeys.get(instance.instanceId) : undefined;
			if (projectKey && instance && !instance.isDisposed) {
				this.projectActiveTerminalInstances.set(projectKey, instance);
			}
		}));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.pruneProjectState()));
		this._register(this.mobileRelayService.registerRequestHandler({
			handleVectorCodeMobileRemoteRequest: request => this.handleVectorCodeMobileRemoteRequest(request)
		}));
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

	getMobileWorkspaceSnapshot(): IVectorCodeMobileRemoteWorkspaceSnapshot {
		const projects = this.getProjectSummaries();
		const filesByProject: Record<string, IVectorCodeMobileRemoteFileNode[]> = {};
		const fileTreeTruncatedByProject: Record<string, boolean> = {};
		for (const project of projects) {
			filesByProject[project.uri.toString()] = [];
			fileTreeTruncatedByProject[project.uri.toString()] = false;
		}
		return this.createMobileWorkspaceSnapshot(projects, filesByProject, fileTreeTruncatedByProject);
	}

	private async getMobileWorkspaceSnapshotWithFiles(requestedProjectId?: string): Promise<IVectorCodeMobileRemoteWorkspaceSnapshot> {
		const projects = this.getProjectSummaries();
		const filesByProject: Record<string, IVectorCodeMobileRemoteFileNode[]> = {};
		const fileTreeTruncatedByProject: Record<string, boolean> = {};
		const activeProjectKey = this.activeProjectUri?.toString();
		const projectKeyToRead = requestedProjectId && projects.some(project => project.uri.toString() === requestedProjectId)
			? requestedProjectId
			: activeProjectKey;
		const projectsToRead = projectKeyToRead
			? projects.filter(project => project.uri.toString() === projectKeyToRead)
			: projects.slice(0, 1);
		await Promise.all(projectsToRead.map(async project => {
			const tree = await this.getMobileFileTree(project.uri);
			const projectKey = project.uri.toString();
			filesByProject[projectKey] = [...tree.nodes];
			fileTreeTruncatedByProject[projectKey] = tree.truncated;
		}));
		return this.createMobileWorkspaceSnapshotWithTerminalRawOutput(
			projects,
			filesByProject,
			fileTreeTruncatedByProject,
			new Set(projectsToRead.map(project => project.uri.toString()))
		);
	}

	private createMobileWorkspaceSnapshot(projects: readonly IVectorCodeProjectSummary[], filesByProject: Record<string, IVectorCodeMobileRemoteFileNode[]>, fileTreeTruncatedByProject: Record<string, boolean>): IVectorCodeMobileRemoteWorkspaceSnapshot {
		const activeProjectKey = this.activeProjectUri?.toString();
		if (activeProjectKey) {
			this.saveProjectEditorState(activeProjectKey);
			this.captureProjectTerminalState(activeProjectKey);
		}

		const editorsByProject: Record<string, IVectorCodeMobileRemoteEditorTab[]> = {};
		const terminalsByProject: Record<string, IVectorCodeMobileRemoteTerminalTab[]> = {};
		for (const project of projects) {
			const projectKey = project.uri.toString();
			editorsByProject[projectKey] = this.getMobileEditorTabs(projectKey);
			terminalsByProject[projectKey] = this.getMobileTerminalTabs(projectKey);
		}

		return {
			activeProjectId: activeProjectKey,
			projects: projects.map(project => ({
				id: project.uri.toString(),
				name: project.name,
				path: project.uriLabel,
				isOnline: true
			})),
			filesByProject,
			fileTreeTruncatedByProject,
			editorsByProject,
			terminalsByProject
		};
	}

	private async createMobileWorkspaceSnapshotWithTerminalRawOutput(projects: readonly IVectorCodeProjectSummary[], filesByProject: Record<string, IVectorCodeMobileRemoteFileNode[]>, fileTreeTruncatedByProject: Record<string, boolean>, rawOutputProjectKeys: ReadonlySet<string>): Promise<IVectorCodeMobileRemoteWorkspaceSnapshot> {
		const snapshot = this.createMobileWorkspaceSnapshot(projects, filesByProject, fileTreeTruncatedByProject);
		const terminalsByProject: Record<string, IVectorCodeMobileRemoteTerminalTab[]> = {};
		await Promise.all(projects.map(async project => {
			const projectKey = project.uri.toString();
			terminalsByProject[projectKey] = rawOutputProjectKeys.has(projectKey)
				? await this.getMobileTerminalTabsWithRawOutput(projectKey)
				: this.getMobileTerminalTabs(projectKey);
		}));
		return {
			...snapshot,
			terminalsByProject
		};
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

	async toggleActiveProjectTerminalPanel(): Promise<void> {
		if (this.layoutService.isVisible(Parts.PANEL_PART) && this.viewsService.isViewVisible(TERMINAL_VIEW_ID)) {
			this.layoutService.setPartHidden(true, Parts.PANEL_PART);
			return;
		}

		const projectKey = this.activeProjectUri?.toString();
		let instance = projectKey ? this.projectActiveTerminalInstances.get(projectKey) : undefined;
		if (instance?.isDisposed || (instance && this.terminalProjectKeys.get(instance.instanceId) !== projectKey)) {
			instance = undefined;
		}
		if (!instance && projectKey) {
			instance = (this.projectTerminalInstances.get(projectKey) ?? []).find(candidate => !candidate.isDisposed && this.terminalProjectKeys.get(candidate.instanceId) === projectKey);
		}
		if (!instance && this.terminalService.isProcessSupportRegistered) {
			instance = await this.terminalService.createTerminal({
				location: TerminalLocation.Panel,
				cwd: this.activeProjectUri
			});
			if (projectKey) {
				this.adoptTerminalInstance(instance, projectKey, true);
			}
		}

		if (instance && projectKey) {
			this.projectActiveTerminalInstances.set(projectKey, instance);
			await this.terminalService.showBackgroundTerminal(instance);
			this.terminalService.setActiveInstance(instance);
		}
		if (!this.layoutService.isVisible(Parts.PANEL_PART)) {
			this.layoutService.setPartHidden(false, Parts.PANEL_PART);
		}
		await this.terminalGroupService.showPanel(true);
		await instance?.focusWhenReady();
	}

	private async handleVectorCodeMobileRemoteRequest(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		switch (request.action) {
			case VectorCodeMobileRemoteAction.StateRead:
				return this.createMobileRemoteResponse(request, await this.getMobileWorkspaceSnapshotWithFiles(request.projectId));
			case VectorCodeMobileRemoteAction.FileTreeRead:
				return this.handleMobileFileTreeRead(request);
			case VectorCodeMobileRemoteAction.FileRead:
				return this.handleMobileFileRead(request);
			case VectorCodeMobileRemoteAction.FileWrite:
				return this.handleMobileFileWrite(request);
			case VectorCodeMobileRemoteAction.FileMove:
				return this.handleMobileFileMove(request);
			case VectorCodeMobileRemoteAction.FileCopy:
				return this.handleMobileFileCopy(request);
			case VectorCodeMobileRemoteAction.TerminalList:
				return this.handleMobileTerminalList(request);
			case VectorCodeMobileRemoteAction.TerminalCreate:
				return this.handleMobileTerminalCreate(request);
			case VectorCodeMobileRemoteAction.TerminalInput:
				return this.handleMobileTerminalInput(request);
			case VectorCodeMobileRemoteAction.TerminalControl:
				return this.handleMobileTerminalControl(request);
			case VectorCodeMobileRemoteAction.TerminalOutput:
				return this.handleMobileTerminalOutput(request);
			default:
				return this.createMobileRemoteErrorResponse(request, 'unsupported_action', `The desktop bridge does not support ${request.action} yet.`);
		}
	}

	private async handleMobileFileTreeRead(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const project = this.getMobileRequestProject(request);
		if (!project) {
			return this.createMobileRemoteErrorResponse(request, 'project_not_found', 'The requested project is not open on the desktop.');
		}

		const payload = getMobilePayloadObject(request.payload);
		const path = getOptionalMobilePayloadString(payload, 'path') ?? '';
		const target = this.resolveMobileProjectResource(project, path, true);
		if (!target) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_path', 'The requested file tree path is outside the project.');
		}

		return this.createMobileRemoteResponse(request, await this.getMobileFileTree(project.uri, target.relativePath));
	}

	private async handleMobileFileRead(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const project = this.getMobileRequestProject(request);
		if (!project) {
			return this.createMobileRemoteErrorResponse(request, 'project_not_found', 'The requested project is not open on the desktop.');
		}

		const payload = getMobilePayloadObject(request.payload);
		const path = getRequiredMobilePayloadString(payload, 'path');
		if (!path) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_payload', 'File read requires a path.');
		}

		const target = this.resolveMobileProjectResource(project, path, false);
		if (!target) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_path', 'The requested file is outside the project.');
		}

		const stat = await this.fileService.stat(target.resource);
		if (!stat.isFile) {
			return this.createMobileRemoteErrorResponse(request, 'not_a_file', 'The requested path is not a file.');
		}

		const content = await this.fileService.readFile(target.resource);
		const response: IVectorCodeMobileRemoteFileReadResponse = {
			path: target.relativePath,
			content: content.value.toString(),
			language: inferLanguage(target.relativePath),
			version: content.etag
		};
		return this.createMobileRemoteResponse(request, response);
	}

	private async handleMobileFileWrite(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const project = this.getMobileRequestProject(request);
		if (!project) {
			return this.createMobileRemoteErrorResponse(request, 'project_not_found', 'The requested project is not open on the desktop.');
		}

		const payload = getMobilePayloadObject(request.payload);
		const path = getRequiredMobilePayloadString(payload, 'path');
		const content = getRequiredMobilePayloadString(payload, 'content');
		if (!path || content === undefined) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_payload', 'File write requires a path and content.');
		}

		const target = this.resolveMobileProjectResource(project, path, false);
		if (!target) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_path', 'The requested file is outside the project.');
		}

		const expectedVersion = getOptionalMobilePayloadString(payload, 'expectedVersion');
		const stat = await this.fileService.writeFile(target.resource, VSBuffer.fromString(content), expectedVersion ? { etag: expectedVersion } : undefined);
		const response: IVectorCodeMobileRemoteFileWriteResponse = {
			path: target.relativePath,
			version: stat.etag
		};
		return this.createMobileRemoteResponse(request, response);
	}

	private async handleMobileFileMove(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const sourceProject = this.getMobileRequestProject(request);
		const payload = getMobilePayloadObject(request.payload);
		const path = getRequiredMobilePayloadString(payload, 'path');
		const targetPath = getRequiredMobilePayloadString(payload, 'targetPath');
		if (!sourceProject || !path || !targetPath) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_payload', 'File move requires a source project, path, and targetPath.');
		}

		const targetProjectId = getOptionalMobilePayloadString(payload, 'targetProjectId') ?? sourceProject.uri.toString();
		const targetProject = this.getProjectById(targetProjectId);
		if (!targetProject) {
			return this.createMobileRemoteErrorResponse(request, 'target_project_not_found', 'The destination project is not open on the desktop.');
		}

		const source = this.resolveMobileProjectResource(sourceProject, path, false);
		const target = this.resolveMobileProjectResource(targetProject, targetPath, false);
		if (!source || !target) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_path', 'The requested move path is outside an open project.');
		}

		const overwrite = getMobilePayloadBoolean(payload, 'overwrite') ?? false;
		await this.fileService.move(source.resource, target.resource, overwrite);
		const response: IVectorCodeMobileRemoteFileMoveResponse = {
			path: source.relativePath,
			targetPath: target.relativePath,
			targetProjectId: targetProject.uri.toString()
		};
		return this.createMobileRemoteResponse(request, response);
	}

	private async handleMobileFileCopy(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const sourceProject = this.getMobileRequestProject(request);
		const payload = getMobilePayloadObject(request.payload);
		const path = getRequiredMobilePayloadString(payload, 'path');
		const targetProjectId = getRequiredMobilePayloadString(payload, 'targetProjectId');
		const targetPath = getRequiredMobilePayloadString(payload, 'targetPath');
		if (!sourceProject || !path || !targetProjectId || !targetPath) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_payload', 'File copy requires a source project, path, targetProjectId, and targetPath.');
		}

		const targetProject = this.getProjectById(targetProjectId);
		if (!targetProject) {
			return this.createMobileRemoteErrorResponse(request, 'target_project_not_found', 'The destination project is not open on the desktop.');
		}

		const source = this.resolveMobileProjectResource(sourceProject, path, false);
		const target = this.resolveMobileProjectResource(targetProject, targetPath, false);
		if (!source || !target) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_path', 'The requested copy path is outside an open project.');
		}

		const overwrite = getMobilePayloadBoolean(payload, 'overwrite') ?? false;
		await this.fileService.copy(source.resource, target.resource, overwrite);
		const response: IVectorCodeMobileRemoteFileCopyResponse = {
			path: source.relativePath,
			targetPath: target.relativePath,
			targetProjectId: targetProject.uri.toString()
		};
		return this.createMobileRemoteResponse(request, response);
	}

	private async handleMobileTerminalList(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const project = this.getMobileRequestProject(request);
		if (!project) {
			return this.createMobileRemoteErrorResponse(request, 'project_not_found', 'The requested project is not open on the desktop.');
		}

		return this.createMobileRemoteResponse(request, await this.getMobileTerminalTabsWithRawOutput(project.uri.toString()));
	}

	private async handleMobileTerminalCreate(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const project = this.getMobileRequestProject(request);
		if (!project) {
			return this.createMobileRemoteErrorResponse(request, 'project_not_found', 'The requested project is not open on the desktop.');
		}

		const payload = getMobilePayloadObject(request.payload);
		const requestedTitle = getOptionalMobilePayloadString(payload, 'title');
		const requestedCwd = getOptionalMobilePayloadString(payload, 'cwd');
		const cwd = requestedCwd ? this.resolveMobileProjectResource(project, requestedCwd, true)?.resource : project.uri;
		if (!cwd) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_cwd', 'The requested terminal working directory is outside the project.');
		}

		const instance = await this.terminalService.createTerminal({
			location: TerminalLocation.Panel,
			cwd,
			config: requestedTitle ? { name: requestedTitle } : undefined
		});
		if (requestedTitle) {
			await instance.rename(requestedTitle);
		}

		const projectKey = project.uri.toString();
		this.adoptTerminalInstance(instance, projectKey, true);
		this.projectActiveTerminalInstances.set(projectKey, instance);
		if (projectKey === this.activeProjectUri?.toString()) {
			this.terminalService.setActiveInstance(instance);
		} else {
			this.terminalService.moveToBackground(instance);
		}

		return this.createMobileRemoteResponse(request, await this.getMobileTerminalTabWithRawOutput(projectKey, instance, true));
	}

	private async handleMobileTerminalInput(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const project = this.getMobileRequestProject(request);
		const payload = getMobilePayloadObject(request.payload);
		const terminalId = getRequiredMobilePayloadString(payload, 'terminalId');
		const input = getRequiredMobilePayloadString(payload, 'input');
		const submit = getMobilePayloadBoolean(payload, 'submit') ?? false;
		const mode = getOptionalMobilePayloadString(payload, 'mode') ?? (submit ? 'command' : 'paste');
		if (!project || !terminalId || input === undefined) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_payload', 'Terminal input requires a project, terminalId, and input.');
		}
		if (mode !== 'raw' && mode !== 'paste' && mode !== 'command') {
			return this.createMobileRemoteErrorResponse(request, 'invalid_payload', 'Terminal input mode must be raw, paste, or command.');
		}

		const projectKey = project.uri.toString();
		const instance = this.getProjectTerminalInstance(projectKey, terminalId);
		if (!instance) {
			return this.createMobileRemoteErrorResponse(request, 'terminal_not_found', 'The requested terminal is not open for this project.');
		}

		this.projectActiveTerminalInstances.set(projectKey, instance);
		if (projectKey === this.activeProjectUri?.toString()) {
			this.terminalService.setActiveInstance(instance);
		}
		await instance.sendText(input, mode === 'command' ? submit : false, mode === 'paste');
		const response: IVectorCodeMobileRemoteTerminalInputResponse = {
			terminalId,
			accepted: true
		};
		return this.createMobileRemoteResponse(request, response);
	}

	private async handleMobileTerminalControl(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const project = this.getMobileRequestProject(request);
		const payload = getMobilePayloadObject(request.payload);
		const terminalId = getRequiredMobilePayloadString(payload, 'terminalId');
		const command = getRequiredMobilePayloadString(payload, 'command');
		if (!project || !terminalId || !command) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_payload', 'Terminal control requires a project, terminalId, and command.');
		}

		const projectKey = project.uri.toString();
		const instance = this.getProjectTerminalInstance(projectKey, terminalId);
		if (!instance) {
			return this.createMobileRemoteErrorResponse(request, 'terminal_not_found', 'The requested terminal is not open for this project.');
		}

		let accepted = true;
		switch (command) {
			case 'clear':
				instance.clearBuffer();
				this.terminalOutputLines.set(instance.instanceId, []);
				break;
			case 'interrupt':
				await instance.sendSignal('SIGINT');
				break;
			case 'rename': {
				const title = getOptionalMobilePayloadString(payload, 'title');
				if (title) {
					await instance.rename(title);
				} else {
					accepted = false;
				}
				break;
			}
			case 'close':
				instance.dispose();
				break;
			case 'resize': {
				const cols = getPositiveIntegerMobilePayloadValue(payload, 'cols');
				const rows = getPositiveIntegerMobilePayloadValue(payload, 'rows');
				if (cols && rows) {
					instance.setOverrideDimensions({ cols, rows });
				} else {
					accepted = false;
				}
				break;
			}
			default:
				accepted = false;
				break;
		}

		const response: IVectorCodeMobileRemoteTerminalControlResponse = {
			terminalId,
			accepted
		};
		return this.createMobileRemoteResponse(request, response);
	}

	private async handleMobileTerminalOutput(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const project = this.getMobileRequestProject(request);
		const payload = getMobilePayloadObject(request.payload);
		const terminalId = getRequiredMobilePayloadString(payload, 'terminalId');
		if (!project || !terminalId) {
			return this.createMobileRemoteErrorResponse(request, 'invalid_payload', 'Terminal output requires a project and terminalId.');
		}

		const instance = this.getProjectTerminalInstance(project.uri.toString(), terminalId);
		if (!instance) {
			return this.createMobileRemoteErrorResponse(request, 'terminal_not_found', 'The requested terminal is not open for this project.');
		}

		const response: IVectorCodeMobileRemoteTerminalOutputResponse = {
			terminalId,
			output: this.terminalOutputLines.get(instance.instanceId) ?? [],
			rawOutput: await this.getTerminalRawOutput(instance)
		};
		return this.createMobileRemoteResponse(request, response);
	}

	private createMobileRemoteResponse<TPayload>(request: IVectorCodeMobileRemoteEnvelope, payload: TPayload): IVectorCodeMobileRemoteEnvelope<TPayload> {
		return {
			kind: 'response',
			protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
			requestId: request.requestId,
			action: request.action,
			projectId: request.projectId,
			payload
		};
	}

	private createMobileRemoteErrorResponse(request: IVectorCodeMobileRemoteEnvelope, code: string, message: string): IVectorCodeMobileRemoteEnvelope {
		return {
			kind: 'response',
			protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
			requestId: request.requestId,
			action: request.action,
			projectId: request.projectId,
			error: { code, message }
		};
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

	private adoptTerminalInstance(instance: ITerminalInstance, projectKey = this.activeProjectUri?.toString(), forceProject = false): void {
		if (!projectKey || instance.isDisposed) {
			return;
		}
		this.ensureTerminalOutputTracking(instance);
		const existingProjectKey = this.terminalProjectKeys.get(instance.instanceId);
		if (existingProjectKey && (!forceProject || existingProjectKey === projectKey)) {
			return;
		}
		if (existingProjectKey && forceProject) {
			const previousInstances = this.projectTerminalInstances.get(existingProjectKey) ?? [];
			this.projectTerminalInstances.set(existingProjectKey, previousInstances.filter(candidate => candidate !== instance));
			if (this.projectActiveTerminalInstances.get(existingProjectKey) === instance) {
				this.projectActiveTerminalInstances.delete(existingProjectKey);
			}
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

	private ensureTerminalOutputTracking(instance: ITerminalInstance): void {
		if (this.terminalOutputDisposables.has(instance.instanceId)) {
			return;
		}

		this.terminalOutputLines.set(instance.instanceId, this.terminalOutputLines.get(instance.instanceId) ?? []);
		this.terminalOutputDisposables.set(instance.instanceId, [
			instance.onLineData(line => this.captureTerminalOutputLine(instance, line))
		]);
	}

	private captureTerminalOutputLine(instance: ITerminalInstance, line: string): void {
		const lines = this.terminalOutputLines.get(instance.instanceId) ?? [];
		lines.push(line);
		if (lines.length > VECTOR_CODE_MOBILE_TERMINAL_OUTPUT_MAX_LINES) {
			lines.splice(0, lines.length - VECTOR_CODE_MOBILE_TERMINAL_OUTPUT_MAX_LINES);
		}
		this.terminalOutputLines.set(instance.instanceId, lines);
	}

	private getMobileEditorTabs(projectKey: string): IVectorCodeMobileRemoteEditorTab[] {
		const state = this.projectEditorStates.get(projectKey);
		if (!state?.entries.length) {
			return [];
		}

		return state.entries.map((entry, index) => {
			const resource = entry.editor.resource;
			const path = resource ? this.labelService.getUriLabel(resource, { relative: true }) : entry.editor.getName();
			return {
				id: `${projectKey}:editor:${index}:${resource?.toString() ?? entry.editor.getName()}`,
				projectId: projectKey,
				path,
				title: entry.editor.getName(),
				language: inferLanguage(path),
				isDirty: entry.editor.isDirty()
			};
		});
	}

	private getMobileTerminalTabs(projectKey: string): IVectorCodeMobileRemoteTerminalTab[] {
		const activeInstance = this.projectActiveTerminalInstances.get(projectKey);
		const instances = (this.projectTerminalInstances.get(projectKey) ?? []).filter(instance => !instance.isDisposed && this.terminalProjectKeys.get(instance.instanceId) === projectKey);
		return instances.map(instance => this.getMobileTerminalTab(projectKey, instance, activeInstance === instance));
	}

	private async getMobileTerminalTabsWithRawOutput(projectKey: string): Promise<IVectorCodeMobileRemoteTerminalTab[]> {
		const activeInstance = this.projectActiveTerminalInstances.get(projectKey);
		const instances = (this.projectTerminalInstances.get(projectKey) ?? []).filter(instance => !instance.isDisposed && this.terminalProjectKeys.get(instance.instanceId) === projectKey);
		return Promise.all(instances.map(instance => this.getMobileTerminalTabWithRawOutput(projectKey, instance, activeInstance === instance)));
	}

	private getMobileTerminalTab(projectKey: string, instance: ITerminalInstance, isActive: boolean): IVectorCodeMobileRemoteTerminalTab {
		return {
			id: String(instance.instanceId),
			projectId: projectKey,
			title: instance.title || instance.processName || localize('vectorCodeMobileTerminalTitle', 'Terminal'),
			cwd: instance.cwd ?? instance.initialCwd ?? '',
			isActive,
			output: this.terminalOutputLines.get(instance.instanceId) ?? []
		};
	}

	private async getMobileTerminalTabWithRawOutput(projectKey: string, instance: ITerminalInstance, isActive: boolean): Promise<IVectorCodeMobileRemoteTerminalTab> {
		return {
			...this.getMobileTerminalTab(projectKey, instance, isActive),
			rawOutput: await this.getTerminalRawOutput(instance)
		};
	}

	private async getTerminalRawOutput(instance: ITerminalInstance): Promise<string | undefined> {
		const xterm = instance.xterm ?? await instance.xtermReadyPromise;
		if (!xterm) {
			return undefined;
		}
		const rawOutput = await xterm.getRangeAsVT();
		if (rawOutput.length <= VECTOR_CODE_MOBILE_TERMINAL_RAW_OUTPUT_MAX_CHARS) {
			return rawOutput;
		}
		const start = rawOutput.length - VECTOR_CODE_MOBILE_TERMINAL_RAW_OUTPUT_MAX_CHARS;
		const lineStart = rawOutput.indexOf('\n', start);
		const safeStart = lineStart >= 0 ? lineStart + 1 : start;
		return `\x1b[0m\x1b[2J\x1b[H${rawOutput.slice(safeStart)}`;
	}

	private getMobileRequestProject(request: IVectorCodeMobileRemoteEnvelope): IVectorCodeProjectSummary | undefined {
		const projectId = request.projectId ?? this.activeProjectUri?.toString();
		if (!projectId) {
			return undefined;
		}
		return this.getProjectById(projectId);
	}

	private getProjectById(projectId: string): IVectorCodeProjectSummary | undefined {
		return this.getProjectSummaries().find(project => project.uri.toString() === projectId);
	}

	private resolveMobileProjectResource(project: IVectorCodeProjectSummary, relativePath: string, allowRoot: boolean): { readonly resource: URI; readonly relativePath: string } | undefined {
		const segments = relativePath.split(/[\\/]+/).filter(Boolean);
		if (!segments.length && !allowRoot) {
			return undefined;
		}
		if (segments.some(segment => segment === '.' || segment === '..')) {
			return undefined;
		}

		const resource = segments.length ? URI.joinPath(project.uri, ...segments) : project.uri;
		if (!isEqualOrParent(resource, project.uri, true)) {
			return undefined;
		}

		return {
			resource,
			relativePath: segments.join('/')
		};
	}

	private getProjectTerminalInstance(projectKey: string, terminalId: string): ITerminalInstance | undefined {
		return (this.projectTerminalInstances.get(projectKey) ?? []).find(instance => (
			!instance.isDisposed
			&& String(instance.instanceId) === terminalId
			&& this.terminalProjectKeys.get(instance.instanceId) === projectKey
		));
	}

	private async getMobileFileTree(projectUri: URI, relativePath = ''): Promise<IVectorCodeMobileRemoteFileTreeResponse> {
		const target = this.resolveMobileProjectResource({ name: '', uri: projectUri, uriLabel: '' }, relativePath, true);
		if (!target) {
			return { nodes: [], truncated: true };
		}
		return this.readMobileFileTreeChildren(projectUri, target.resource, target.relativePath, 0);
	}

	private async readMobileFileTreeChildren(rootUri: URI, folderUri: URI, parentPath: string, depth: number): Promise<{ readonly nodes: IVectorCodeMobileRemoteFileNode[]; readonly truncated: boolean }> {
		if (depth > VECTOR_CODE_MOBILE_FILE_TREE_MAX_DEPTH) {
			return { nodes: [], truncated: true };
		}

		await this.fileService.activateProvider(folderUri.scheme);
		const provider = this.fileService.getProvider(folderUri.scheme);
		if (!provider) {
			return { nodes: [], truncated: true };
		}

		try {
			const allEntries = (await provider.readdir(folderUri))
				.filter(([name, type]) => {
					if (VECTOR_CODE_MOBILE_FILE_TREE_EXCLUDED_NAMES.has(name)) {
						return false;
					}
					return Boolean(type & FileType.File) || Boolean(type & FileType.Directory);
				})
				.sort(([firstName, firstType], [secondName, secondType]) => {
					const firstIsFolder = Boolean(firstType & FileType.Directory);
					const secondIsFolder = Boolean(secondType & FileType.Directory);
					if (firstIsFolder !== secondIsFolder) {
						return firstIsFolder ? -1 : 1;
					}
					return firstName.localeCompare(secondName);
				});
			const childrenTruncated = allEntries.length > VECTOR_CODE_MOBILE_FILE_TREE_MAX_CHILDREN_PER_FOLDER;
			const entries = allEntries.slice(0, VECTOR_CODE_MOBILE_FILE_TREE_MAX_CHILDREN_PER_FOLDER);

			const nodes = await Promise.all(entries.map(async ([name, type]): Promise<IVectorCodeMobileRemoteFileNode | undefined> => {
				const childUri = URI.joinPath(folderUri, name);
				if (!isEqualOrParent(childUri, rootUri, true)) {
					return undefined;
				}

				const childPath = parentPath ? `${parentPath}/${name}` : name;
				if (type & FileType.Directory) {
					return {
						name,
						path: childPath,
						kind: 'folder' as const,
						children: [],
						childrenTruncated: depth < VECTOR_CODE_MOBILE_FILE_TREE_MAX_DEPTH
					};
				}

				return {
					name,
					path: childPath,
					kind: 'file' as const
				};
			}));

			return {
				nodes: nodes.filter((node): node is IVectorCodeMobileRemoteFileNode => Boolean(node)),
				truncated: childrenTruncated
			};
		} catch {
			return { nodes: [], truncated: true };
		}
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
		this.terminalOutputLines.delete(instance.instanceId);
		for (const disposable of this.terminalOutputDisposables.get(instance.instanceId) ?? []) {
			disposable.dispose();
		}
		this.terminalOutputDisposables.delete(instance.instanceId);
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

function getMobilePayloadObject(payload: unknown): Record<string, unknown> {
	return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function getRequiredMobilePayloadString(payload: Record<string, unknown>, key: string): string | undefined {
	const value = payload[key];
	return typeof value === 'string' ? value : undefined;
}

function getOptionalMobilePayloadString(payload: Record<string, unknown>, key: string): string | undefined {
	const value = payload[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getMobilePayloadBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
	const value = payload[key];
	return typeof value === 'boolean' ? value : undefined;
}

function getPositiveIntegerMobilePayloadValue(payload: Record<string, unknown>, key: string): number | undefined {
	const value = payload[key];
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function inferLanguage(path: string): string {
	const extension = path.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
	switch (extension) {
		case 'md':
		case 'mdx':
			return 'markdown';
		case 'ts':
		case 'tsx':
			return 'typescript';
		case 'js':
		case 'jsx':
			return 'javascript';
		case 'json':
			return 'json';
		case 'swift':
			return 'swift';
		case 'sh':
		case 'zsh':
		case 'bash':
			return 'shell';
		default:
			return 'text';
	}
}

registerSingleton(IVectorCodeWorkbenchService, VectorCodeWorkbenchService, InstantiationType.Delayed);
