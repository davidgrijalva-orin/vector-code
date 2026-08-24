/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Severity from '../../../../base/common/severity.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IVectorCodeCodexBridgeNotification, IVectorCodeCodexBridgeServerRequest, IVectorCodeCodexBridgeService } from '../../../../platform/vectorCodeCodex/common/vectorCodeCodexBridge.js';
import { IVectorCodeRuntimeDiagnosticSummary, IVectorCodeRuntimeError, runVectorCodeRuntimeWithTimeout, toVectorCodeRuntimeError, VectorCodeRuntimeController, VectorCodeRuntimeError, VectorCodeRuntimeErrorCode, VectorCodeRuntimeState } from '../../../../platform/vectorCode/common/vectorCodeRuntime.js';
import { IVectorCodeCodexMessage, IVectorCodeCodexModel, IVectorCodeCodexService, IVectorCodeCodexState, IVectorCodeCodexThread, IVectorCodeWorkbenchService, VECTOR_CODE_CODEX_CAPABILITY_MESSAGE, VECTOR_CODE_CODEX_CAPABILITY_PLUGINS, VECTOR_CODE_CODEX_CAPABILITY_THREADS, VectorCodeCodexConnectionState } from '../common/vectorCode.js';
import { VectorCodeCodexRestartPolicy } from '../common/vectorCodeCodexLifecycle.js';

const CODEX_STARTUP_TIMEOUT_MS = 30_000;
const CODEX_STARTUP_REQUEST_TIMEOUT_MS = 30_000;
const CODEX_READY_CAPABILITIES = [
	VECTOR_CODE_CODEX_CAPABILITY_MESSAGE,
	VECTOR_CODE_CODEX_CAPABILITY_PLUGINS,
	VECTOR_CODE_CODEX_CAPABILITY_THREADS,
] as const;

interface IVectorCodeCodexThreadData {
	readonly id: string;
	readonly name?: string | null;
	readonly preview?: string;
	readonly updatedAt?: number;
	readonly createdAt?: number;
	readonly status?: unknown;
	readonly turns?: readonly IVectorCodeCodexTurnData[];
}

interface IVectorCodeCodexTurnData {
	readonly id: string;
	readonly status?: string;
	readonly items?: readonly unknown[];
	readonly error?: unknown;
}

interface IVectorCodeCodexPluginData {
	readonly id: string;
	readonly name: string;
	readonly displayName: string;
	readonly marketplaceName: string;
	readonly marketplacePath?: string;
	readonly installed: boolean;
	readonly enabled: boolean;
	readonly version?: string;
	readonly description?: string;
	readonly capabilities: readonly string[];
	readonly installPolicy?: string;
	readonly availability?: string;
}

interface IVectorCodeCodexPluginPickItem {
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
	readonly plugin?: IVectorCodeCodexPluginData;
	readonly browse?: boolean;
}

interface IVectorCodeCodexStatePatch {
	readonly connectionState?: VectorCodeCodexConnectionState;
	readonly runtime?: IVectorCodeCodexState['runtime'];
	readonly detail?: string;
	readonly accountLabel?: string | undefined;
	readonly requiresAuthentication?: boolean;
	readonly activeProjectName?: string | undefined;
	readonly activeProjectPath?: string | undefined;
	readonly threads?: readonly IVectorCodeCodexThread[];
	readonly activeThreadId?: string | undefined;
	readonly messages?: readonly IVectorCodeCodexMessage[];
	readonly turnInProgress?: boolean;
	readonly models?: readonly IVectorCodeCodexModel[];
	readonly selectedModel?: string | undefined;
	readonly selectedReasoningEffort?: string | undefined;
	readonly installedPluginCount?: number;
}

