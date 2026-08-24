/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType, setVisibility } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';
import {
	IVectorCodeMobileConnectionStatus,
	IVectorCodeMobileRelayService,
	IVectorCodeCodexService,
	IVectorCodeWorkbenchService,
	VECTOR_CODE_ADD_PROJECT_COMMAND_ID,
	VECTOR_CODE_CONTROL_VIEW_ID,
	VECTOR_CODE_CODEX_VIEW_CONTAINER_ID,
	VECTOR_CODE_CODEX_VIEW_ID,
	VECTOR_CODE_PROJECTS_VIEW_ID,
	VECTOR_CODE_VIEW_CONTAINER_ID,
	VectorCodeCodexConnectionState,
	VectorCodeMobileConnectionState
} from '../common/vectorCode.js';
import './vectorCodeActions.js';
import './vectorCodeCodexService.js';
import './vectorCodeMobileRelayService.js';
import './vectorCodeService.js';
import './media/vectorCode.css';

const vectorCodeIcon = registerIcon('vector-code-view-icon', Codicon.deviceMobile, localize('vectorCodeViewIcon', 'View icon of the phone connection view.'));
const vectorCodeCodexIcon = registerIcon('vector-code-codex-view-icon', Codicon.sparkle, localize('vectorCodeCodexViewIcon', 'View icon of the Codex view.'));

interface IVectorCodeStatusCard {
	readonly card: HTMLElement;
	readonly status: HTMLElement;
}

abstract class VectorCodeViewPane extends ViewPane {

	constructor(
		options: IViewletViewOptions,
		@ICommandService protected readonly commandService: ICommandService,
		@IVectorCodeCodexService protected readonly codexService: IVectorCodeCodexService,
		@IVectorCodeWorkbenchService protected readonly vectorCodeWorkbenchService: IVectorCodeWorkbenchService,
		@IWorkspaceContextService protected readonly workspaceContextService: IWorkspaceContextService,
		@IVectorCodeMobileRelayService protected readonly mobileRelayService: IVectorCodeMobileRelayService,
		@INotificationService protected readonly notificationService: INotificationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		const vectorCodePane = new.target as typeof VectorCodeViewPane;
		super({ ...options, titleMenuId: MenuId.ViewTitle, ...vectorCodePane.viewOptions }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		if (typeof vectorCodePane.collapsible === 'boolean') {
			this.collapsible = vectorCodePane.collapsible;
		}
	}

	protected static readonly viewOptions: Partial<IViewPaneOptions> = {};
	protected static readonly collapsible: boolean | undefined;
}

class VectorCodeProjectsView extends VectorCodeViewPane {

	protected static override readonly viewOptions = { minimumBodySize: 96, maximumBodySize: 220 };
	protected static override readonly collapsible = false;

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('vector-code-projects-view');

		const root = append(container, $('.vector-code-project-switcher'));
		const header = append(root, $('.vector-code-project-switcher__header'));
		const status = append(header, $('.vector-code-project-switcher__status'));
		const addButton = this.renderIconButton(header, localize('vectorCodeAddProject', 'Add Project'), Codicon.add);
		this._register(addDisposableListener(addButton, EventType.CLICK, () => {
			void this.commandService.executeCommand(VECTOR_CODE_ADD_PROJECT_COMMAND_ID);
		}));

