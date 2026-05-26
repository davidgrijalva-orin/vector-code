/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
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
	IVectorCodeWorkbenchService,
	VECTOR_CODE_ADD_PROJECT_COMMAND_ID,
	VECTOR_CODE_CONTROL_VIEW_ID,
	VECTOR_CODE_PROJECTS_VIEW_ID,
	VECTOR_CODE_VIEW_CONTAINER_ID,
	VectorCodeMobileConnectionState
} from '../common/vectorCode.js';
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

	protected static override readonly viewOptions = { minimumBodySize: 76, maximumBodySize: 124 };
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
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(updateProjects));
		this._register(this.vectorCodeWorkbenchService.onDidChangeActiveProject(updateProjects));
	}

	private renderProjectList(container: HTMLElement, disposables: DisposableStore): void {
		disposables.clear();
		clearNode(container);
		const projects = this.vectorCodeWorkbenchService.getProjectSummaries();
		if (!projects.length) {
			void this.vectorCodeWorkbenchService.switchProject(undefined);
			const empty = append(container, $('.vector-code-project-switcher__empty'));
			empty.textContent = localize('vectorCodeProjectsListEmpty', 'Add a project to populate the file tree.');
			return;
		}

		let activeProjectUri = this.vectorCodeWorkbenchService.getActiveProjectUri()?.toString();
		if (!activeProjectUri || !projects.some(project => project.uri.toString() === activeProjectUri)) {
			activeProjectUri = projects[0].uri.toString();
			void this.vectorCodeWorkbenchService.switchProject(projects[0].uri);
		}

		for (const project of projects) {
			const projectUri = project.uri.toString();
			const item = document.createElement('button');
			item.className = 'vector-code-project-switcher__project';
			item.classList.toggle('vector-code-project-switcher__project--active', projectUri === activeProjectUri);
			item.type = 'button';
			const name = append(item, $('.vector-code-project-switcher__project-name'));
			name.textContent = project.name;
			const path = append(item, $('.vector-code-project-switcher__project-path'));
			path.textContent = project.uriLabel;
			path.title = project.uriLabel;
			container.appendChild(item);

			disposables.add(addDisposableListener(item, EventType.CLICK, () => {
				void this.vectorCodeWorkbenchService.switchProject(project.uri);
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
