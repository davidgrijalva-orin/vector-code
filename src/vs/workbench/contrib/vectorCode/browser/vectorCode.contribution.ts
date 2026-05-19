/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
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
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';
import {
	IVectorCodeWorkbenchService,
	VECTOR_CODE_ADD_PROJECT_COMMAND_ID,
	VECTOR_CODE_CONNECT_MOBILE_COMMAND_ID,
	VECTOR_CODE_CONTROL_VIEW_ID,
	VECTOR_CODE_OPEN_PROJECT_TERMINAL_COMMAND_ID,
	VECTOR_CODE_SEND_SELECTION_TO_TERMINAL_COMMAND_ID,
	VECTOR_CODE_VIEW_CONTAINER_ID
} from '../common/vectorCode.js';
import './vectorCodeActions.js';
import './vectorCodeService.js';
import './media/vectorCode.css';

const vectorCodeIcon = registerIcon('vector-code-view-icon', Codicon.sparkle, localize('vectorCodeViewIcon', 'View icon of the Vector Code view.'));

interface IVectorCodeControlAction {
	readonly label: string;
	readonly commandId: string;
}

interface IVectorCodeStatusCard {
	readonly card: HTMLElement;
	readonly status: HTMLElement;
}

class VectorCodeControlView extends ViewPane {

	constructor(
		options: IViewletViewOptions,
		@ICommandService private readonly commandService: ICommandService,
		@IVectorCodeWorkbenchService private readonly vectorCodeWorkbenchService: IVectorCodeWorkbenchService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
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
		super({ ...options, titleMenuId: MenuId.ViewTitle }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('vector-code-control-view');

		const root = append(container, $('.vector-code-control'));
		const heading = append(root, $('.vector-code-control__heading'));
		heading.textContent = localize('vectorCodeControlHeading', 'Vector Code');

		const subheading = append(root, $('.vector-code-control__subheading'));
		subheading.textContent = localize('vectorCodeControlSubheading', 'Native workbench surface for projects, terminals, agents, and mobile continuity');

		const grid = append(root, $('.vector-code-control__grid'));
		const projects = this.renderStatusCard(grid, localize('vectorCodeProjects', 'Projects'), this.vectorCodeWorkbenchService.getProjectStatusLabel(), [
			{ label: localize('vectorCodeAddProject', 'Add Project'), commandId: VECTOR_CODE_ADD_PROJECT_COMMAND_ID },
			{ label: localize('vectorCodeOpenExplorer', 'Open Explorer'), commandId: EXPLORER_VIEWLET_ID }
		]);
		const projectList = append(projects.card, $('.vector-code-control__project-list'));
		const updateProjects = () => {
			projects.status.textContent = this.vectorCodeWorkbenchService.getProjectStatusLabel();
			this.renderProjectList(projectList);
		};
		updateProjects();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(updateProjects));

		this.renderStatusCard(grid, localize('vectorCodeTerminalRouting', 'Terminal Routing'), localize('vectorCodeTerminalRoutingState', 'Selection and current-line routing uses the native terminal service'), [
			{ label: localize('vectorCodeSendSelection', 'Send Selection or Line'), commandId: VECTOR_CODE_SEND_SELECTION_TO_TERMINAL_COMMAND_ID },
			{ label: localize('vectorCodeOpenProjectTerminal', 'Project Terminal'), commandId: VECTOR_CODE_OPEN_PROJECT_TERMINAL_COMMAND_ID }
		]);
		this.renderStatusCard(grid, localize('vectorCodeMobile', 'Mobile Connection'), localize('vectorCodeMobileState', 'Native relay adapter pending'), [
			{ label: localize('vectorCodeConnectMobile', 'Connect Mobile'), commandId: VECTOR_CODE_CONNECT_MOBILE_COMMAND_ID }
		]);
		this.renderStatusCard(grid, localize('vectorCodeAgents', 'Agent Sessions'), localize('vectorCodeAgentsState', 'Runtime adapter pending'));
		this.renderStatusCard(grid, localize('vectorCodeVerification', 'Verification'), localize('vectorCodeVerificationState', 'Check ledger pending'));
	}

	private renderProjectList(container: HTMLElement): void {
		clearNode(container);
		const projects = this.vectorCodeWorkbenchService.getProjectSummaries();
		if (!projects.length) {
			const empty = append(container, $('.vector-code-control__project-empty'));
			empty.textContent = localize('vectorCodeProjectsListEmpty', 'Explorer will show projects after folders are added.');
			return;
		}

		for (const project of projects) {
			const item = append(container, $('.vector-code-control__project'));
			const name = append(item, $('.vector-code-control__project-name'));
			name.textContent = project.name;
			const path = append(item, $('.vector-code-control__project-path'));
			path.textContent = project.uriLabel;
			path.title = project.uriLabel;
		}
	}

	private renderStatusCard(container: HTMLElement, title: string, status: string, actions: readonly IVectorCodeControlAction[] = []): IVectorCodeStatusCard {
		const card = append(container, $('.vector-code-control__card'));
		const cardTitle = append(card, $('.vector-code-control__card-title'));
		cardTitle.textContent = title;
		const cardStatus = append(card, $('.vector-code-control__card-status'));
		cardStatus.textContent = status;

		if (actions.length) {
			const cardActions = append(card, $('.vector-code-control__card-actions'));
			for (const action of actions) {
				this.renderCommandButton(cardActions, action);
			}
		}

		return { card, status: cardStatus };
	}

	private renderCommandButton(container: HTMLElement, action: IVectorCodeControlAction): void {
		const button = document.createElement('button');
		button.className = 'vector-code-control__button';
		button.type = 'button';
		button.textContent = action.label;
		container.appendChild(button);

		this._register(addDisposableListener(button, EventType.CLICK, () => {
			void this.commandService.executeCommand(action.commandId);
		}));
	}
}

const vectorCodeViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: VECTOR_CODE_VIEW_CONTAINER_ID,
	title: localize2('vectorCode', 'Vector Code'),
	icon: vectorCodeIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VECTOR_CODE_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: VECTOR_CODE_VIEW_CONTAINER_ID,
	order: 1,
	openCommandActionDescriptor: {
		id: VECTOR_CODE_VIEW_CONTAINER_ID,
		mnemonicTitle: localize({ key: 'miViewVectorCode', comment: ['&& denotes a mnemonic'] }, '&&Vector Code'),
		order: 1,
	},
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: VECTOR_CODE_CONTROL_VIEW_ID,
	name: localize2('vectorCodeControl', 'Control'),
	containerIcon: vectorCodeIcon,
	canToggleVisibility: false,
	canMoveView: false,
	ctorDescriptor: new SyncDescriptor(VectorCodeControlView),
	order: 1,
}], vectorCodeViewContainer);