class VectorCodeCodexService extends Disposable implements IVectorCodeCodexService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<IVectorCodeCodexState>());
	readonly onDidChangeState = this._onDidChangeState.event;
	private readonly runtime = new VectorCodeRuntimeController('codex');

	private state: IVectorCodeCodexState = {
		connectionState: VectorCodeCodexConnectionState.Idle,
		runtime: this.runtime.getStatus(),
		detail: localize('vectorCodeCodexIdle', 'Start a Codex conversation for the active project.'),
		requiresAuthentication: false,
		threads: [],
		messages: [],
		turnInProgress: false,
		models: [],
		installedPluginCount: 0,
	};
	private connectionId: string | undefined;
	private startPromise: Promise<void> | undefined;
	private activeTurnId: string | undefined;
	private projectEpoch = 0;
	private projectCancellation = new CancellationTokenSource();
	private readonly restartPolicy = new VectorCodeCodexRestartPolicy();
	private readonly restartScheduler: RunOnceScheduler;
	private activeStartupCorrelationId: string | undefined;
	private isDisposed = false;
	private readonly writableThreadIds = new Set<string>();

	constructor(
		@IDialogService private readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ILogService private readonly logService: ILogService,
		@IVectorCodeCodexBridgeService private readonly bridgeService: IVectorCodeCodexBridgeService,
		@IVectorCodeWorkbenchService private readonly vectorCodeWorkbenchService: IVectorCodeWorkbenchService,
	) {
		super();
		this.restartScheduler = this._register(new RunOnceScheduler(() => void this.restartAfterFailure(), 0));
		this.state = { ...this.state, ...this.getActiveProjectState() };
		this._register(this.bridgeService.onDidReceiveNotification(event => this.handleNotification(event)));
		this._register(this.bridgeService.onDidReceiveServerRequest(event => void this.handleServerRequest(event)));
		this._register(this.bridgeService.onDidChangeConnection(event => {
			if (event.connectionId !== this.connectionId || event.state === 'started') {
				return;
			}
			this.connectionId = undefined;
			this.activeTurnId = undefined;
			this.writableThreadIds.clear();
			const detail = event.detail || localize('vectorCodeCodexStopped', 'Codex stopped.');
			if (event.state === 'error') {
				const runtimeError = this.createRuntimeError(detail, VectorCodeRuntimeErrorCode.ConnectionLost, true, event.connectionId);
				if (this.startPromise) {
					this.setState({
						connectionState: VectorCodeCodexConnectionState.Error,
						runtime: this.runtime.transition(VectorCodeRuntimeState.Unavailable, { error: runtimeError, correlationId: runtimeError.correlationId }),
						detail: runtimeError.userMessage,
						turnInProgress: false,
					});
				} else {
					this.scheduleRestart(runtimeError);
				}
				return;
			}
			this.restartScheduler.cancel();
			this.restartPolicy.reset();
			this.setState({
				connectionState: VectorCodeCodexConnectionState.Idle,
				runtime: this.runtime.transition(VectorCodeRuntimeState.Stopped, { correlationId: event.connectionId }),
				detail,
				turnInProgress: false,
			});
		}));
		this._register(this.vectorCodeWorkbenchService.onDidChangeActiveProject(() => {
			this.projectEpoch++;
			this.projectCancellation.dispose(true);
			this.projectCancellation = new CancellationTokenSource();
			this.activeTurnId = undefined;
			const projectState = this.getActiveProjectState();
			this.setState({
				...projectState,
				threads: [],
				activeThreadId: undefined,
				messages: [],
				turnInProgress: false,
				detail: projectState.activeProjectPath
					? localize('vectorCodeCodexProjectChanged', 'Loading Codex conversations for {0}...', projectState.activeProjectName ?? projectState.activeProjectPath)
					: this.getProjectRequiredDetail(projectState.activeProjectName),
			});
			if (this.connectionId) {
				void Promise.all([this.refreshThreads(), this.refreshPluginCount()]).catch(error => this.reportOperationError(error));
			}
		}));
	}

	getState(): IVectorCodeCodexState {
		return this.state;
	}

	getDiagnosticSummary(): IVectorCodeRuntimeDiagnosticSummary {
		return this.runtime.getDiagnosticSummary([
			localize('vectorCodeCodexDiagnosticRefresh', 'Use Refresh to retry the native Codex helper.'),
			localize('vectorCodeCodexDiagnosticTerminal', 'Open Full Terminal to install, sign in, or inspect Codex directly.'),
		]);
	}

	async ensureReady(): Promise<void> {
		if (this.connectionId && this.state.connectionState === VectorCodeCodexConnectionState.Ready) {
			return;
		}
		if (this.startPromise) {
			return this.startPromise;
		}
		this.restartScheduler.cancel();
		this.restartPolicy.reset();
		return this.beginStartAttempt();
	}

	async refreshThreads(): Promise<void> {
		const cancellationToken = this.projectCancellation.token;
		await this.ensureReady();
		const connectionId = this.requireConnection();
		const cwd = this.getActiveProjectPath();
		if (!cwd) {
			this.setState({
				threads: [],
				activeThreadId: undefined,
				messages: [],
				turnInProgress: false,
				detail: this.getProjectRequiredDetail(this.state.activeProjectName),
			});
			return;
		}
		const epoch = this.projectEpoch;
		const response = await this.request(connectionId, 'thread/list', {
			limit: 100,
			sortKey: 'updated_at',
			sortDirection: 'desc',
			archived: false,
			cwd,
		}, cancellationToken);
		if (epoch !== this.projectEpoch) {
			return;
		}
		const threads = getRecordArray(response, 'data').map(normalizeThread).filter((thread): thread is IVectorCodeCodexThread => Boolean(thread));
		this.setState({
			threads,
			detail: this.state.requiresAuthentication
				? this.getAuthenticationRequiredDetail()
				: threads.length
					? localize('vectorCodeCodexThreadsReady', '{0} Codex conversation(s) for this project.', threads.length)
					: localize('vectorCodeCodexNoThreads', 'Start a Codex conversation for this project.'),
		});
	}

	async createThread(): Promise<void> {
		const cwd = this.requireActiveProjectPath();
		await this.ensureReady();
		const response = await this.request(this.requireConnection(), 'thread/start', {
			cwd,
			approvalPolicy: 'on-request',
			sandbox: 'workspace-write',
			model: this.state.selectedModel,
			experimentalRawEvents: false,
		});
		const thread = getRecord(response, 'thread');
		const threadId = stringField(thread, 'id');
		if (!threadId) {
			throw new Error(localize('vectorCodeCodexInvalidThreadStart', 'Codex did not return a conversation identifier.'));
		}
		this.activeTurnId = undefined;
		this.writableThreadIds.add(threadId);
		this.setState({
			activeThreadId: threadId,
			messages: [],
			turnInProgress: false,
			detail: localize('vectorCodeCodexNewThread', 'New Codex conversation ready.'),
		});
		await this.refreshThreads();
	}

	async selectThread(threadId: string): Promise<void> {
		this.requireActiveProjectPath();
		await this.ensureReady();
		if (!threadId) {
			return;
		}
		const response = await this.request(this.requireConnection(), 'thread/read', {
			threadId,
			includeTurns: true,
		});
		const thread = asThreadData(getRecord(response, 'thread'));
		if (!thread || thread.id !== threadId) {
			throw new Error(localize('vectorCodeCodexInvalidThreadRead', 'Codex could not load that conversation.'));
		}
		const activeTurn = [...(thread.turns ?? [])].reverse().find(turn => turn.status === 'inProgress');
		const writable = this.writableThreadIds.has(thread.id);
		this.activeTurnId = writable ? activeTurn?.id : undefined;
		this.setState({
			activeThreadId: thread.id,
			messages: messagesFromTurns(thread.turns ?? []),
			turnInProgress: writable && Boolean(activeTurn),
			detail: activeTurn && !writable
				? localize('vectorCodeCodexThreadActiveElsewhere', 'This conversation is active in another Codex client. Its saved history is available here.')
				: localize('vectorCodeCodexThreadLoaded', 'Codex conversation loaded.'),
		});
	}

	async sendMessage(text: string): Promise<void> {
		const prompt = text.trim();
		if (!prompt) {
			return;
		}
		const cwd = this.requireActiveProjectPath();
		await this.ensureReady();
		if (this.state.requiresAuthentication) {
			throw new Error(this.getAuthenticationRequiredDetail());
		}
		if (!this.state.activeThreadId) {
			await this.createThread();
		}
		const threadId = this.state.activeThreadId;
		if (!threadId) {
			throw new Error(localize('vectorCodeCodexThreadRequired', 'Start or select a Codex conversation first.'));
		}
		if (!this.writableThreadIds.has(threadId)) {
			const resumeResponse = await this.request(this.requireConnection(), 'thread/resume', {
				threadId,
				cwd,
				approvalPolicy: 'on-request',
				sandbox: 'workspace-write',
			});
			const resumedThread = asThreadData(getRecord(resumeResponse, 'thread'));
			if (!resumedThread) {
				throw new Error(localize('vectorCodeCodexResumeFailed', 'Codex could not resume that conversation.'));
			}
			this.writableThreadIds.add(threadId);
			this.setState({ messages: messagesFromTurns(resumedThread.turns ?? []) });
		}

		const localMessage: IVectorCodeCodexMessage = {
			id: `local-user-${generateUuid()}`,
			role: 'user',
			title: localize('vectorCodeCodexYou', 'You'),
			text: prompt,
		};
		this.setState({
			messages: [...this.state.messages, localMessage],
			turnInProgress: true,
			detail: localize('vectorCodeCodexWorking', 'Codex is working...'),
		});

		try {
			const response = await this.request(this.requireConnection(), 'turn/start', {
				threadId,
				input: [{ type: 'text', text: prompt, text_elements: [] }],
				cwd,
				approvalPolicy: 'on-request',
				model: this.state.selectedModel,
				effort: this.state.selectedReasoningEffort,
			});
			const turn = asTurnData(getRecord(response, 'turn'));
			if (turn) {
				this.activeTurnId = turn.id;
				this.mergeTurn(turn, true);
			}
		} catch (error) {
			this.setState({ turnInProgress: false });
			throw error;
		}
	}

	async interruptTurn(): Promise<void> {
		if (!this.state.activeThreadId || !this.activeTurnId || !this.connectionId) {
			return;
		}
		await this.request(this.connectionId, 'turn/interrupt', {
			threadId: this.state.activeThreadId,
			turnId: this.activeTurnId,
		});
		this.setState({ detail: localize('vectorCodeCodexInterrupting', 'Stopping the current Codex turn...') });
	}

	async forkActiveThread(): Promise<void> {
		if (!this.state.activeThreadId) {
			return;
		}
		const cwd = this.requireActiveProjectPath();
		await this.ensureReady();
		const response = await this.request(this.requireConnection(), 'thread/fork', {
			threadId: this.state.activeThreadId,
			cwd,
			approvalPolicy: 'on-request',
			sandbox: 'workspace-write',
			model: this.state.selectedModel,
		});
		const thread = asThreadData(getRecord(response, 'thread'));
		if (!thread) {
			throw new Error(localize('vectorCodeCodexForkFailed', 'Codex did not return the forked conversation.'));
		}
		this.activeTurnId = undefined;
		this.writableThreadIds.add(thread.id);
		this.setState({
			activeThreadId: thread.id,
			messages: messagesFromTurns(thread.turns ?? []),
			turnInProgress: false,
			detail: localize('vectorCodeCodexForked', 'Conversation forked.'),
		});
		await this.refreshThreads();
	}

	async archiveActiveThread(): Promise<void> {
		const threadId = this.state.activeThreadId;
		if (!threadId) {
			return;
		}
		const confirmation = await this.dialogService.confirm({
			type: Severity.Warning,
			message: localize('vectorCodeCodexArchiveConfirm', 'Archive this Codex conversation?'),
			detail: localize('vectorCodeCodexArchiveDetail', 'It will be removed from this project\'s active conversation list.'),
			primaryButton: localize('vectorCodeCodexArchive', 'Archive'),
		});
		if (!confirmation.confirmed) {
			return;
		}
		await this.ensureReady();
		await this.request(this.requireConnection(), 'thread/archive', { threadId });
		this.writableThreadIds.delete(threadId);
		this.activeTurnId = undefined;
		this.setState({ activeThreadId: undefined, messages: [], turnInProgress: false });
		await this.refreshThreads();
	}

	async managePlugins(): Promise<void> {
		await this.ensureReady();
		const connectionId = this.requireConnection();
		const cwd = this.getActiveProjectPath();
		const installedResponse = await this.request(connectionId, 'plugin/installed', {
			cwds: cwd ? [cwd] : [],
		});
		const installedPlugins = normalizeMarketplacePlugins(installedResponse).filter(plugin => plugin.installed);
		const installedItems = installedPlugins
			.sort((left, right) => left.displayName.localeCompare(right.displayName))
			.map(pluginPickItem);
		const selected = await this.quickInputService.pick<IVectorCodeCodexPluginPickItem>([
			{
				label: `$(search) ${localize('vectorCodeCodexFindPlugins', 'Find Codex plugins...')}`,
				description: localize('vectorCodeCodexFindPluginsDescription', 'Search available marketplaces'),
				browse: true,
			},
			...installedItems,
		], {
			title: localize('vectorCodeCodexPlugins', 'Codex Plugins'),
			placeHolder: installedPlugins.length
				? localize('vectorCodeCodexInstalledPlugins', '{0} installed plugin(s)', installedPlugins.length)
				: localize('vectorCodeCodexNoInstalledPlugins', 'No plugins are installed yet'),
			ignoreFocusLost: true,
		});
		if (!selected) {
			return;
		}
		if (selected.plugin) {
			await this.managePlugin(selected.plugin);
			return;
		}
		if (!selected.browse) {
			return;
		}

		const searchTerm = await this.quickInputService.input({
			title: localize('vectorCodeCodexFindPlugins', 'Find Codex plugins...'),
			prompt: localize('vectorCodeCodexPluginSearchPrompt', 'Search the Codex plugin marketplace'),
			placeHolder: localize('vectorCodeCodexPluginSearchPlaceholder', 'Plugin name or capability'),
			ignoreFocusLost: true,
		});
		if (!searchTerm?.trim()) {
			return;
		}
		const searchResponse = await this.request(connectionId, 'plugin/search', {
			searchTerm: searchTerm.trim(),
			cwds: cwd ? [cwd] : [],
			limit: 100,
		});
		const matches = normalizePluginSearchResults(searchResponse);
		if (!matches.length) {
			this.notificationService.info(localize('vectorCodeCodexNoPluginMatches', 'No Codex plugins matched "{0}".', searchTerm.trim()));
			return;
		}
		const match = await this.quickInputService.pick<IVectorCodeCodexPluginPickItem>(matches.map(pluginPickItem), {
			title: localize('vectorCodeCodexPluginSearchResults', 'Codex Plugin Results'),
			placeHolder: localize('vectorCodeCodexChoosePlugin', 'Choose a plugin to inspect or install'),
			ignoreFocusLost: true,
		});
		if (match?.plugin) {
			await this.managePlugin(match.plugin);
		}
	}

	selectModel(model: string, reasoningEffort?: string): void {
		const selected = this.state.models.find(candidate => candidate.id === model);
		if (!selected) {
			return;
		}
		const effort = reasoningEffort && selected.reasoningEfforts.includes(reasoningEffort)
			? reasoningEffort
			: selected.defaultReasoningEffort ?? selected.reasoningEfforts[0];
		this.setState({ selectedModel: selected.id, selectedReasoningEffort: effort });
	}

	override dispose(): void {
		this.isDisposed = true;
		this.restartScheduler.cancel();
		this.projectCancellation.dispose(true);
		this.activeStartupCorrelationId = undefined;
		this.writableThreadIds.clear();
		const connectionId = this.connectionId;
		this.connectionId = undefined;
		this.runtime.transition(VectorCodeRuntimeState.Stopped, { correlationId: connectionId });
		if (connectionId) {
			void this.bridgeService.stop(connectionId);
		}
		super.dispose();
	}

	private async managePlugin(plugin: IVectorCodeCodexPluginData): Promise<void> {
		const connectionId = this.requireConnection();
		const detail = pluginDetail(plugin);
		if (plugin.installed) {
			if (plugin.installPolicy === 'INSTALLED_BY_DEFAULT') {
				await this.dialogService.info(
					localize('vectorCodeCodexDefaultPlugin', '{0} is installed by default.', plugin.displayName),
					detail,
				);
				return;
			}
			const confirmation = await this.dialogService.confirm({
				type: Severity.Warning,
				message: localize('vectorCodeCodexUninstallPluginConfirm', 'Uninstall the Codex plugin "{0}"?', plugin.displayName),
				detail,
				primaryButton: localize('vectorCodeCodexUninstallPlugin', 'Uninstall'),
			});
			if (!confirmation.confirmed) {
				return;
			}
			await this.request(connectionId, 'plugin/uninstall', { pluginId: plugin.id });
			await this.refreshPluginCount();
			this.setState({ detail: localize('vectorCodeCodexPluginUninstalled', 'Uninstalled Codex plugin "{0}".', plugin.displayName) });
			return;
		}

		if (plugin.availability === 'DISABLED_BY_ADMIN' || plugin.installPolicy === 'NOT_AVAILABLE') {
			await this.dialogService.info(
				localize('vectorCodeCodexPluginUnavailable', '{0} is not available for this account or workspace.', plugin.displayName),
				detail,
			);
			return;
		}
		const confirmation = await this.dialogService.confirm({
			type: Severity.Info,
			message: localize('vectorCodeCodexInstallPluginConfirm', 'Install the Codex plugin "{0}"?', plugin.displayName),
			detail,
			primaryButton: localize('vectorCodeCodexInstallPlugin', 'Install'),
		});
		if (!confirmation.confirmed) {
			return;
		}
		const response = await this.request(connectionId, 'plugin/install', {
			pluginName: plugin.name,
			...(plugin.marketplacePath
				? { marketplacePath: plugin.marketplacePath }
				: { remoteMarketplaceName: plugin.marketplaceName }),
		});
		await this.refreshPluginCount();
		const appsNeedingAuth = getRecordArray(response, 'appsNeedingAuth');
		this.setState({ detail: localize('vectorCodeCodexPluginInstalled', 'Installed Codex plugin "{0}".', plugin.displayName) });
		if (appsNeedingAuth.length) {
			this.notificationService.info(localize(
				'vectorCodeCodexPluginAuthRequired',
				'Installed "{0}". {1} connected app(s) still need authentication; use the full Codex terminal to sign in.',
				plugin.displayName,
				appsNeedingAuth.length,
			));
		}
	}

	private async refreshPluginCount(): Promise<void> {
		const cancellationToken = this.projectCancellation.token;
		await this.ensureReady();
		const epoch = this.projectEpoch;
		const cwd = this.getActiveProjectPath();
		const response = await this.request(this.requireConnection(), 'plugin/installed', {
			cwds: cwd ? [cwd] : [],
		}, cancellationToken);
		if (epoch !== this.projectEpoch) {
			return;
		}
		this.setState({ installedPluginCount: countInstalledPlugins(response) });
	}

	private async refreshAccountState(): Promise<void> {
		await this.ensureReady();
		const response = await this.request(this.requireConnection(), 'account/read', {}, CancellationToken.None, CODEX_STARTUP_REQUEST_TIMEOUT_MS);
		const account = getRecord(response, 'account');
		const requiresAuthentication = (booleanField(asRecord(response), 'requiresOpenaiAuth') ?? false) && !account;
		const projectState = this.getActiveProjectState();
		const runtimeStatus = this.runtime.getStatus();
		this.setState({
			accountLabel: normalizeAccountLabel(account),
			requiresAuthentication,
			...(runtimeStatus.state === VectorCodeRuntimeState.Ready || runtimeStatus.state === VectorCodeRuntimeState.Degraded
				? { runtime: this.runtime.transition(runtimeStatus.state, { capabilities: codexReadyCapabilities(requiresAuthentication), event: 'account.capabilities.updated' }) }
				: {}),
			detail: requiresAuthentication
				? this.getAuthenticationRequiredDetail()
				: projectState.activeProjectPath
					? localize('vectorCodeCodexReady', 'Codex is ready for {0}.', projectState.activeProjectName ?? projectState.activeProjectPath)
					: this.getProjectRequiredDetail(projectState.activeProjectName),
		});
	}

	private beginStartAttempt(): Promise<void> {
		if (this.startPromise) {
			return this.startPromise;
		}
		const operation = this.runStartAttempt();
		this.startPromise = operation;
		return operation;
	}

	private async runStartAttempt(): Promise<void> {
		let failure: IVectorCodeRuntimeError | undefined;
		try {
			await this.start();
		} catch (error) {
			failure = this.createRuntimeError(
				error,
				VectorCodeRuntimeErrorCode.Unknown,
				true,
				this.activeStartupCorrelationId,
			);
			throw failure;
		} finally {
			this.startPromise = undefined;
			if (failure !== undefined && !this.isDisposed && this.state.connectionState !== VectorCodeCodexConnectionState.Ready) {
				if (failure.retryable) {
					this.scheduleRestart(failure);
				} else {
					this.setState({
						connectionState: VectorCodeCodexConnectionState.Error,
						runtime: this.runtime.transition(VectorCodeRuntimeState.Unavailable, { error: failure, correlationId: failure.correlationId }),
						detail: failure.userMessage,
						turnInProgress: false,
					});
				}
			}
		}
	}

	private scheduleRestart(error: IVectorCodeRuntimeError): void {
		if (this.isDisposed || this.restartScheduler.isScheduled()) {
			return;
		}
		const retry = this.restartPolicy.nextRetry();
		if (!retry) {
			this.setState({
				connectionState: VectorCodeCodexConnectionState.Error,
				runtime: this.runtime.transition(VectorCodeRuntimeState.Unavailable, {
					error,
					attempt: this.restartPolicy.maxAttempts,
					correlationId: error.correlationId,
				}),
				detail: localize(
					'vectorCodeCodexRestartExhausted',
					'{0} Automatic restart stopped after {1} attempts. Use Refresh to try again.',
					error.userMessage,
					this.restartPolicy.maxAttempts,
				),
				turnInProgress: false,
			});
			return;
		}
		this.setState({
			connectionState: VectorCodeCodexConnectionState.Retrying,
			runtime: this.runtime.transition(VectorCodeRuntimeState.Retrying, {
				error,
				attempt: retry.attempt,
				nextRetryAt: Date.now() + retry.delayMs,
				correlationId: error.correlationId,
			}),
			detail: localize(
				'vectorCodeCodexRetrying',
				'Codex stopped unexpectedly. Retrying in {0} seconds ({1}/{2}). {3}',
				String(retry.delayMs / 1_000),
				retry.attempt,
				retry.maxAttempts,
				error.userMessage,
			),
			turnInProgress: false,
		});
		this.restartScheduler.schedule(retry.delayMs);
	}

	private async restartAfterFailure(): Promise<void> {
		if (this.isDisposed || this.startPromise || this.state.connectionState === VectorCodeCodexConnectionState.Ready) {
			return;
		}
		try {
			await this.beginStartAttempt();
		} catch (error) {
			if (!isCancellationError(error)) {
				const runtimeError = this.createRuntimeError(error, VectorCodeRuntimeErrorCode.Unknown, true);
				this.logService.warn(`[VectorCode][Codex][${runtimeError.correlationId}] automatic restart failed (${runtimeError.code}).`);
			}
		}
	}

	private async start(): Promise<void> {
		const correlationId = this.runtime.createCorrelationId('startup');
		this.activeStartupCorrelationId = correlationId;
		this.setState({
			connectionState: VectorCodeCodexConnectionState.Starting,
			runtime: this.runtime.transition(VectorCodeRuntimeState.Starting, { correlationId, event: 'startup.waiting' }),
			detail: localize('vectorCodeCodexStarting', 'Starting Codex...'),
		});
		try {
			const startOperation = this.bridgeService.start({ cwd: this.getActiveProjectPath() });
			const connectionId = await runVectorCodeRuntimeWithTimeout(
				startOperation,
				CODEX_STARTUP_TIMEOUT_MS,
				new VectorCodeRuntimeError(
					VectorCodeRuntimeErrorCode.StartupTimeout,
					localize('vectorCodeCodexStartupTimeout', 'Codex took too long to start. Use Refresh to retry.'),
					`Codex helper startup exceeded ${CODEX_STARTUP_TIMEOUT_MS} ms.`,
					true,
					correlationId,
				),
				lateConnectionId => this.bridgeService.stop(lateConnectionId),
			);
			if (this.isDisposed) {
				await this.bridgeService.stop(connectionId).catch(() => undefined);
				throw new CancellationError();
			}
			this.connectionId = connectionId;
			await this.request(connectionId, 'initialize', {
				clientInfo: {
					name: 'vector-code',
					title: this.productService.nameLong,
					version: this.productService.version,
				},
				capabilities: { experimentalApi: true },
			}, CancellationToken.None, CODEX_STARTUP_REQUEST_TIMEOUT_MS);
			await this.bridgeService.notify(connectionId, 'initialized');

			const projectPath = this.getActiveProjectPath();
			const [accountResult, modelResult, installedPluginResult] = await Promise.all([
				this.request(connectionId, 'account/read', {}, CancellationToken.None, CODEX_STARTUP_REQUEST_TIMEOUT_MS),
				this.request(connectionId, 'model/list', { limit: 100, includeHidden: false }, CancellationToken.None, CODEX_STARTUP_REQUEST_TIMEOUT_MS).catch(() => undefined),
				this.request(connectionId, 'plugin/installed', {
					cwds: projectPath ? [projectPath] : [],
				}, CancellationToken.None, CODEX_STARTUP_REQUEST_TIMEOUT_MS).catch(() => undefined),
			]);
			const account = getRecord(accountResult, 'account');
			const requiresOpenaiAuth = booleanField(asRecord(accountResult), 'requiresOpenaiAuth');
			const requiresAuthentication = (requiresOpenaiAuth ?? false) && !account;
			const models = normalizeModels(modelResult);
			const projectState = this.getActiveProjectState();
			const selectedModel = models.find(model => model.id === this.state.selectedModel)
				?? models.find(model => isDefaultModel(modelResult, model.id))
				?? models[0];
			this.restartPolicy.markReady();
			this.setState({
				...projectState,
				connectionState: VectorCodeCodexConnectionState.Ready,
				runtime: this.runtime.transition(VectorCodeRuntimeState.Ready, { capabilities: codexReadyCapabilities(requiresAuthentication), correlationId, event: 'startup.ready' }),
				detail: requiresAuthentication
					? this.getAuthenticationRequiredDetail()
					: projectState.activeProjectPath
						? localize('vectorCodeCodexReady', 'Codex is ready for {0}.', projectState.activeProjectName ?? projectState.activeProjectPath)
						: this.getProjectRequiredDetail(projectState.activeProjectName),
				accountLabel: normalizeAccountLabel(account),
				requiresAuthentication,
				models,
				selectedModel: selectedModel?.id,
				selectedReasoningEffort: selectedModel?.defaultReasoningEffort ?? selectedModel?.reasoningEfforts[0],
				installedPluginCount: projectPath === projectState.activeProjectPath ? countInstalledPlugins(installedPluginResult) : 0,
			});
			await Promise.all([
				this.refreshThreads().catch(error => {
					if (!isCancellationError(error)) {
						const runtimeError = this.createRuntimeError(error, VectorCodeRuntimeErrorCode.Unknown, true);
						this.logService.warn(`[VectorCode][Codex][${runtimeError.correlationId}] conversation refresh failed after startup (${runtimeError.code}).`);
					}
				}),
				this.refreshPluginCount().catch(error => {
					if (!isCancellationError(error)) {
						const runtimeError = this.createRuntimeError(error, VectorCodeRuntimeErrorCode.Unknown, true);
						this.logService.warn(`[VectorCode][Codex][${runtimeError.correlationId}] plugin refresh failed after startup (${runtimeError.code}).`);
					}
				}),
			]);
		} catch (error) {
			const runtimeError = this.createRuntimeError(error, VectorCodeRuntimeErrorCode.Unknown, true, correlationId);
			this.runtime.record('startup.failed', correlationId, runtimeError);
			const connectionId = this.connectionId;
			this.connectionId = undefined;
			if (connectionId) {
				await this.bridgeService.stop(connectionId).catch(() => undefined);
			}
			throw runtimeError;
		} finally {
			if (this.activeStartupCorrelationId === correlationId) {
				this.activeStartupCorrelationId = undefined;
			}
		}
	}

	private async request<TResult = unknown>(
		connectionId: string,
		method: string,
		params?: unknown,
		cancellationToken = CancellationToken.None,
		timeoutMs?: number,
	): Promise<TResult> {
		if (cancellationToken.isCancellationRequested) {
			throw new CancellationError();
		}
		const requestId = `vector-code-${generateUuid()}`;
		const startedAt = Date.now();
		this.runtime.record(`request.${method}.started`, requestId);
		this.logService.debug(`[VectorCode][Codex][${requestId}] request started (${method}).`);
		const cancellationListener = cancellationToken.onCancellationRequested(() => {
			void this.bridgeService.cancelRequest(connectionId, requestId).catch(error => {
				const runtimeError = this.createRuntimeError(error, VectorCodeRuntimeErrorCode.Unknown, true, requestId);
				this.logService.debug(`[VectorCode][Codex][${requestId}] request cancellation failed (${runtimeError.code}).`);
			});
		});
		try {
			const result = await this.bridgeService.request<TResult>(connectionId, { id: requestId, method, params, timeoutMs });
			this.runtime.record(`request.${method}.completed`, requestId);
			this.logService.debug(`[VectorCode][Codex][${requestId}] request completed (${method}, ${Date.now() - startedAt} ms).`);
			if (this.runtime.getStatus().state === VectorCodeRuntimeState.Degraded) {
				this.setState({ runtime: this.runtime.transition(VectorCodeRuntimeState.Ready, { capabilities: codexReadyCapabilities(this.state.requiresAuthentication), correlationId: requestId, event: 'request.recovered' }) });
			}
			return result;
		} catch (error) {
			if (isCancellationError(error)) {
				this.runtime.record(`request.${method}.cancelled`, requestId);
				throw error;
			}
			const runtimeError = this.createRuntimeError(error, VectorCodeRuntimeErrorCode.Unknown, true, requestId);
			this.runtime.record(`request.${method}.failed`, requestId, runtimeError);
			this.logService.warn(`[VectorCode][Codex][${requestId}] request failed (${method}, ${runtimeError.code}, ${Date.now() - startedAt} ms).`);
			throw runtimeError;
		} finally {
			cancellationListener.dispose();
		}
	}

	private handleNotification(event: IVectorCodeCodexBridgeNotification): void {
		if (event.connectionId !== this.connectionId) {
			return;
		}
		const params = asRecord(event.params);
		const threadId = stringField(params, 'threadId');
		if (threadId && threadId !== this.state.activeThreadId) {
			if (event.method === 'thread/started' || event.method === 'thread/archived' || event.method === 'thread/name/updated') {
				void this.refreshThreads().catch(error => this.reportOperationError(error));
			}
			return;
		}

		switch (event.method) {
			case 'account/updated':
			case 'account/login/completed':
				void this.refreshAccountState().catch(error => this.reportOperationError(error));
				break;
			case 'turn/started': {
				const turn = asTurnData(getRecord(params, 'turn'));
				if (turn) {
					this.activeTurnId = turn.id;
					this.mergeTurn(turn, true);
				}
				break;
			}
			case 'item/started':
			case 'item/completed': {
				const message = messageFromItem(params?.item);
				if (message) {
					this.upsertMessage(message);
				}
				break;
			}
			case 'item/agentMessage/delta':
				this.appendMessageDelta(params, 'assistant', localize('vectorCodeCodexAssistant', 'Codex'));
				break;
			case 'item/plan/delta':
				this.appendMessageDelta(params, 'reasoning', localize('vectorCodeCodexPlan', 'Plan'));
				break;
			case 'item/reasoning/summaryTextDelta':
			case 'item/reasoning/textDelta':
				this.appendMessageDelta(params, 'reasoning', localize('vectorCodeCodexReasoning', 'Reasoning'));
				break;
			case 'item/commandExecution/outputDelta':
				this.appendMessageDelta(params, 'activity', localize('vectorCodeCodexCommand', 'Command'));
				break;
			case 'item/fileChange/outputDelta':
				this.appendMessageDelta(params, 'activity', localize('vectorCodeCodexFileChange', 'File changes'));
				break;
			case 'turn/completed': {
				const turn = asTurnData(getRecord(params, 'turn'));
				if (turn) {
					this.mergeTurn(turn, false);
				}
				this.activeTurnId = undefined;
				this.setState({
					turnInProgress: false,
					detail: turn?.status === 'failed'
						? localize('vectorCodeCodexTurnFailed', 'The Codex turn failed. Review the error below.')
						: localize('vectorCodeCodexTurnComplete', 'Codex finished.'),
				});
				void this.refreshThreads().catch(error => this.reportOperationError(error));
				break;
			}
			case 'error': {
				const error = getRecord(params, 'error');
				this.upsertMessage({
					id: `error-${this.activeTurnId ?? generateUuid()}`,
					role: 'error',
					title: localize('vectorCodeCodexError', 'Error'),
					text: stringField(error, 'message') ?? JSON.stringify(error ?? event.params),
				});
				break;
			}
			case 'warning':
			case 'guardianWarning':
			case 'configWarning': {
				const message = stringField(params, 'message');
				if (message) {
					this.upsertMessage({ id: `warning-${generateUuid()}`, role: 'activity', title: localize('vectorCodeCodexWarning', 'Warning'), text: message });
				}
				break;
			}
			case 'thread/started':
			case 'thread/archived':
			case 'thread/name/updated':
				void this.refreshThreads().catch(error => this.reportOperationError(error));
				break;
			default:
				this.logService.debug(`Codex App Server notification not handled by the workbench: ${event.method}`);
		}
	}

	private async handleServerRequest(event: IVectorCodeCodexBridgeServerRequest): Promise<void> {
		if (event.connectionId !== this.connectionId) {
			return;
		}
		try {
			switch (event.method) {
				case 'item/commandExecution/requestApproval':
					await this.bridgeService.respond(event.connectionId, event.id, await this.promptCommandApproval(event.params, false));
					return;
				case 'item/fileChange/requestApproval':
					await this.bridgeService.respond(event.connectionId, event.id, await this.promptFileApproval(event.params, false));
					return;
				case 'execCommandApproval':
					await this.bridgeService.respond(event.connectionId, event.id, await this.promptCommandApproval(event.params, true));
					return;
				case 'applyPatchApproval':
					await this.bridgeService.respond(event.connectionId, event.id, await this.promptFileApproval(event.params, true));
					return;
				case 'item/tool/requestUserInput':
					await this.bridgeService.respond(event.connectionId, event.id, await this.promptForToolInput(event.params));
					return;
				case 'item/permissions/requestApproval':
					await this.bridgeService.respond(event.connectionId, event.id, await this.promptPermissionApproval(event.params));
					return;
				case 'mcpServer/elicitation/request':
					await this.bridgeService.respond(event.connectionId, event.id, await this.promptMcpElicitation(event.params));
					return;
				case 'currentTime/read':
					await this.bridgeService.respond(event.connectionId, event.id, { currentTimeAt: Math.floor(Date.now() / 1_000) });
					return;
				default:
					await this.bridgeService.respondError(event.connectionId, event.id, `Vector Code does not provide the optional App Server callback "${event.method}".`);
			}
		} catch (error) {
			this.notificationService.error(errorMessage(error));
			await this.bridgeService.respondError(event.connectionId, event.id, errorMessage(error)).catch(() => undefined);
		}
	}

	private async promptCommandApproval(value: unknown, legacy: boolean): Promise<unknown> {
		const params = asRecord(value);
		const command = stringField(params, 'command') ?? stringField(params, 'cmd') ?? localize('vectorCodeCodexUnknownCommand', 'Unknown command');
		const cwd = stringField(params, 'cwd');
		const reason = stringField(params, 'reason');
		const availableDecisions = Array.isArray(params?.availableDecisions) ? params.availableDecisions : [];
		const canAcceptForSession = legacy || availableDecisions.length === 0 || availableDecisions.includes('acceptForSession');
		const result = await this.dialogService.prompt<'accept' | 'session' | 'decline' | 'cancel'>({
			type: Severity.Warning,
			message: localize('vectorCodeCodexApproveCommand', 'Allow Codex to run this command?'),
			detail: [command, cwd ? localize('vectorCodeCodexCommandCwd', 'Working directory: {0}', cwd) : undefined, reason].filter(Boolean).join('\n\n'),
			buttons: [
				{ label: localize('vectorCodeCodexAllowOnce', 'Allow Once'), run: () => 'accept' },
				...(canAcceptForSession ? [{ label: localize('vectorCodeCodexAllowSession', 'Allow for Session'), run: () => 'session' as const }] : []),
				{ label: localize('vectorCodeCodexDeny', 'Deny'), run: () => 'decline' },
			],
			cancelButton: { run: () => 'cancel' },
		});
		const decision = result.result ?? 'cancel';
		if (legacy) {
			return { decision: decision === 'accept' ? 'approved' : decision === 'session' ? 'approved_for_session' : decision === 'decline' ? { denied: { rejection: 'Denied by user.' } } : 'abort' };
		}
		return { decision: decision === 'session' ? 'acceptForSession' : decision };
	}

	private async promptFileApproval(value: unknown, legacy: boolean): Promise<unknown> {
		const params = asRecord(value);
		const reason = stringField(params, 'reason') ?? stringField(params, 'grantRoot') ?? localize('vectorCodeCodexFileApprovalDetail', 'Codex requested permission to change files outside its current write scope.');
		const result = await this.dialogService.prompt<'accept' | 'session' | 'decline' | 'cancel'>({
			type: Severity.Warning,
			message: localize('vectorCodeCodexApproveFiles', 'Allow Codex to make these file changes?'),
			detail: reason,
			buttons: [
				{ label: localize('vectorCodeCodexAllowOnce', 'Allow Once'), run: () => 'accept' },
				{ label: localize('vectorCodeCodexAllowSession', 'Allow for Session'), run: () => 'session' },
				{ label: localize('vectorCodeCodexDeny', 'Deny'), run: () => 'decline' },
			],
			cancelButton: { run: () => 'cancel' },
		});
		const decision = result.result ?? 'cancel';
		if (legacy) {
			return { decision: decision === 'accept' ? 'approved' : decision === 'session' ? 'approved_for_session' : decision === 'decline' ? { denied: { rejection: 'Denied by user.' } } : 'abort' };
		}
		return { decision: decision === 'session' ? 'acceptForSession' : decision };
	}

	private async promptForToolInput(value: unknown): Promise<unknown> {
		const params = asRecord(value);
		const questions = Array.isArray(params?.questions) ? params.questions : [];
		const answers: Record<string, { answers: string[] }> = {};
		for (const questionValue of questions) {
			const question = asRecord(questionValue);
			const id = stringField(question, 'id');
			const label = stringField(question, 'question');
			if (!id || !label) {
				continue;
			}
			const optionValues = Array.isArray(question?.options) ? question.options : [];
			let answer: string | undefined;
			if (optionValues.length) {
				const options = optionValues.map(optionValue => {
					const option = asRecord(optionValue);
					return {
						label: stringField(option, 'label') ?? '',
						description: stringField(option, 'description'),
					};
				}).filter(option => option.label);
				answer = (await this.quickInputService.pick(options, {
					title: stringField(question, 'header') ?? localize('vectorCodeCodexQuestion', 'Codex question'),
					placeHolder: label,
					ignoreFocusLost: true,
				}))?.label;
			} else {
				answer = await this.quickInputService.input({
					title: stringField(question, 'header') ?? localize('vectorCodeCodexQuestion', 'Codex question'),
					prompt: label,
					password: booleanField(question, 'isSecret') ?? false,
					ignoreFocusLost: true,
				});
			}
			if (answer !== undefined) {
				answers[id] = { answers: [answer] };
			}
		}
		return { answers };
	}

	private async promptPermissionApproval(value: unknown): Promise<unknown> {
		const params = asRecord(value);
		const permissions = asRecord(params?.permissions);
		const result = await this.dialogService.prompt<'turn' | 'session' | 'decline'>({
			type: Severity.Warning,
			message: localize('vectorCodeCodexPermissionRequest', 'Codex is requesting additional permissions.'),
			detail: stringField(params, 'reason') ?? JSON.stringify(permissions, undefined, 2),
			buttons: [
				{ label: localize('vectorCodeCodexAllowTurn', 'Allow for Turn'), run: () => 'turn' },
				{ label: localize('vectorCodeCodexAllowSession', 'Allow for Session'), run: () => 'session' },
			],
			cancelButton: { label: localize('vectorCodeCodexDeny', 'Deny'), run: () => 'decline' },
		});
		if (!result.result || result.result === 'decline') {
			return { permissions: {}, scope: 'turn' };
		}
		return {
			permissions: {
				...(permissions?.network ? { network: permissions.network } : {}),
				...(permissions?.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
			},
			scope: result.result,
		};
	}

	private async promptMcpElicitation(value: unknown): Promise<unknown> {
		const params = asRecord(value);
		const message = stringField(params, 'message') ?? localize('vectorCodeCodexMcpRequest', 'An MCP server requested input.');
		const mode = stringField(params, 'mode');
		if (mode === 'url') {
			const url = stringField(params, 'url');
			const confirmation = await this.dialogService.confirm({
				type: Severity.Info,
				message,
				detail: url,
				primaryButton: localize('vectorCodeCodexOpen', 'Open'),
			});
			if (confirmation.confirmed && url) {
				await this.openerService.open(url, { openExternal: true });
				return { action: 'accept', content: null, _meta: null };
			}
			return { action: 'decline', content: null, _meta: null };
		}
		const raw = await this.quickInputService.input({
			title: localize('vectorCodeCodexMcpInput', 'MCP input'),
			prompt: message,
			placeHolder: localize('vectorCodeCodexMcpInputPlaceholder', 'Enter a value or JSON object'),
			ignoreFocusLost: true,
		});
		if (raw === undefined) {
			return { action: 'cancel', content: null, _meta: null };
		}
		let content: unknown = raw;
		try {
			content = JSON.parse(raw);
		} catch {
			// Plain text is a valid answer for primitive MCP elicitations.
		}
		return { action: 'accept', content, _meta: null };
	}

	private mergeTurn(turn: IVectorCodeCodexTurnData, inProgress: boolean): void {
		for (const item of turn.items ?? []) {
			const message = messageFromItem(item);
			if (message) {
				this.upsertMessage(message);
			}
		}
		if (turn.error) {
			this.upsertMessage({
				id: `turn-error-${turn.id}`,
				role: 'error',
				title: localize('vectorCodeCodexError', 'Error'),
				text: errorMessage(turn.error),
			});
		}
		this.setState({ turnInProgress: inProgress });
	}

	private appendMessageDelta(params: Record<string, unknown> | undefined, role: IVectorCodeCodexMessage['role'], title: string): void {
		const id = stringField(params, 'itemId');
		const delta = stringField(params, 'delta', false);
		if (!id || delta === undefined) {
			return;
		}
		const existing = this.state.messages.find(message => message.id === id);
		this.upsertMessage({
			id,
			role,
			title,
			text: `${existing?.text ?? ''}${delta}`,
			status: existing?.status,
		});
	}

	private upsertMessage(message: IVectorCodeCodexMessage): void {
		const localUserIndex = message.role === 'user'
			? this.state.messages.findIndex(candidate => candidate.id.startsWith('local-user-') && candidate.text === message.text)
			: -1;
		const existingIndex = this.state.messages.findIndex(candidate => candidate.id === message.id);
		const index = existingIndex >= 0 ? existingIndex : localUserIndex;
		if (index < 0) {
			this.setState({ messages: [...this.state.messages, message] });
			return;
		}
		const messages = [...this.state.messages];
		messages[index] = message;
		this.setState({ messages });
	}

	private setState(patch: IVectorCodeCodexStatePatch): void {
		this.state = { ...this.state, ...patch };
		this._onDidChangeState.fire(this.state);
	}

	private requireConnection(): string {
		if (!this.connectionId) {
			throw new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.InvalidState,
				localize('vectorCodeCodexNotRunning', 'Codex is not running.'),
				'No active Codex helper connection is available.',
				true,
			);
		}
		return this.connectionId;
	}

	private getActiveProjectPath(): string | undefined {
		const project = this.vectorCodeWorkbenchService.getActiveProjectUri();
		return project?.scheme === 'file' ? project.fsPath : undefined;
	}

	private getActiveProjectState(): Pick<IVectorCodeCodexState, 'activeProjectName' | 'activeProjectPath'> {
		const activeProjectUri = this.vectorCodeWorkbenchService.getActiveProjectUri();
		const activeProject = activeProjectUri
			? this.vectorCodeWorkbenchService.getProjectSummaries().find(project => project.uri.toString() === activeProjectUri.toString())
			: undefined;
		return {
			activeProjectName: activeProject?.name,
			activeProjectPath: activeProjectUri?.scheme === 'file' ? activeProjectUri.fsPath : undefined,
		};
	}

	private requireActiveProjectPath(): string {
		const projectPath = this.getActiveProjectPath();
		if (!projectPath) {
			throw new Error(this.getProjectRequiredDetail(this.state.activeProjectName));
		}
		return projectPath;
	}

	private getProjectRequiredDetail(projectName?: string): string {
		return projectName
			? localize('vectorCodeCodexLocalProjectRequired', 'Codex requires a local project. Reopen {0} from this computer to continue.', projectName)
			: localize('vectorCodeCodexProjectRequired', 'Open a local project to start a Codex conversation.');
	}

	private getAuthenticationRequiredDetail(): string {
		return localize('vectorCodeCodexSignInRequired', 'Sign in to Codex from the full terminal experience to send messages.');
	}

	private reportOperationError(error: unknown): void {
		if (isCancellationError(error)) {
			return;
		}
		const runtimeError = this.createRuntimeError(error, VectorCodeRuntimeErrorCode.Unknown, true);
		const runtimeState = this.connectionId ? VectorCodeRuntimeState.Degraded : VectorCodeRuntimeState.Unavailable;
		this.setState({
			runtime: this.runtime.transition(runtimeState, {
				capabilities: this.connectionId ? this.runtime.getStatus().capabilities : [],
				error: runtimeError,
				correlationId: runtimeError.correlationId,
				event: 'operation.failed',
			}),
			detail: runtimeError.userMessage,
		});
		this.notificationService.error(runtimeError.userMessage);
	}

	private createRuntimeError(error: unknown, fallbackCode: VectorCodeRuntimeErrorCode, fallbackRetryable: boolean, correlationId?: string): VectorCodeRuntimeError {
		if (error instanceof VectorCodeRuntimeError) {
			return error;
		}
		const detail = errorMessage(error);
		const normalized = detail.toLowerCase();
		let code = fallbackCode;
		let retryable = fallbackRetryable;
		if (/not found|enoent|cli is not installed|install.+codex/.test(normalized)) {
			code = VectorCodeRuntimeErrorCode.DependencyMissing;
			retryable = false;
		} else if (/timed out|timeout/.test(normalized)) {
			code = fallbackCode === VectorCodeRuntimeErrorCode.StartupTimeout
				? VectorCodeRuntimeErrorCode.StartupTimeout
				: VectorCodeRuntimeErrorCode.RequestTimeout;
			retryable = true;
		} else if (/not running|stopped|exited|connection.+(?:closed|lost)/.test(normalized)) {
			code = VectorCodeRuntimeErrorCode.ConnectionLost;
			retryable = true;
		}
		const userMessage = code === VectorCodeRuntimeErrorCode.DependencyMissing
			? localize('vectorCodeCodexDependencyMissing', 'Codex CLI is not installed. Install it, then use Refresh.')
			: code === VectorCodeRuntimeErrorCode.StartupTimeout
				? localize('vectorCodeCodexStartupTimedOut', 'Codex took too long to start. Use Refresh to retry.')
				: code === VectorCodeRuntimeErrorCode.RequestTimeout
					? localize('vectorCodeCodexRequestTimedOut', 'Codex did not respond in time. Try the action again.')
					: code === VectorCodeRuntimeErrorCode.ConnectionLost
						? localize('vectorCodeCodexConnectionLost', 'Codex stopped unexpectedly. Vector Code will retry automatically.')
						: localize('vectorCodeCodexOperationFailed', 'Codex could not complete the operation. Use Refresh or open Full Terminal for diagnostics.');
		return toVectorCodeRuntimeError(error, { code, userMessage, retryable, correlationId });
	}
}