		const projectList = append(root, $('.vector-code-project-switcher__list'));
		const projectListDisposables = this._register(new DisposableStore());
		const updateProjects = () => {
			status.textContent = this.vectorCodeWorkbenchService.getProjectStatusLabel();
			this.renderProjectList(projectList, projectListDisposables);
		};
		updateProjects();
		const activeProjectUri = this.vectorCodeWorkbenchService.getActiveProjectUri();
		if (activeProjectUri) {
			void this.vectorCodeWorkbenchService.switchProject(activeProjectUri);
		}
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(updateProjects));
		this._register(this.vectorCodeWorkbenchService.onDidChangeActiveProject(updateProjects));
	}

	private renderProjectList(container: HTMLElement, disposables: DisposableStore): void {
		disposables.clear();
		clearNode(container);
		const projects = this.vectorCodeWorkbenchService.getProjectSummaries();
		if (!projects.length) {
			const empty = append(container, $('.vector-code-project-switcher__empty'));
			empty.textContent = localize('vectorCodeProjectsListEmpty', 'Add a project to populate the file tree.');
			return;
		}

		const activeProjectUri = this.vectorCodeWorkbenchService.getActiveProjectUri()?.toString();

		for (const project of projects) {
			const projectUri = project.uri.toString();
			const item = document.createElement('div');
			item.className = 'vector-code-project-switcher__project';
			item.classList.toggle('vector-code-project-switcher__project--active', projectUri === activeProjectUri);
			item.title = `${project.name}\n${project.uriLabel}`;
			const selectButton = document.createElement('button');
			selectButton.className = 'vector-code-project-switcher__project-select';
			selectButton.type = 'button';
			selectButton.setAttribute('aria-label', localize('vectorCodeSelectProject', 'Select {0}', project.name));
			const name = append(selectButton, $('.vector-code-project-switcher__project-name'));
			name.textContent = project.name;
			const path = append(selectButton, $('.vector-code-project-switcher__project-path'));
			path.textContent = project.uriLabel;
			path.title = project.uriLabel;
			item.appendChild(selectButton);
			const closeButton = this.renderIconButton(item, localize('vectorCodeCloseProject', 'Close {0}', project.name), Codicon.close);
			closeButton.classList.add('vector-code-project-switcher__project-close');
			container.appendChild(item);

			disposables.add(addDisposableListener(selectButton, EventType.CLICK, () => {
				void this.vectorCodeWorkbenchService.switchProject(project.uri);
			}));
			disposables.add(addDisposableListener(closeButton, EventType.CLICK, event => {
				event.stopPropagation();
				void this.vectorCodeWorkbenchService.closeProject(project.uri);
			}));
		}
	}

	private renderIconButton(container: HTMLElement, title: string, icon: ThemeIcon): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'vector-code-project-switcher__icon-button';
		button.type = 'button';
		button.title = title;
		button.setAttribute('aria-label', title);
		const iconNode = append(button, $('.vector-code-project-switcher__icon'));
		iconNode.classList.add(...ThemeIcon.asClassNameArray(icon));
		container.appendChild(button);
		return button;
	}
}

class VectorCodeCodexView extends VectorCodeViewPane {

	protected static override readonly collapsible = false;

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('vector-code-codex-view');

		const root = append(container, $('.vector-code-codex'));
		const header = append(root, $('.vector-code-codex__header'));
		const status = append(header, $('.vector-code-codex__status'));
		const project = append(header, $('.vector-code-codex__project'));
		const account = append(header, $('.vector-code-codex__account'));

		const toolbar = append(root, $('.vector-code-codex__toolbar'));
		const newButton = this.renderCodexButton(toolbar, localize('vectorCodeCodexNew', 'New'), Codicon.add);
		const refreshButton = this.renderCodexButton(toolbar, localize('vectorCodeCodexRefresh', 'Refresh'), Codicon.refresh);
		const pluginsButton = this.renderCodexButton(toolbar, localize('vectorCodeCodexPlugins', 'Plugins'), Codicon.extensions);
		const pluginsButtonLabel = pluginsButton.lastElementChild as HTMLElement;
		const forkButton = this.renderCodexButton(toolbar, localize('vectorCodeCodexFork', 'Fork'), Codicon.gitPullRequestCreate);
		const archiveButton = this.renderCodexButton(toolbar, localize('vectorCodeCodexArchive', 'Archive'), Codicon.archive);

		const threadSelect = document.createElement('select');
		threadSelect.className = 'vector-code-codex__select vector-code-codex__thread-select';
		threadSelect.setAttribute('aria-label', localize('vectorCodeCodexConversation', 'Codex conversation'));
		root.appendChild(threadSelect);

		const settings = append(root, $('.vector-code-codex__settings'));
		const modelSelect = document.createElement('select');
		modelSelect.className = 'vector-code-codex__select';
		modelSelect.setAttribute('aria-label', localize('vectorCodeCodexModel', 'Codex model'));
		settings.appendChild(modelSelect);
		const effortSelect = document.createElement('select');
		effortSelect.className = 'vector-code-codex__select';
		effortSelect.setAttribute('aria-label', localize('vectorCodeCodexReasoningEffort', 'Reasoning effort'));
		settings.appendChild(effortSelect);

