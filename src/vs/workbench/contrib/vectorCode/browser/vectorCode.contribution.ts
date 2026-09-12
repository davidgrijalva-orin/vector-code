/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType, setVisibility } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { hasVectorCodeRuntimeCapability, IVectorCodeRuntimeDiagnosticSummary } from '../../../../platform/vectorCode/common/vectorCodeRuntime.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { VectorGraphProjectInput } from './vectorGraphProjectEditor.js';
import {
	IVectorCodeMobileConnectionStatus,
	IVectorCodeMobileRelayService,
	IVectorCodeWorkbenchService,
	VECTOR_CODE_ADD_PROJECT_COMMAND_ID,
	VECTOR_CODE_CONTROL_VIEW_ID,
	VECTOR_CODE_PROJECTS_VIEW_ID,
	VECTOR_CODE_VIEW_CONTAINER_ID,
	VECTOR_CODE_MOBILE_CAPABILITY_CONFIGURE,
	VECTOR_CODE_MOBILE_CAPABILITY_PAIR,
	VectorCodeMobileConnectionState
} from '../common/vectorCode.js';
import { VectorCodeProjectSwitcher } from './vectorCodeProjectSwitcher.js';
import './vectorCodeActions.js';
import './vectorCodeMobileRelayService.js';
import './vectorCodeService.js';
import './media/vectorCode.css';

const vectorCodeIcon = registerIcon('vector-code-view-icon', Codicon.deviceMobile, localize('vectorCodeViewIcon', 'View icon of the phone connection view.'));

interface IVectorCodeStatusCard {
	readonly card: HTMLElement;
	readonly status: HTMLElement;
}

abstract class VectorCodeViewPane extends ViewPane {

	constructor(
		options: IViewletViewOptions,
		@ICommandService protected readonly commandService: ICommandService,
		@IVectorCodeWorkbenchService protected readonly vectorCodeWorkbenchService: IVectorCodeWorkbenchService,
		@IWorkspaceContextService protected readonly workspaceContextService: IWorkspaceContextService,
		@IVectorCodeMobileRelayService protected readonly mobileRelayService: IVectorCodeMobileRelayService,
		@IDialogService protected readonly dialogService: IDialogService,
		@INotificationService protected readonly notificationService: INotificationService,
		@IQuickInputService protected readonly quickInputService: IQuickInputService,
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

	protected static override readonly viewOptions = { minimumBodySize: 180 };
	protected static override readonly collapsible = false;

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('vector-code-projects-view');
		const addNavigation = (items: readonly (readonly [string, string])[]) => {
			const navigation = append(container, $('.vector-workspace-navigation'));
			for (const [label, command] of items) {
				const button = append(navigation, $<HTMLButtonElement>('button')); button.type = 'button'; button.textContent = label;
				this._register(addDisposableListener(button, EventType.CLICK, () => { void this.commandService.executeCommand(command).catch(error => this.notificationService.error(error)); }));
			}
		};
		const brand = append(container, $('h2.vector-workspace-brand')); brand.textContent = 'VectorCode';
		addNavigation([
			[localize('workspaceHome', 'Project workspace'), 'vectorCode.openProjectWorkspace'],
			[localize('workspaceFind', 'Search files'), 'workbench.action.findInFiles']
		]);

		const switcher = this._register(new VectorCodeProjectSwitcher(container, {
			add: () => this.commandService.executeCommand(VECTOR_CODE_ADD_PROJECT_COMMAND_ID),
			select: async project => { await this.vectorCodeWorkbenchService.switchProject(project.uri); await this.commandService.executeCommand('vectorCode.openProjectWorkspace'); },
			close: project => this.vectorCodeWorkbenchService.closeProject(project.uri),
			onError: error => this.notificationService.error(error)
		}));
		const updateProjects = () => switcher.update(
			this.vectorCodeWorkbenchService.getProjectSummaries(),
			this.vectorCodeWorkbenchService.getActiveProjectUri(),
			this.vectorCodeWorkbenchService.getProjectStatusLabel()
		);
		updateProjects();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(updateProjects));
		this._register(this.vectorCodeWorkbenchService.onDidChangeActiveProject(updateProjects));
		addNavigation([
			[localize('workspaceExtensions', 'Extensions'), 'workbench.view.extensions'],
			[localize('workspaceMcp', 'MCP marketplace'), 'workbench.mcp.browseMarketplace'],
			[localize('workspaceSettings', 'Settings'), 'workbench.action.openSettings']
		]);
	}
}