function normalizeMarketplacePlugins(response: unknown): IVectorCodeCodexPluginData[] {
	const plugins: IVectorCodeCodexPluginData[] = [];
	for (const marketplace of getRecordArray(response, 'marketplaces')) {
		const marketplaceName = stringField(marketplace, 'name');
		if (!marketplaceName) {
			continue;
		}
		const marketplacePath = stringField(marketplace, 'path');
		for (const plugin of getRecordArray(marketplace, 'plugins')) {
			const normalized = normalizePlugin(plugin, marketplaceName, marketplacePath);
			if (normalized) {
				plugins.push(normalized);
			}
		}
	}
	return deduplicatePlugins(plugins);
}

function normalizePluginSearchResults(response: unknown): IVectorCodeCodexPluginData[] {
	const plugins: IVectorCodeCodexPluginData[] = [];
	for (const result of getRecordArray(response, 'data')) {
		const marketplaceName = stringField(result, 'marketplaceName');
		if (!marketplaceName) {
			continue;
		}
		const normalized = normalizePlugin(getRecord(result, 'plugin'), marketplaceName, stringField(result, 'marketplacePath'));
		if (normalized) {
			plugins.push(normalized);
		}
	}
	return deduplicatePlugins(plugins);
}

function normalizePlugin(plugin: Record<string, unknown> | undefined, marketplaceName: string, marketplacePath?: string): IVectorCodeCodexPluginData | undefined {
	const id = stringField(plugin, 'id');
	const name = stringField(plugin, 'name');
	if (!id || !name) {
		return undefined;
	}
	const interfaceData = getRecord(plugin, 'interface');
	return {
		id,
		name,
		displayName: stringField(interfaceData, 'displayName') ?? name,
		marketplaceName,
		marketplacePath,
		installed: booleanField(plugin, 'installed') ?? false,
		enabled: booleanField(plugin, 'enabled') ?? false,
		version: stringField(plugin, 'localVersion') ?? stringField(plugin, 'version'),
		description: stringField(interfaceData, 'shortDescription') ?? stringField(interfaceData, 'longDescription'),
		capabilities: stringArrayField(interfaceData, 'capabilities'),
		installPolicy: stringField(plugin, 'installPolicy'),
		availability: stringField(plugin, 'availability'),
	};
}