		const messages = append(root, $('.vector-code-codex__messages'));
		const emptyAction = $('.vector-code-codex__empty-action');
		const openProjectButton = this.renderCodexButton(emptyAction, localize('vectorCodeCodexOpenProject', 'Open Project'), Codicon.folderOpened);
		const composer = append(root, $('.vector-code-codex__composer'));
		const prompt = document.createElement('textarea');
		prompt.className = 'vector-code-codex__prompt';
		prompt.rows = 4;
		prompt.placeholder = localize('vectorCodeCodexPromptPlaceholder', 'Ask Codex to work on this project...');
		prompt.setAttribute('aria-label', localize('vectorCodeCodexPrompt', 'Message Codex'));
		composer.appendChild(prompt);
		const composerActions = append(composer, $('.vector-code-codex__composer-actions'));
		const terminalButton = this.renderCodexButton(composerActions, localize('vectorCodeCodexFullTerminal', 'Full Terminal'), Codicon.terminal);
		const stopButton = this.renderCodexButton(composerActions, localize('vectorCodeCodexStop', 'Stop'), Codicon.debugStop);
		const sendButton = this.renderCodexButton(composerActions, localize('vectorCodeCodexSend', 'Send'), Codicon.send);
		sendButton.classList.add('vector-code-codex__button--primary');

		const run = (operation: () => Promise<void>): void => {
			void operation().catch(error => this.notificationService.error(error instanceof Error ? error.message : String(error)));
		};
		const sendPrompt = (): void => {
			const text = prompt.value.trim();
			if (!text || this.codexService.getState().turnInProgress) {
				return;
			}
			prompt.value = '';
			updateComposer();
			run(async () => {
				try {
					await this.codexService.sendMessage(text);
				} catch (error) {
					if (!prompt.value) {
						prompt.value = text;
						updateComposer();
					}
					throw error;
				}
			});
		};
		const updateComposer = (): void => {
			const state = this.codexService.getState();
			const ready = state.connectionState === VectorCodeCodexConnectionState.Ready;
			const projectReady = Boolean(state.activeProjectPath);
			const canMessage = ready && projectReady && !state.requiresAuthentication;
			prompt.disabled = !canMessage;
			prompt.placeholder = state.requiresAuthentication
				? localize('vectorCodeCodexPromptSignInRequired', 'Sign in from the Codex terminal to send messages')
				: projectReady
					? localize('vectorCodeCodexPromptPlaceholder', 'Ask Codex to work on this project...')
					: localize('vectorCodeCodexPromptProjectRequired', 'Open a local project to message Codex');
			sendButton.disabled = !canMessage || state.turnInProgress || !prompt.value.trim();
			terminalButton.disabled = !projectReady || state.turnInProgress;
			stopButton.disabled = !state.turnInProgress;
			setVisibility(state.turnInProgress, stopButton);
		};

