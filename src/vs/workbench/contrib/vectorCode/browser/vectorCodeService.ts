/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isEqualOrParent, relativePath } from '../../../../base/common/resources.js';
import { hasKey } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { FileOperationError, FileOperationResult, FileType, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ADD_ROOT_FOLDER_COMMAND_ID } from '../../../browser/actions/workspaceCommands.js';
import { GroupsOrder, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { REVEAL_IN_EXPLORER_COMMAND_ID } from '../../files/browser/fileConstants.js';
import { VIEW_ID as EXPLORER_FILE_VIEW_ID, VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';
import { ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { TERMINAL_VIEW_ID } from '../../terminal/common/terminal.js';
import { IVectorCodeMobileRelayService, IVectorCodeProjectSummary, IVectorCodeWorkbenchService, VECTOR_CODE_VIEW_CONTAINER_ID, VectorCodeMobileConnectionState } from '../common/vectorCode.js';
import { inferVectorCodeLanguage } from '../common/vectorCodeLanguageInference.js';
import {
	createVectorCodeMobileRemoteErrorResponse,
	createVectorCodeMobileRemoteResponse,
	isVectorCodeMobileTerminalControlCommand,
	isVectorCodeMobileTerminalInputMode,
	IVectorCodeMobileRemoteEditorTab,
	IVectorCodeMobileRemoteEnvelope,
	IVectorCodeMobileRemoteFileCopyResponse,
	IVectorCodeMobileRemoteFileMoveResponse,
	IVectorCodeMobileRemoteFileNode,
	IVectorCodeMobileRemoteFileReadResponse,
	IVectorCodeMobileRemoteFileTreeResponse,
	IVectorCodeMobileRemoteFileWriteResponse,
	IVectorCodeMobileRemoteTerminalControlResponse,
	IVectorCodeMobileRemoteTerminalInputResponse,
	IVectorCodeMobileRemoteTerminalOutputResponse,
	IVectorCodeMobileRemoteTerminalTab,
	IVectorCodeMobileRemoteWorkspaceSnapshot,
	VectorCodeMobileRemoteAction,
	VectorCodeMobileTerminalControlCommand,
	VectorCodeMobileTerminalInputMode
} from '../common/vectorCodeMobileProtocol.js';
import { VectorCodeMobileTerminalStateStore } from './vectorCodeMobileTerminalState.js';

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
	readonly resource: URI;
	readonly path: string;
	readonly groupIndex: number;
	readonly index: number;
}

interface IVectorCodeTerminalLayoutState {
	readonly panelVisible: boolean;
	readonly terminalVisible: boolean;
}

interface IVectorCodeMobileProjectResource {
	readonly resource: URI;
	readonly relativePath: string;
}

interface IVectorCodeMobileFileTarget {
	readonly project: IVectorCodeProjectSummary;
	readonly payload: Record<string, unknown>;
	readonly target: IVectorCodeMobileProjectResource;
}

interface IVectorCodeMobileFileTransfer {
	readonly source: IVectorCodeMobileProjectResource;
	readonly target: IVectorCodeMobileProjectResource;
	readonly targetProjectId: string;
	readonly overwrite: boolean;
}

interface IVectorCodeMobileRequestProject {
	readonly project: IVectorCodeProjectSummary;
}

interface IVectorCodeMobileTerminalTarget {
	readonly projectKey: string;
	readonly payload: Record<string, unknown>;
	readonly terminalId: string;
	readonly instance: ITerminalInstance;
}

class VectorCodeWorkbenchService extends Disposable implements IVectorCodeWorkbenchService {
	readonly _serviceBrand: undefined;
	private readonly _onDidChangeActiveProject = this._register(new Emitter<URI | undefined>());
	readonly onDidChangeActiveProject = this._onDidChangeActiveProject.event;

	private activeProjectUri: URI | undefined;
	private readonly terminalState = this._register(new VectorCodeMobileTerminalStateStore(VECTOR_CODE_MOBILE_TERMINAL_OUTPUT_MAX_LINES));
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
		this._register(this.terminalService.onDidCreateInstance(instance => this.terminalState.adopt(instance, this.activeProjectUri?.toString())));
		this._register(this.terminalService.onDidDisposeInstance(instance => this.terminalState.forget(instance)));
		this._register(this.terminalService.onDidChangeActiveInstance(instance => {
			const projectKey = instance ? this.terminalState.getProjectKey(instance) : undefined;
			if (projectKey && instance && !instance.isDisposed) {
				this.terminalState.setActive(projectKey, instance);
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
			this.captureProjectTerminalState(activeProjectKey);
		}

		const editorEntriesByProject = this.getEditorEntriesByProject(projects);
		const editorsByProject: Record<string, IVectorCodeMobileRemoteEditorTab[]> = {};
		const terminalsByProject: Record<string, IVectorCodeMobileRemoteTerminalTab[]> = {};
		for (const project of projects) {
			const projectKey = project.uri.toString();
			editorsByProject[projectKey] = this.getMobileEditorTabs(projectKey, editorEntriesByProject.get(projectKey) ?? []);
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
		const currentStatus = this.mobileRelayService.getStatus();
		if (currentStatus.state === VectorCodeMobileConnectionState.Connected || currentStatus.state === VectorCodeMobileConnectionState.Pairing) {
			this.notificationService.info(currentStatus.detail);
			return;
		}
		const status = await this.mobileRelayService.startPairing();
		this.notificationService.info(status.detail);
	}

	async toggleActiveProjectTerminalPanel(): Promise<void> {
		if (this.layoutService.isVisible(Parts.PANEL_PART) && this.viewsService.isViewVisible(TERMINAL_VIEW_ID)) {
			this.layoutService.setPartHidden(true, Parts.PANEL_PART);
			return;
		}

		const projectKey = this.activeProjectUri?.toString();
		let instance = projectKey ? this.terminalState.getActive(projectKey) : undefined;
		if (!instance && projectKey) {
			instance = this.terminalState.getInstances(projectKey)[0];
		}
		if (!instance && this.terminalService.isProcessSupportRegistered) {
			instance = await this.terminalService.createTerminal({
				location: TerminalLocation.Panel,
				cwd: this.activeProjectUri
			});
			if (projectKey) {
				this.terminalState.adopt(instance, projectKey, true);
			}
		}

		if (instance && projectKey) {
			this.terminalState.setActive(projectKey, instance);
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
				return createVectorCodeMobileRemoteResponse(request, await this.getMobileWorkspaceSnapshotWithFiles(request.projectId));
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
				return createVectorCodeMobileRemoteErrorResponse(request, 'unsupported_action', `The desktop bridge does not support ${request.action} yet.`);
		}
	}

	private async handleMobileFileTreeRead(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const result = this.resolveMobileFileTarget(request, {
			allowRoot: true,
			defaultPath: '',
			invalidPathMessage: 'The requested file tree path is outside the project.'
		});
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { project, target } = result.target;
		return createVectorCodeMobileRemoteResponse(request, await this.getMobileFileTree(project.uri, target.relativePath));
	}

	private async handleMobileFileRead(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const result = this.resolveMobileFileTarget(request, {
			allowRoot: false,
			missingPathMessage: 'File read requires a path.',
			invalidPathMessage: 'The requested file is outside the project.'
		});
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { target } = result.target;
		const stat = await this.fileService.stat(target.resource);
		if (!stat.isFile) {
			return createVectorCodeMobileRemoteErrorResponse(request, 'not_a_file', 'The requested path is not a file.');
		}

		const content = await this.fileService.readFile(target.resource);
		const response: IVectorCodeMobileRemoteFileReadResponse = {
			path: target.relativePath,
			content: content.value.toString(),
			language: inferVectorCodeLanguage(target.relativePath),
			version: content.etag
		};
		return createVectorCodeMobileRemoteResponse(request, response);
	}

	private async handleMobileFileWrite(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const result = this.resolveMobileFileTarget(request, {
			allowRoot: false,
			missingPathMessage: 'File write requires a path and content.',
			invalidPathMessage: 'The requested file is outside the project.'
		});
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { payload, target } = result.target;
		const content = getRequiredMobilePayloadString(payload, 'content');
		if (content === undefined) {
			return createVectorCodeMobileRemoteErrorResponse(request, 'invalid_payload', 'File write requires a path and content.');
		}

		const expectedVersion = getOptionalMobilePayloadString(payload, 'expectedVersion');
		let stat;
		try {
			stat = await this.fileService.writeFile(target.resource, VSBuffer.fromString(content), expectedVersion ? { etag: expectedVersion } : undefined);
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {
				return createVectorCodeMobileRemoteErrorResponse(request, 'file_modified_since', 'The desktop file changed since the phone opened it.');
			}
			throw error;
		}
		const response: IVectorCodeMobileRemoteFileWriteResponse = {
			path: target.relativePath,
			version: stat.etag
		};
		return createVectorCodeMobileRemoteResponse(request, response);
	}

	private resolveMobileFileTarget(
		request: IVectorCodeMobileRemoteEnvelope,
		options: {
			readonly allowRoot: boolean;
			readonly defaultPath?: string;
			readonly missingPathMessage?: string;
			readonly invalidPathMessage: string;
		}
	): { readonly target: IVectorCodeMobileFileTarget } | { readonly error: IVectorCodeMobileRemoteEnvelope } {
		const projectResult = this.resolveMobileRequestProject(request);
		if (hasKey(projectResult, { error: true })) {
			return projectResult;
		}

		const { project } = projectResult.target;
		const payload = getMobilePayloadObject(request.payload);
		const path = options.defaultPath ?? getRequiredMobilePayloadString(payload, 'path');
		if (path === undefined || (!options.allowRoot && !path)) {
			return {
				error: createVectorCodeMobileRemoteErrorResponse(request, 'invalid_payload', options.missingPathMessage ?? 'The request requires a path.')
			};
		}

		const target = this.resolveMobileProjectResource(project, path, options.allowRoot);
		if (!target) {
			return {
				error: createVectorCodeMobileRemoteErrorResponse(request, 'invalid_path', options.invalidPathMessage)
			};
		}

		return { target: { project, payload, target } };
	}

	private resolveMobileFileTransfer(
		request: IVectorCodeMobileRemoteEnvelope,
		payload: Record<string, unknown>,
		options: { readonly actionLabel: 'move' | 'copy'; readonly requireTargetProject: boolean }
	): { readonly transfer: IVectorCodeMobileFileTransfer } | { readonly error: IVectorCodeMobileRemoteEnvelope } {
		const sourceProjectResult = this.resolveMobileRequestProject(request);
		if (hasKey(sourceProjectResult, { error: true })) {
			return sourceProjectResult;
		}

		const { project: sourceProject } = sourceProjectResult.target;
		const path = getRequiredMobilePayloadString(payload, 'path');
		const targetPath = getRequiredMobilePayloadString(payload, 'targetPath');
		const explicitTargetProjectId = getRequiredMobilePayloadString(payload, 'targetProjectId');
		if (!path || !targetPath || (options.requireTargetProject && !explicitTargetProjectId)) {
			const targetProjectMessage = options.requireTargetProject ? ', targetProjectId,' : '';
			return {
				error: createVectorCodeMobileRemoteErrorResponse(
					request,
					'invalid_payload',
					`File ${options.actionLabel} requires a source project, path${targetProjectMessage} and targetPath.`
				)
			};
		}

		const targetProjectId = explicitTargetProjectId ?? sourceProject.uri.toString();
		const targetProject = this.getProjectById(targetProjectId);
		if (!targetProject) {
			return {
				error: createVectorCodeMobileRemoteErrorResponse(request, 'target_project_not_found', 'The destination project is not open on the desktop.')
			};
		}

		const source = this.resolveMobileProjectResource(sourceProject, path, false);
		const target = this.resolveMobileProjectResource(targetProject, targetPath, false);
		if (!source || !target) {
			return {
				error: createVectorCodeMobileRemoteErrorResponse(request, 'invalid_path', `The requested ${options.actionLabel} path is outside an open project.`)
			};
		}

		return {
			transfer: {
				source,
				target,
				targetProjectId: targetProject.uri.toString(),
				overwrite: getMobilePayloadBoolean(payload, 'overwrite') ?? false
			}
		};
	}

	private async handleMobileFileMove(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const payload = getMobilePayloadObject(request.payload);
		const result = this.resolveMobileFileTransfer(request, payload, { actionLabel: 'move', requireTargetProject: false });
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { source, target, targetProjectId, overwrite } = result.transfer;
		await this.fileService.move(source.resource, target.resource, overwrite);
		const response: IVectorCodeMobileRemoteFileMoveResponse = {
			path: source.relativePath,
			targetPath: target.relativePath,
			targetProjectId
		};
		return createVectorCodeMobileRemoteResponse(request, response);
	}

	private async handleMobileFileCopy(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const payload = getMobilePayloadObject(request.payload);
		const result = this.resolveMobileFileTransfer(request, payload, { actionLabel: 'copy', requireTargetProject: true });
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { source, target, targetProjectId, overwrite } = result.transfer;
		await this.fileService.copy(source.resource, target.resource, overwrite);
		const response: IVectorCodeMobileRemoteFileCopyResponse = {
			path: source.relativePath,
			targetPath: target.relativePath,
			targetProjectId
		};
		return createVectorCodeMobileRemoteResponse(request, response);
	}

	private async handleMobileTerminalList(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const result = this.resolveMobileRequestProject(request);
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { project } = result.target;
		return createVectorCodeMobileRemoteResponse(request, await this.getMobileTerminalTabsWithRawOutput(project.uri.toString()));
	}

	private async handleMobileTerminalCreate(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const result = this.resolveMobileRequestProject(request);
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { project } = result.target;
		const payload = getMobilePayloadObject(request.payload);
		const requestedTitle = getOptionalMobilePayloadString(payload, 'title');
		const requestedCwd = getOptionalMobilePayloadString(payload, 'cwd');
		const cwd = requestedCwd ? this.resolveMobileProjectResource(project, requestedCwd, true)?.resource : project.uri;
		if (!cwd) {
			return createVectorCodeMobileRemoteErrorResponse(request, 'invalid_cwd', 'The requested terminal working directory is outside the project.');
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
		this.terminalState.adopt(instance, projectKey, true);
		this.terminalState.setActive(projectKey, instance);
		if (projectKey === this.activeProjectUri?.toString()) {
			this.terminalService.setActiveInstance(instance);
		} else {
			this.terminalService.moveToBackground(instance);
		}

		return createVectorCodeMobileRemoteResponse(request, await this.getMobileTerminalTabWithRawOutput(projectKey, instance, true));
	}

	private async handleMobileTerminalInput(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const result = this.resolveMobileTerminalTarget(request, 'Terminal input requires a project, terminalId, and input.');
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { payload, terminalId, projectKey, instance } = result.target;
		const input = getRequiredMobilePayloadString(payload, 'input');
		const submit = getMobilePayloadBoolean(payload, 'submit') ?? false;
		const mode = getOptionalMobilePayloadString(payload, 'mode') ?? (submit ? VectorCodeMobileTerminalInputMode.Command : VectorCodeMobileTerminalInputMode.Paste);
		if (input === undefined) {
			return createVectorCodeMobileRemoteErrorResponse(request, 'invalid_payload', 'Terminal input requires a project, terminalId, and input.');
		}
		if (!isVectorCodeMobileTerminalInputMode(mode)) {
			return createVectorCodeMobileRemoteErrorResponse(request, 'invalid_payload', 'Terminal input mode must be raw, paste, or command.');
		}

		this.terminalState.setActive(projectKey, instance);
		if (projectKey === this.activeProjectUri?.toString()) {
			this.terminalService.setActiveInstance(instance);
		}
		await instance.sendText(input, mode === VectorCodeMobileTerminalInputMode.Command ? submit : false, mode === VectorCodeMobileTerminalInputMode.Paste);
		const response: IVectorCodeMobileRemoteTerminalInputResponse = {
			terminalId,
			accepted: true
		};
		return createVectorCodeMobileRemoteResponse(request, response);
	}

	private async handleMobileTerminalControl(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const result = this.resolveMobileTerminalTarget(request, 'Terminal control requires a project, terminalId, and command.');
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { payload, terminalId, instance } = result.target;
		const command = getRequiredMobilePayloadString(payload, 'command');
		if (!command) {
			return createVectorCodeMobileRemoteErrorResponse(request, 'invalid_payload', 'Terminal control requires a project, terminalId, and command.');
		}

		let accepted = true;
		if (!isVectorCodeMobileTerminalControlCommand(command)) {
			accepted = false;
		} else {
			switch (command) {
				case VectorCodeMobileTerminalControlCommand.Clear:
					instance.clearBuffer();
					this.terminalState.clearOutput(instance);
					break;
				case VectorCodeMobileTerminalControlCommand.Interrupt:
					await instance.sendSignal('SIGINT');
					break;
				case VectorCodeMobileTerminalControlCommand.Rename: {
					const title = getOptionalMobilePayloadString(payload, 'title');
					if (title) {
						await instance.rename(title);
					} else {
						accepted = false;
					}
					break;
				}
				case VectorCodeMobileTerminalControlCommand.Close:
					instance.dispose();
					break;
				case VectorCodeMobileTerminalControlCommand.Resize: {
					const cols = getPositiveIntegerMobilePayloadValue(payload, 'cols');
					const rows = getPositiveIntegerMobilePayloadValue(payload, 'rows');
					if (cols && rows) {
						if (instance.cols !== cols || instance.rows !== rows) {
							instance.setOverrideDimensions({ cols, rows });
						}
					} else {
						accepted = false;
					}
					break;
				}
				default:
					accepted = false;
					break;
			}
		}

		const response: IVectorCodeMobileRemoteTerminalControlResponse = {
			terminalId,
			accepted
		};
		return createVectorCodeMobileRemoteResponse(request, response);
	}

	private async handleMobileTerminalOutput(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		const result = this.resolveMobileTerminalTarget(request, 'Terminal output requires a project and terminalId.');
		if (hasKey(result, { error: true })) {
			return result.error;
		}

		const { terminalId, instance } = result.target;
		const response: IVectorCodeMobileRemoteTerminalOutputResponse = {
			terminalId,
			output: this.terminalState.getOutput(instance),
			rawOutput: await this.getTerminalRawOutput(instance)
		};
		return createVectorCodeMobileRemoteResponse(request, response);
	}

	private resolveMobileRequestProject(request: IVectorCodeMobileRemoteEnvelope): { readonly target: IVectorCodeMobileRequestProject } | { readonly error: IVectorCodeMobileRemoteEnvelope } {
		const project = this.getMobileRequestProject(request);
		if (!project) {
			return {
				error: createVectorCodeMobileRemoteErrorResponse(request, 'project_not_found', 'The requested project is not open on the desktop.')
			};
		}

		return { target: { project } };
	}

	private resolveMobileTerminalTarget(
		request: IVectorCodeMobileRemoteEnvelope,
		missingPayloadMessage: string
	): { readonly target: IVectorCodeMobileTerminalTarget } | { readonly error: IVectorCodeMobileRemoteEnvelope } {
		const projectResult = this.resolveMobileRequestProject(request);
		if (hasKey(projectResult, { error: true })) {
			return projectResult;
		}

		const { project } = projectResult.target;
		const payload = getMobilePayloadObject(request.payload);
		const terminalId = getRequiredMobilePayloadString(payload, 'terminalId');
		if (!terminalId) {
			return {
				error: createVectorCodeMobileRemoteErrorResponse(request, 'invalid_payload', missingPayloadMessage)
			};
		}

		const projectKey = project.uri.toString();
		const instance = this.getProjectTerminalInstance(projectKey, terminalId);
		if (!instance) {
			return {
				error: createVectorCodeMobileRemoteErrorResponse(request, 'terminal_not_found', 'The requested terminal is not open for this project.')
			};
		}

		return { target: { projectKey, payload, terminalId, instance } };
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
				previousTerminalInstances = this.captureProjectTerminalState(previousProjectKey);
			}
			this.activeProjectUri = projectUri;
			if (previousProjectKey) {
				await this.restoreProjectTerminalState(nextProjectKey);
				this.hideTerminalInstances(previousTerminalInstances);
			} else if (nextProjectKey) {
				this.captureProjectTerminalState(nextProjectKey);
			}

			await this.showProjectFiles(projectUri);
			await this.restoreTerminalLayoutState(terminalLayoutState);
			this._onDidChangeActiveProject.fire(projectUri);
		} finally {
			this.projectSwitching = false;
		}
	}

	private getEditorEntriesByProject(projects: readonly IVectorCodeProjectSummary[]): Map<string, IVectorCodeEditorEntry[]> {
		const entriesByProject = new Map<string, IVectorCodeEditorEntry[]>();
		const groups = this.editorGroupsService.getGroups(GroupsOrder.GRID_APPEARANCE);
		for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
			const group = groups[groupIndex];
			for (const editor of group.editors) {
				const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
				if (!resource) {
					continue;
				}

				const projectResource = this.getEditorProjectResource(resource, projects);
				if (!projectResource) {
					continue;
				}

				const entries = entriesByProject.get(projectResource.projectKey) ?? [];
				entries.push({
					editor,
					resource,
					path: projectResource.relativePath,
					groupIndex,
					index: group.getIndexOfEditor(editor)
				});
				entriesByProject.set(projectResource.projectKey, entries);
			}
		}

		return entriesByProject;
	}

	private captureProjectTerminalState(projectKey: string): readonly ITerminalInstance[] {
		const visibleInstances = this.terminalGroupService.instances.filter(instance => !instance.isDisposed);
		const activeInstance = this.terminalGroupService.activeGroup?.activeInstance;
		return this.terminalState.captureProject(projectKey, visibleInstances, activeInstance);
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

		const instances = this.terminalState.getInstances(projectKey);

		for (const instance of instances) {
			await this.terminalService.showBackgroundTerminal(instance, true);
		}

		const activeInstance = this.terminalState.getActive(projectKey);
		if (activeInstance && instances.includes(activeInstance)) {
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

	private getMobileEditorTabs(projectKey: string, entries: readonly IVectorCodeEditorEntry[]): IVectorCodeMobileRemoteEditorTab[] {
		return entries.map(entry => {
			const path = entry.path;
			return {
				id: `${projectKey}:editor:${entry.groupIndex}:${entry.index}:${entry.resource.toString()}`,
				projectId: projectKey,
				path,
				title: entry.editor.getName(),
				language: inferVectorCodeLanguage(path),
				isDirty: entry.editor.isDirty()
			};
		});
	}

	private getMobileTerminalTabs(projectKey: string): IVectorCodeMobileRemoteTerminalTab[] {
		const activeInstance = this.terminalState.getActive(projectKey);
		const instances = this.terminalState.getInstances(projectKey);
		return instances.map(instance => this.getMobileTerminalTab(projectKey, instance, activeInstance === instance));
	}

	private async getMobileTerminalTabsWithRawOutput(projectKey: string): Promise<IVectorCodeMobileRemoteTerminalTab[]> {
		const activeInstance = this.terminalState.getActive(projectKey);
		const instances = this.terminalState.getInstances(projectKey);
		return Promise.all(instances.map(instance => this.getMobileTerminalTabWithRawOutput(projectKey, instance, activeInstance === instance)));
	}

	private getMobileTerminalTab(projectKey: string, instance: ITerminalInstance, isActive: boolean): IVectorCodeMobileRemoteTerminalTab {
		return {
			id: String(instance.instanceId),
			projectId: projectKey,
			title: instance.title || instance.processName || localize('vectorCodeMobileTerminalTitle', 'Terminal'),
			cwd: instance.cwd ?? instance.initialCwd ?? '',
			isActive,
			output: this.terminalState.getOutput(instance)
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

	private getEditorProjectResource(resource: URI, projects: readonly IVectorCodeProjectSummary[]): { readonly projectKey: string; readonly relativePath: string } | undefined {
		let bestProject: IVectorCodeProjectSummary | undefined;
		for (const project of projects) {
			if (!isEqualOrParent(resource, project.uri, true)) {
				continue;
			}
			if (!bestProject || project.uri.path.length > bestProject.uri.path.length) {
				bestProject = project;
			}
		}
		if (!bestProject) {
			return undefined;
		}

		const projectRelativePath = relativePath(bestProject.uri, resource);
		return {
			projectKey: bestProject.uri.toString(),
			relativePath: projectRelativePath || this.labelService.getUriLabel(resource, { relative: true })
		};
	}

	private resolveMobileProjectResource(project: IVectorCodeProjectSummary, relativePath: string, allowRoot: boolean): IVectorCodeMobileProjectResource | undefined {
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
		return this.terminalState.getInstances(projectKey).find(instance => String(instance.instanceId) === terminalId);
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

	private pruneProjectState(): void {
		const projectKeys = new Set(this.getProjectSummaries().map(project => project.uri.toString()));
		this.terminalState.prune(projectKeys);

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


registerSingleton(IVectorCodeWorkbenchService, VectorCodeWorkbenchService, InstantiationType.Delayed);