function deduplicatePlugins(plugins: readonly IVectorCodeCodexPluginData[]): IVectorCodeCodexPluginData[] {
	const byId = new Map<string, IVectorCodeCodexPluginData>();
	for (const plugin of plugins) {
		const existing = byId.get(plugin.id);
		if (!existing || (!existing.installed && plugin.installed)) {
			byId.set(plugin.id, plugin);
		}
	}
	return [...byId.values()];
}

function countInstalledPlugins(response: unknown): number {
	return normalizeMarketplacePlugins(response).filter(plugin => plugin.installed).length;
}

function pluginPickItem(plugin: IVectorCodeCodexPluginData): IVectorCodeCodexPluginPickItem {
	const state = plugin.installed
		? plugin.enabled
			? localize('vectorCodeCodexPluginInstalledEnabled', 'Installed')
			: localize('vectorCodeCodexPluginInstalledDisabled', 'Installed, disabled')
		: localize('vectorCodeCodexPluginAvailable', 'Available');
	return {
		label: `${plugin.installed ? '$(check)' : '$(extensions)'} ${plugin.displayName}`,
		description: [state, plugin.version].filter(Boolean).join(' · '),
		detail: [plugin.description, plugin.marketplaceName].filter(Boolean).join(' — '),
		plugin,
	};
}