		const render = (): void => {
			const state = this.codexService.getState();
			status.textContent = state.detail;
			status.classList.toggle('vector-code-codex__status--error', state.connectionState === VectorCodeCodexConnectionState.Error);
			project.textContent = state.activeProjectName
				? localize('vectorCodeCodexActiveProject', 'Project: {0}', state.activeProjectName)
				: localize('vectorCodeCodexNoActiveProject', 'No project open');
			project.title = state.activeProjectPath ?? '';
			account.textContent = state.accountLabel ?? '';
			setVisibility(Boolean(state.accountLabel), account);

			clearNode(threadSelect);
			const emptyThreadOption = document.createElement('option');
			emptyThreadOption.value = '';
			emptyThreadOption.textContent = !state.activeProjectPath
				? localize('vectorCodeCodexOpenProjectForConversations', 'Open a project to load conversations')
				: state.threads.length
					? localize('vectorCodeCodexSelectConversation', 'Select a conversation')
					: localize('vectorCodeCodexNoConversations', 'No conversations yet');
			threadSelect.appendChild(emptyThreadOption);
			if (state.activeThreadId && !state.threads.some(thread => thread.id === state.activeThreadId)) {
				const activeThreadOption = document.createElement('option');
				activeThreadOption.value = state.activeThreadId;
				activeThreadOption.textContent = localize('vectorCodeCodexNewConversation', 'New conversation');
				threadSelect.appendChild(activeThreadOption);
			}
			for (const thread of state.threads) {
				const option = document.createElement('option');
				option.value = thread.id;
				option.textContent = thread.title;
				option.title = new Date(thread.updatedAt * 1_000).toLocaleString();
				threadSelect.appendChild(option);
			}
			threadSelect.value = state.activeThreadId ?? '';
			threadSelect.disabled = state.connectionState !== VectorCodeCodexConnectionState.Ready || !state.activeProjectPath || state.turnInProgress;

			clearNode(modelSelect);
			for (const model of state.models) {
				const option = document.createElement('option');
				option.value = model.id;
				option.textContent = model.label;
				option.title = model.description;
				modelSelect.appendChild(option);
			}
			modelSelect.value = state.selectedModel ?? '';
			modelSelect.disabled = !state.models.length || state.turnInProgress;

			clearNode(effortSelect);
			const selectedModel = state.models.find(model => model.id === state.selectedModel);
			for (const effort of selectedModel?.reasoningEfforts ?? []) {
				const option = document.createElement('option');
				option.value = effort;
				option.textContent = effort;
				effortSelect.appendChild(option);
			}
			effortSelect.value = state.selectedReasoningEffort ?? '';
			effortSelect.disabled = !selectedModel?.reasoningEfforts.length || state.turnInProgress;
			setVisibility(Boolean(state.models.length), settings);

			const shouldFollow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 72;
			clearNode(messages);
			if (!state.messages.length) {
				const empty = append(messages, $('.vector-code-codex__empty'));
				const emptyIcon = append(empty, $('.vector-code-codex__empty-icon'));
				emptyIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.sparkle));
				const emptyTitle = append(empty, $('.vector-code-codex__empty-title'));
				emptyTitle.textContent = !state.activeProjectPath
					? state.activeProjectName
						? localize('vectorCodeCodexLocalProjectNeeded', 'Reopen this project locally')
						: localize('vectorCodeCodexOpenProjectToStart', 'Open a project to start')
					: state.requiresAuthentication
						? localize('vectorCodeCodexSignInTitle', 'Sign in to use Codex')
						: state.connectionState === VectorCodeCodexConnectionState.Retrying
							? localize('vectorCodeCodexReconnecting', 'Reconnecting to Codex')
							: state.connectionState === VectorCodeCodexConnectionState.Error
								? localize('vectorCodeCodexUnavailable', 'Codex is unavailable')
								: localize('vectorCodeCodexReadyToBuild', 'What should Codex build?');
				const emptyDetail = append(empty, $('.vector-code-codex__empty-detail'));
				emptyDetail.textContent = !state.activeProjectPath
					? localize('vectorCodeCodexProjectScopeDetail', 'Project selection keeps files, terminals, conversations, and Codex changes in one explicit workspace.')
					: state.requiresAuthentication
						? localize('vectorCodeCodexSignInDetail', 'Open the Codex terminal, complete sign-in, then return here. Vector Code will detect the account change.')
						: state.connectionState === VectorCodeCodexConnectionState.Retrying
							? localize('vectorCodeCodexReconnectDetail', 'The app-server exited unexpectedly. Vector Code is restarting it with bounded backoff.')
							: state.connectionState === VectorCodeCodexConnectionState.Error
								? localize('vectorCodeCodexRetryDetail', 'Use Refresh to retry, or open the full terminal experience for setup and diagnostics.')
								: localize('vectorCodeCodexReadyToBuildDetail', 'Codex can inspect files, run commands, edit the project, and verify its work.');
				if (!state.activeProjectPath) {
					empty.appendChild(emptyAction);
				}
			} else {
				for (const message of state.messages) {
					const card = append(messages, $(`.vector-code-codex__message.vector-code-codex__message--${message.role}`));
					const messageHeader = append(card, $('.vector-code-codex__message-header'));
					const title = append(messageHeader, $('.vector-code-codex__message-title'));
					title.textContent = message.title;
					if (message.status) {
						const messageStatus = append(messageHeader, $('.vector-code-codex__message-status'));
						messageStatus.textContent = message.status;
					}
					const text = document.createElement('pre');
					text.className = 'vector-code-codex__message-text';
					text.textContent = message.text;
					card.appendChild(text);
				}
			}
			if (shouldFollow) {
				messages.scrollTop = messages.scrollHeight;
			}

			const ready = state.connectionState === VectorCodeCodexConnectionState.Ready;
			newButton.disabled = !ready || !state.activeProjectPath || state.requiresAuthentication || state.turnInProgress;
			refreshButton.disabled = state.connectionState === VectorCodeCodexConnectionState.Starting;
			pluginsButton.disabled = !ready || state.turnInProgress;
			pluginsButtonLabel.textContent = localize('vectorCodeCodexPluginsCount', 'Plugins ({0})', state.installedPluginCount);
			pluginsButton.title = localize('vectorCodeCodexManagePlugins', 'Manage {0} installed Codex plugin(s)', state.installedPluginCount);
			forkButton.disabled = !ready || !state.activeThreadId || state.turnInProgress;
			archiveButton.disabled = !ready || !state.activeThreadId || state.turnInProgress;
			updateComposer();
		};

		this._register(addDisposableListener(newButton, EventType.CLICK, () => run(() => this.codexService.createThread())));
		this._register(addDisposableListener(openProjectButton, EventType.CLICK, () => run(() => this.vectorCodeWorkbenchService.addProjectToWorkspace())));
		this._register(addDisposableListener(refreshButton, EventType.CLICK, () => run(async () => {
			await this.codexService.ensureReady();
			await this.codexService.refreshThreads();
		})));
		this._register(addDisposableListener(pluginsButton, EventType.CLICK, () => run(() => this.codexService.managePlugins())));
		this._register(addDisposableListener(forkButton, EventType.CLICK, () => run(() => this.codexService.forkActiveThread())));
		this._register(addDisposableListener(archiveButton, EventType.CLICK, () => run(() => this.codexService.archiveActiveThread())));
		this._register(addDisposableListener(threadSelect, EventType.CHANGE, () => {
			if (threadSelect.value) {
				run(() => this.codexService.selectThread(threadSelect.value));
			}
		}));
		this._register(addDisposableListener(modelSelect, EventType.CHANGE, () => this.codexService.selectModel(modelSelect.value)));
		this._register(addDisposableListener(effortSelect, EventType.CHANGE, () => this.codexService.selectModel(modelSelect.value, effortSelect.value)));
		this._register(addDisposableListener(prompt, EventType.INPUT, updateComposer));
		this._register(addDisposableListener(prompt, EventType.KEY_DOWN, event => {
			const keyboardEvent = event as KeyboardEvent;
			if (keyboardEvent.key === 'Enter' && (keyboardEvent.ctrlKey || keyboardEvent.metaKey)) {
				keyboardEvent.preventDefault();
				sendPrompt();
			}
		}));
		this._register(addDisposableListener(sendButton, EventType.CLICK, sendPrompt));
		this._register(addDisposableListener(stopButton, EventType.CLICK, () => run(() => this.codexService.interruptTurn())));
		this._register(addDisposableListener(terminalButton, EventType.CLICK, () => run(() => this.vectorCodeWorkbenchService.openCodexTerminal())));
		this._register(this.codexService.onDidChangeState(render));

		render();
		run(() => this.codexService.ensureReady());
	}

	private renderCodexButton(container: HTMLElement, label: string, icon: ThemeIcon): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'vector-code-codex__button';
		const iconNode = append(button, $('.vector-code-codex__button-icon'));
		iconNode.classList.add(...ThemeIcon.asClassNameArray(icon));
		const labelNode = append(button, $('.vector-code-codex__button-label'));
		labelNode.textContent = label;
		container.appendChild(button);
		return button;
	}
}

class VectorCodeLayoutContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.vectorCodeLayout';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IVectorCodeWorkbenchService private readonly vectorCodeWorkbenchService: IVectorCodeWorkbenchService,
	) {
		super();
		this.vectorCodeWorkbenchService.getProjectStatusLabel();
		this.hideAuxiliaryBar();
		this._register(this.layoutService.onDidChangePartVisibility(event => {
			if (event.partId === Parts.AUXILIARYBAR_PART && event.visible) {
				this.hideAuxiliaryBar();
			}
		}));
	}

	private hideAuxiliaryBar(): void {
		if (this.layoutService.isVisible(Parts.AUXILIARYBAR_PART)) {
			this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
		}
	}
}

class VectorCodeControlView extends VectorCodeViewPane {

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('vector-code-control-view');

		const root = append(container, $('.vector-code-control'));
		const grid = append(root, $('.vector-code-control__grid'));
		this.renderMobileCard(grid);
	}

	private renderMobileCard(container: HTMLElement): void {
		const mobileStatus = this.mobileRelayService.getStatus();
		const mobile = this.renderStatusCard(container, Codicon.deviceMobile, localize('vectorCodeMobile', 'Phone Bridge'), mobileStatus.label);
		mobile.card.classList.add('vector-code-control__mobile');
		const detail = append(mobile.card, $('.vector-code-control__mobile-detail'));
		const actions = append(mobile.card, $('.vector-code-control__card-actions'));
		const startButton = this.renderButton(actions, localize('vectorCodeMobileRefreshQr', 'Refresh QR'), Codicon.refresh);
		const pairingContainer = append(mobile.card, $('.vector-code-control__pairing'));
		const pairingDisposables = this._register(new DisposableStore());
		let currentStatus = mobileStatus;

		const canRefreshPairing = (status: IVectorCodeMobileConnectionStatus): boolean => {
			return status.state === VectorCodeMobileConnectionState.Disconnected
				|| (status.state === VectorCodeMobileConnectionState.Pairing && Boolean(status.pairing));
		};

		const updateStartButton = (status: IVectorCodeMobileConnectionStatus, busy = false): void => {
			startButton.disabled = busy || !canRefreshPairing(status);
			startButton.title = startButton.disabled && !busy
				? localize('vectorCodeMobileRefreshQrDisabled', 'Refresh QR is unavailable while the current phone bridge is active.')
				: '';
		};

		const renderStatus = (status: IVectorCodeMobileConnectionStatus): void => {
			currentStatus = status;
			pairingDisposables.clear();
			mobile.status.textContent = status.label;
			detail.textContent = status.detail;
			updateStartButton(status);
			clearNode(pairingContainer);
			pairingContainer.classList.toggle('vector-code-control__pairing--locked', status.state !== VectorCodeMobileConnectionState.Pairing);

			if (!status.pairing) {
				return;
			}

			const pairing = status.pairing;
			const pairingState = append(pairingContainer, $('.vector-code-control__pairing-state'));
			pairingState.textContent = status.state === VectorCodeMobileConnectionState.Pairing
				? localize('vectorCodeMobilePairingScanReady', 'Ready for phone scan')
				: localize('vectorCodeMobilePairingSetupNeeded', 'Connection setup needed');

			const qr = document.createElement('img');
			qr.className = 'vector-code-control__qr';
			qr.src = pairing.qrDataUrl;
			qr.alt = localize('vectorCodeMobilePairingQrAlt', 'Mobile Pairing QR Code');
			pairingContainer.appendChild(qr);

			const meta = append(pairingContainer, $('.vector-code-control__pairing-meta'));
			const expiresAt = append(meta, $('.vector-code-control__pairing-expires'));
			expiresAt.textContent = localize('vectorCodeMobilePairingExpires', 'Scan by: {0}', new Date(pairing.payload.expiresAt).toLocaleTimeString());
			const tokenState = append(meta, $('.vector-code-control__pairing-token-state'));
			tokenState.textContent = pairing.payload.relayToken
				? localize('vectorCodeMobilePairingSecureSessionReady', 'Secure session ready')
				: localize('vectorCodeMobilePairingSecureSessionMissing', 'Secure session unavailable');

			const pairingCode = append(pairingContainer, $('.vector-code-control__pairing-code'));
			pairingCode.textContent = pairing.pairingCode;
			pairingCode.title = localize('vectorCodeMobilePairingCodeTitle', 'Pairing code');

		};

		const renderBusy = () => {
			pairingDisposables.clear();
			updateStartButton(currentStatus, true);
			mobile.status.textContent = localize('vectorCodeMobilePairingCreating', 'Creating QR...');
			detail.textContent = localize('vectorCodeMobilePairingCreatingDetail', 'Creating a secure phone pairing session.');
			clearNode(pairingContainer);
			pairingContainer.classList.remove('vector-code-control__pairing--locked');
			const pending = append(pairingContainer, $('.vector-code-control__qr-pending'));
			pending.textContent = localize('vectorCodeMobilePairingQrPending', 'QR');
		};

		const refreshPairing = async (notifyOnError: boolean): Promise<void> => {
			if (!canRefreshPairing(currentStatus)) {
				return;
			}
			renderBusy();
			try {
				renderStatus(await this.mobileRelayService.startPairing());
			} catch (error) {
				const message = error instanceof Error ? error.message : localize('vectorCodeMobilePairingFailed', 'Unable to create a QR pairing session.');
				mobile.status.textContent = localize('vectorCodeMobilePairingFailedShort', 'QR creation failed');
				detail.textContent = message;
				clearNode(pairingContainer);
				if (notifyOnError) {
					this.notificationService.error(message);
				}
				updateStartButton(currentStatus);
			}
		};

		renderStatus(mobileStatus);
		if (mobileStatus.state === VectorCodeMobileConnectionState.Disconnected && !mobileStatus.pairing) {
			void refreshPairing(false);
		}
		this._register(addDisposableListener(startButton, EventType.CLICK, () => {
			void refreshPairing(true);
		}));
	}

	private renderStatusCard(container: HTMLElement, icon: ThemeIcon, title: string, status: string): IVectorCodeStatusCard {
		const card = append(container, $('.vector-code-control__card'));
		const cardHeader = append(card, $('.vector-code-control__card-header'));
		const cardIcon = append(cardHeader, $('.vector-code-control__card-icon'));
		cardIcon.classList.add(...ThemeIcon.asClassNameArray(icon));
		const cardTitle = append(cardHeader, $('.vector-code-control__card-title'));
		cardTitle.textContent = title;
		const cardStatus = append(card, $('.vector-code-control__card-status'));
		cardStatus.textContent = status;

		return { card, status: cardStatus };
	}

	private renderButton(container: HTMLElement, labelText: string, icon?: ThemeIcon): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'vector-code-control__button';
		button.type = 'button';
		if (icon) {
			const iconNode = append(button, $('.vector-code-control__button-icon'));
			iconNode.classList.add(...ThemeIcon.asClassNameArray(icon));
		}
		const label = append(button, $('.vector-code-control__button-label'));
		label.textContent = labelText;
		container.appendChild(button);
		return button;
	}
}

const vectorCodeCodexViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: VECTOR_CODE_CODEX_VIEW_CONTAINER_ID,
	title: localize2('vectorCodeCodex', 'Codex'),
	icon: vectorCodeCodexIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VECTOR_CODE_CODEX_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: VECTOR_CODE_CODEX_VIEW_CONTAINER_ID,
	order: 0,
	openCommandActionDescriptor: {
		id: VECTOR_CODE_CODEX_VIEW_CONTAINER_ID,
		mnemonicTitle: localize({ key: 'miViewVectorCodeCodex', comment: ['&& denotes a mnemonic'] }, '&&Codex'),
		order: 0,
	},
}, ViewContainerLocation.Sidebar);

const vectorCodeViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: VECTOR_CODE_VIEW_CONTAINER_ID,
	title: localize2('vectorCode', 'Phone Connection'),
	icon: vectorCodeIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VECTOR_CODE_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: VECTOR_CODE_VIEW_CONTAINER_ID,
	order: 1,
	openCommandActionDescriptor: {
		id: VECTOR_CODE_VIEW_CONTAINER_ID,
		mnemonicTitle: localize({ key: 'miViewVectorCode', comment: ['&& denotes a mnemonic'] }, '&&Phone Connection'),
		order: 1,
	},
}, ViewContainerLocation.Sidebar);

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
const explorerViewContainer = viewContainersRegistry.get(EXPLORER_VIEWLET_ID);

viewsRegistry.registerViews([{
	id: VECTOR_CODE_CODEX_VIEW_ID,
	name: localize2('vectorCodeCodexView', 'Codex'),
	containerIcon: vectorCodeCodexIcon,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(VectorCodeCodexView),
	order: 0,
}], vectorCodeCodexViewContainer);

viewsRegistry.registerViews([{
	id: VECTOR_CODE_CONTROL_VIEW_ID,
	name: localize2('vectorCodeControl', 'Phone Connection'),
	containerIcon: vectorCodeIcon,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(VectorCodeControlView),
	order: 1,
}], vectorCodeViewContainer);

if (explorerViewContainer) {
	viewsRegistry.registerViews([{
		id: VECTOR_CODE_PROJECTS_VIEW_ID,
		name: localize2('vectorCodeProjects', 'Projects'),
		containerIcon: vectorCodeIcon,
		canToggleVisibility: false,
		canMoveView: false,
		ctorDescriptor: new SyncDescriptor(VectorCodeProjectsView),
		order: -10,
		weight: 4,
		collapsed: false,
	}], explorerViewContainer);
}

registerWorkbenchContribution2(VectorCodeLayoutContribution.ID, VectorCodeLayoutContribution, WorkbenchPhase.AfterRestored);