function formatVectorCodeRuntimeDiagnosticSummary(summary: IVectorCodeRuntimeDiagnosticSummary): string {
	const lines = [
		localize('vectorCodeDiagnosticService', 'Service: {0}', summary.service),
		localize('vectorCodeDiagnosticState', 'State: {0}', summary.status.state),
		localize('vectorCodeDiagnosticCapabilities', 'Available capabilities: {0}', summary.status.capabilities.join(', ') || localize('vectorCodeDiagnosticCapabilitiesNone', 'none')),
	];
	if (summary.status.error) {
		lines.push(
			'',
			localize('vectorCodeDiagnosticLatestIssue', 'Latest issue: {0}', summary.status.error.code),
			summary.status.error.userMessage,
			localize('vectorCodeDiagnosticCause', 'Safe cause: {0}', summary.status.error.cause),
			localize('vectorCodeDiagnosticRetryable', 'Retryable: {0}', summary.status.error.retryable ? localize('vectorCodeDiagnosticYes', 'yes') : localize('vectorCodeDiagnosticNo', 'no')),
		);
		if (summary.status.error.correlationId) {
			lines.push(localize('vectorCodeDiagnosticCorrelation', 'Correlation: {0}', summary.status.error.correlationId));
		}
	}
	if (summary.recentEvents.length) {
		lines.push('', localize('vectorCodeDiagnosticRecentEvents', 'Recent events:'));
		for (const event of summary.recentEvents.slice(-8)) {
			lines.push(localize(
				'vectorCodeDiagnosticEvent',
				'{0} — {1} — {2}',
				new Date(event.timestamp).toLocaleTimeString(),
				event.event,
				event.correlationId,
			));
		}
	}
	if (summary.recoveryActions.length) {
		lines.push('', localize('vectorCodeDiagnosticRecovery', 'Recovery actions:'), ...summary.recoveryActions.map(action => `• ${action}`));
	}
	return lines.join('\n');
}

class VectorCodeProjectContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.vectorCodeProject';

	constructor(@IVectorCodeWorkbenchService vectorCodeWorkbenchService: IVectorCodeWorkbenchService, @IEditorService editors: IEditorService, @INotificationService notifications: INotificationService) {
		vectorCodeWorkbenchService.getProjectStatusLabel();
		if (!editors.activeEditor) { void editors.openEditor(new VectorGraphProjectInput(), { pinned: true }).catch(error => notifications.error(error)); }
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
		const configureButton = this.renderButton(actions, localize('vectorCodeMobileConfigureRelay', 'Configure Secure Relay'), Codicon.key);
		const startButton = this.renderButton(actions, localize('vectorCodeMobileRefreshQr', 'Create / Refresh QR'), Codicon.refresh);
		const diagnosticsButton = this.renderButton(actions, localize('vectorCodeMobileDiagnostics', 'Diagnostics'), Codicon.output);
		const pairingContainer = append(mobile.card, $('.vector-code-control__pairing'));
		const pairingDisposables = this._register(new DisposableStore());
		let currentStatus = mobileStatus;

		const canRefreshPairing = (status: IVectorCodeMobileConnectionStatus): boolean => {
			return hasVectorCodeRuntimeCapability(status.runtime, VECTOR_CODE_MOBILE_CAPABILITY_PAIR)
				&& !status.requiresRelayIssuerToken;
		};

		const updateStartButton = (status: IVectorCodeMobileConnectionStatus, busy = false): void => {
			setVisibility(Boolean(status.requiresRelayIssuerToken), configureButton);
			configureButton.disabled = busy || !hasVectorCodeRuntimeCapability(status.runtime, VECTOR_CODE_MOBILE_CAPABILITY_CONFIGURE);
			setVisibility(!status.requiresRelayIssuerToken, startButton);
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

		const createPairing = async (notifyOnError: boolean, relayIssuerToken?: string): Promise<void> => {
			if (!relayIssuerToken && !canRefreshPairing(currentStatus)) {
				return;
			}
			renderBusy();
			try {
				renderStatus(await this.mobileRelayService.startPairing(undefined, relayIssuerToken));
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

		const configureRelay = async (): Promise<void> => {
			const relayIssuerToken = await this.quickInputService.input({
				title: localize('vectorCodeMobileConfigureRelayTitle', 'Configure Secure Phone Connection'),
				prompt: localize('vectorCodeMobileConfigureRelayPrompt', 'Enter the relay issuer token. It will be stored securely on this desktop.'),
				placeHolder: localize('vectorCodeMobileConfigureRelayPlaceholder', 'Relay issuer token'),
				password: true,
				ignoreFocusLost: true,
				validateInput: async value => value.trim() ? undefined : localize('vectorCodeMobileConfigureRelayRequired', 'Enter a relay issuer token.')
			});
			if (relayIssuerToken === undefined) {
				return;
			}
			await createPairing(true, relayIssuerToken);
		};

		renderStatus(mobileStatus);
		this._register(this.mobileRelayService.onDidChangeStatus(renderStatus));
		this._register(addDisposableListener(diagnosticsButton, EventType.CLICK, () => {
			void this.dialogService.info(
				localize('vectorCodeMobileDiagnosticTitle', 'Phone Bridge diagnostics'),
				formatVectorCodeRuntimeDiagnosticSummary(this.mobileRelayService.getDiagnosticSummary()),
			);
		}));
		if (mobileStatus.state === VectorCodeMobileConnectionState.Disconnected && !mobileStatus.pairing) {
			void createPairing(false);
		}
		this._register(addDisposableListener(startButton, EventType.CLICK, () => {
			void createPairing(true);
		}));
		this._register(addDisposableListener(configureButton, EventType.CLICK, () => {
			void configureRelay();
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
const explorerViewContainer = viewContainersRegistry.registerViewContainer({
	id: 'vectorCode.workspace', title: localize2('workspaceNavigation', 'Workspace'), icon: Codicon.home,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['vectorCode.workspace', { mergeViewWithContainerWhenSingleView: true }]),
	storageId: 'vectorCode.workspace', order: 0
}, ViewContainerLocation.Sidebar, { isDefault: true });

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

registerWorkbenchContribution2(VectorCodeProjectContribution.ID, VectorCodeProjectContribution, WorkbenchPhase.AfterRestored);