function pluginDetail(plugin: IVectorCodeCodexPluginData): string {
	return [
		plugin.description,
		plugin.capabilities.length ? localize('vectorCodeCodexPluginCapabilities', 'Capabilities: {0}', plugin.capabilities.join(', ')) : undefined,
		localize('vectorCodeCodexPluginMarketplace', 'Marketplace: {0}', plugin.marketplaceName),
	].filter((value): value is string => Boolean(value)).join('\n\n');
}

function normalizeThread(value: unknown): IVectorCodeCodexThread | undefined {
	const thread = asRecord(value);
	const id = stringField(thread, 'id');
	if (!id) {
		return undefined;
	}
	return {
		id,
		title: stringField(thread, 'name') ?? stringField(thread, 'preview') ?? localize('vectorCodeCodexUntitledThread', 'New conversation'),
		updatedAt: numberField(thread, 'recencyAt') ?? numberField(thread, 'updatedAt') ?? numberField(thread, 'createdAt') ?? 0,
		status: formatStatus(thread?.status),
	};
}

function normalizeModels(response: unknown): IVectorCodeCodexModel[] {
	const models: IVectorCodeCodexModel[] = [];
	for (const value of getRecordArray(response, 'data')) {
		const model = asRecord(value);
		const id = stringField(model, 'model') ?? stringField(model, 'id');
		if (!id) {
			continue;
		}
		const effortRecords = Array.isArray(model?.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
		models.push({
			id,
			label: stringField(model, 'displayName') ?? id,
			description: stringField(model, 'description') ?? '',
			reasoningEfforts: effortRecords.map(value => stringField(asRecord(value), 'reasoningEffort')).filter((effort): effort is string => Boolean(effort)),
			defaultReasoningEffort: stringField(model, 'defaultReasoningEffort'),
		});
	}
	return models;
}

function isDefaultModel(response: unknown, id: string): boolean {
	return getRecordArray(response, 'data').some(value => {
		const model = asRecord(value);
		return booleanField(model, 'isDefault') === true && (stringField(model, 'model') ?? stringField(model, 'id')) === id;
	});
}

function messagesFromTurns(turns: readonly IVectorCodeCodexTurnData[]): IVectorCodeCodexMessage[] {
	const messages: IVectorCodeCodexMessage[] = [];
	for (const turn of turns) {
		for (const item of turn.items ?? []) {
			const message = messageFromItem(item);
			if (message) {
				messages.push(message);
			}
		}
		if (turn.error) {
			messages.push({ id: `turn-error-${turn.id}`, role: 'error', title: localize('vectorCodeCodexError', 'Error'), text: errorMessage(turn.error) });
		}
	}
	return messages;
}

function messageFromItem(value: unknown): IVectorCodeCodexMessage | undefined {
	const item = asRecord(value);
	const id = stringField(item, 'id');
	const type = stringField(item, 'type');
	if (!id || !type) {
		return undefined;
	}
	const status = formatStatus(item?.status);
	if (type === 'userMessage') {
		const content = Array.isArray(item?.content) ? item.content : [];
		const text = content.map(value => {
			const entry = asRecord(value);
			return stringField(entry, 'text') ?? stringField(entry, 'path') ?? stringField(entry, 'url') ?? stringField(entry, 'name') ?? '';
		}).filter(Boolean).join('\n');
		return { id, role: 'user', title: localize('vectorCodeCodexYou', 'You'), text, status };
	}
	if (type === 'agentMessage') {
		return { id, role: 'assistant', title: localize('vectorCodeCodexAssistant', 'Codex'), text: stringField(item, 'text', false) ?? '', status };
	}
	if (type === 'plan') {
		return { id, role: 'reasoning', title: localize('vectorCodeCodexPlan', 'Plan'), text: stringField(item, 'text', false) ?? '', status };
	}
	if (type === 'reasoning') {
		const summary = stringArrayField(item, 'summary');
		const content = stringArrayField(item, 'content');
		return { id, role: 'reasoning', title: localize('vectorCodeCodexReasoning', 'Reasoning'), text: [...summary, ...content].join('\n'), status };
	}
	if (type === 'commandExecution') {
		const command = stringField(item, 'command', false) ?? '';
		const output = stringField(item, 'aggregatedOutput', false) ?? '';
		return { id, role: 'activity', title: localize('vectorCodeCodexCommand', 'Command'), text: [`$ ${command}`, output].filter(Boolean).join('\n'), status };
	}
	if (type === 'fileChange') {
		const changes = Array.isArray(item?.changes) ? item.changes : [];
		const text = changes.map(value => {
			const change = asRecord(value);
			return `${stringField(change, 'kind') ?? 'update'} ${stringField(change, 'path') ?? ''}`.trim();
		}).join('\n');
		return { id, role: 'activity', title: localize('vectorCodeCodexFileChange', 'File changes'), text, status };
	}
	if (type === 'mcpToolCall' || type === 'dynamicToolCall') {
		const server = stringField(item, 'server') ?? stringField(item, 'namespace');
		const tool = stringField(item, 'tool') ?? localize('vectorCodeCodexTool', 'Tool');
		const result = item?.result ?? item?.error ?? item?.contentItems;
		return { id, role: 'activity', title: server ? `${server} · ${tool}` : tool, text: result === undefined || result === null ? '' : formatJson(result), status };
	}
	if (type === 'collabAgentToolCall' || type === 'subAgentActivity') {
		return { id, role: 'activity', title: localize('vectorCodeCodexAgents', 'Agents'), text: stringField(item, 'prompt') ?? stringField(item, 'kind') ?? formatJson(item), status };
	}
	if (type === 'webSearch') {
		return { id, role: 'activity', title: localize('vectorCodeCodexWebSearch', 'Web search'), text: stringField(item, 'query') ?? '', status };
	}
	if (type === 'imageView' || type === 'imageGeneration') {
		return { id, role: 'activity', title: localize('vectorCodeCodexImage', 'Image'), text: stringField(item, 'path') ?? '', status };
	}
	if (type === 'enteredReviewMode' || type === 'exitedReviewMode') {
		return { id, role: 'activity', title: localize('vectorCodeCodexReview', 'Review'), text: stringField(item, 'review') ?? type, status };
	}
	if (type === 'contextCompaction') {
		return { id, role: 'activity', title: localize('vectorCodeCodexContextCompacted', 'Context compacted'), text: localize('vectorCodeCodexContextCompactedDetail', 'Codex compacted the conversation context.'), status };
	}
	return { id, role: 'activity', title: type, text: '', status };
}

function asThreadData(value: Record<string, unknown> | undefined): IVectorCodeCodexThreadData | undefined {
	const id = stringField(value, 'id');
	if (!id) {
		return undefined;
	}
	return {
		id,
		name: stringField(value, 'name'),
		preview: stringField(value, 'preview'),
		updatedAt: numberField(value, 'updatedAt'),
		createdAt: numberField(value, 'createdAt'),
		status: value?.status,
		turns: Array.isArray(value?.turns) ? value.turns.map(asTurnData).filter((turn): turn is IVectorCodeCodexTurnData => Boolean(turn)) : [],
	};
}

function asTurnData(value: Record<string, unknown> | undefined): IVectorCodeCodexTurnData | undefined {
	const id = stringField(value, 'id');
	if (!id) {
		return undefined;
	}
	return {
		id,
		status: stringField(value, 'status'),
		items: Array.isArray(value?.items) ? value.items : [],
		error: value?.error,
	};
}

function normalizeAccountLabel(account: Record<string, unknown> | undefined): string | undefined {
	if (!account) {
		return undefined;
	}
	const type = stringField(account, 'type');
	if (type === 'chatgpt') {
		return stringField(account, 'email') ?? localize('vectorCodeCodexChatGPTAccount', 'ChatGPT account');
	}
	if (type === 'apiKey') {
		return localize('vectorCodeCodexApiKeyAccount', 'OpenAI API key');
	}
	if (type === 'amazonBedrock') {
		return localize('vectorCodeCodexBedrockAccount', 'Amazon Bedrock');
	}
	return type;
}

function getRecord(value: unknown, key: string): Record<string, unknown> | undefined {
	return asRecord(asRecord(value)?.[key]);
}

function getRecordArray(value: unknown, key: string): Record<string, unknown>[] {
	const array = asRecord(value)?.[key];
	return Array.isArray(array) ? array.map(asRecord).filter((record): record is Record<string, unknown> => Boolean(record)) : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: Record<string, unknown> | undefined, key: string, trim = true): string | undefined {
	const field = value?.[key];
	if (typeof field !== 'string') {
		return undefined;
	}
	return trim ? field.trim() || undefined : field;
}

function stringArrayField(value: Record<string, unknown> | undefined, key: string): string[] {
	const field = value?.[key];
	return Array.isArray(field) ? field.filter((entry): entry is string => typeof entry === 'string') : [];
}

function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
	const field = value?.[key];
	return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function booleanField(value: Record<string, unknown> | undefined, key: string): boolean | undefined {
	const field = value?.[key];
	return typeof field === 'boolean' ? field : undefined;
}

function formatStatus(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	return stringField(asRecord(value), 'type') ?? '';
}

function formatJson(value: unknown): string {
	try {
		return JSON.stringify(value, undefined, 2);
	} catch {
		return String(value);
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	const record = asRecord(error);
	return stringField(record, 'message') ?? stringField(record, 'additionalDetails') ?? formatJson(error);
}

function codexReadyCapabilities(requiresAuthentication: boolean): readonly string[] {
	return requiresAuthentication
		? [VECTOR_CODE_CODEX_CAPABILITY_PLUGINS, VECTOR_CODE_CODEX_CAPABILITY_THREADS]
		: CODEX_READY_CAPABILITIES;
}

registerSingleton(IVectorCodeCodexService, VectorCodeCodexService, InstantiationType.Delayed);
