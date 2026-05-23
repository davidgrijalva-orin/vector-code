/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';
import { DEBUG_CONFIGURE_COMMAND_ID, DEBUG_START_COMMAND_ID } from './debugCommands.js';

export class WelcomeView extends ViewPane {

	static readonly ID = 'workbench.debug.welcome';
	static readonly LABEL: ILocalizedString = localize2('run', "Run");

	private welcomeContainer: HTMLElement | undefined;
	private readonly bodyDisposables = new DisposableStore();
	private readonly debugKeybindingLabel: string;

	constructor(
		options: IViewletViewOptions,
		@IThemeService themeService: IThemeService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this.bodyDisposables);
		this.debugKeybindingLabel = keybindingService.appendKeybinding('', DEBUG_START_COMMAND_ID);
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this.renderWelcome()));
	}

	protected override renderBody(container: HTMLElement): void {
		container.classList.add('vector-debug-welcome-view');
		this.welcomeContainer = append(container, $('.vector-debug-welcome'));
		this.renderWelcome();
	}

	override shouldShowWelcome(): boolean {
		return false;
	}

	private renderWelcome(): void {
		if (!this.welcomeContainer) {
			return;
		}

		this.bodyDisposables.clear();
		clearNode(this.welcomeContainer);
		const hasProject = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY;

		const card = append(this.welcomeContainer, $('.vector-debug-card'));
		const header = append(card, $('.vector-debug-card__header'));
		const mark = append(header, $('.vector-debug-card__mark'));
		mark.classList.add(...ThemeIcon.asClassNameArray(Codicon.debugAlt));

		const headerText = append(header, $('.vector-debug-card__header-text'));
		const eyebrow = append(headerText, $('.vector-debug-card__eyebrow'));
		eyebrow.textContent = localize('vectorRunEyebrow', 'Run');
		const title = append(headerText, $('.vector-debug-card__title'));
		title.textContent = hasProject ? localize('vectorRunProjectExecution', 'Project Execution') : localize('vectorRunNoProject', 'No Project Selected');

		const copy = append(card, $('.vector-debug-card__copy'));
		copy.textContent = hasProject
			? localize('vectorRunReadyCopy', 'Start the active project or create a run profile for repeatable workflows.')
			: localize('vectorRunNoProjectCopy', 'Add a project from Files before creating run profiles.');

		const actions = append(card, $('.vector-debug-card__actions'));
		if (hasProject) {
			this.renderAction(actions, localize('vectorRunStart', 'Start'), Codicon.debugStart, DEBUG_START_COMMAND_ID, true);
			this.renderAction(actions, localize('vectorRunProfile', 'Profile'), Codicon.settingsGear, DEBUG_CONFIGURE_COMMAND_ID, false, { addNew: true });
		} else {
			this.renderAction(actions, localize('vectorRunFiles', 'Files'), Codicon.files, EXPLORER_VIEWLET_ID, true);
		}

		const hint = append(card, $('.vector-debug-card__hint'));
		hint.textContent = hasProject && this.debugKeybindingLabel
			? localize('vectorRunKeybindingHint', 'Start shortcut: {0}', this.debugKeybindingLabel.trim())
			: localize('vectorRunProjectScopedHint', 'Run state follows the active project.');
	}

	private renderAction(container: HTMLElement, label: string, icon: ThemeIcon, commandId: string, primary: boolean, ...args: unknown[]): void {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = primary ? 'vector-debug-card__button vector-debug-card__button--primary' : 'vector-debug-card__button';
		button.setAttribute('aria-label', label);

		const iconNode = append(button, $('.vector-debug-card__button-icon'));
		iconNode.classList.add(...ThemeIcon.asClassNameArray(icon));
		const labelNode = append(button, $('.vector-debug-card__button-label'));
		labelNode.textContent = label;

		container.appendChild(button);
		this.bodyDisposables.add(addDisposableListener(button, EventType.CLICK, () => {
			void this.commandService.executeCommand(commandId, ...args);
		}));
	}
}
