/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, clearNode, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IVectorGraphService, IVectorGraphBinding, IVectorGraphTicket, filterVectorGraphTickets } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IVectorCodeWorkbenchService, VECTOR_CODE_ADD_PROJECT_COMMAND_ID } from '../common/vectorCode.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { VectorCodeProjectSwitcher } from './vectorCodeProjectSwitcher.js';
import { VectorGraphTicketInput } from './vectorGraphTicketEditor.js';
import './media/vectorGraphTickets.css';

const VIEW_ID = 'vectorCode.vectorGraphTickets';
const BINDING_KEY = 'vectorCode.vectorGraph.binding.';
const icon = registerIcon('vector-code-tickets', Codicon.issues, localize('vectorGraphTicketsIcon', 'VectorGraph tickets.'));

class VectorGraphTicketsView extends ViewPane {
	private root!: HTMLElement;
	private status!: HTMLElement;
	private list!: HTMLElement;
	private search!: HTMLInputElement;
	private category!: HTMLSelectElement;
	private configureButton!: HTMLButtonElement;
	private refreshButton!: HTMLButtonElement;
	private moreButton!: HTMLButtonElement;
	private readonly listDisposables = this._register(new DisposableStore());
	private tickets: readonly IVectorGraphTicket[] = [];
	private cursor: string | undefined;
	private generation = 0;
	private projectGeneration = 0;
	private loading = false;
	private configuring = false;
	private ticketButtons: HTMLButtonElement[] = [];
	private selectedIdentifier: string | undefined;

	constructor(
		options: IViewletViewOptions,
		@IVectorGraphService private readonly graph: IVectorGraphService,
		@IVectorCodeWorkbenchService private readonly projects: IVectorCodeWorkbenchService,
		@IStorageService private readonly storage: IStorageService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@IEditorService private readonly editors: IEditorService,
		@ICommandService private readonly commands: ICommandService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@INotificationService private readonly notifications: INotificationService,
		@IKeybindingService keybindings: IKeybindingService,
		@IContextMenuService contextMenus: IContextMenuService,
		@IConfigurationService configuration: IConfigurationService,
		@IContextKeyService contextKeys: IContextKeyService,
		@IViewDescriptorService descriptors: IViewDescriptorService,
		@IInstantiationService instantiation: IInstantiationService,
		@IOpenerService opener: IOpenerService,
		@IThemeService theme: IThemeService,
		@IHoverService hover: IHoverService,
	) {
		super(options, keybindings, contextMenus, configuration, contextKeys, descriptors, instantiation, opener, theme, hover);
		this._register(projects.onDidChangeActiveProject(() => {
			this.generation++;
			this.projectGeneration++;
			this.selectedIdentifier = undefined;
			this.tickets = [];
			this.cursor = undefined;
			this.loading = false;
			if (this.root) {
				this.search.value = '';
				this.category.value = '';
				this.renderTickets();
				if (this.isBodyVisible()) { void this.refresh(); }
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.root = append(container, $('.vector-graph-tickets'));
		append(this.root, $('.vector-graph-tickets__heading')).textContent = localize('ticketsProjects', 'Projects');
		const switcher = this._register(new VectorCodeProjectSwitcher(this.root, {
			add: () => this.commands.executeCommand(VECTOR_CODE_ADD_PROJECT_COMMAND_ID),
			select: project => this.projects.switchProject(project.uri),
			close: project => this.projects.closeProject(project.uri),
			onError: error => this.notifications.error(error)
		}));
		const updateProjects = () => switcher.update(this.projects.getProjectSummaries(), this.projects.getActiveProjectUri(), this.projects.getProjectStatusLabel());
		updateProjects();
		this._register(this.workspace.onDidChangeWorkspaceFolders(updateProjects));
		this._register(this.projects.onDidChangeActiveProject(updateProjects));
		append(this.root, $('.vector-graph-tickets__heading')).textContent = localize('ticketsHeading', 'VectorGraph Tickets');
		const toolbar = append(this.root, $('.vector-graph-tickets__toolbar'));
		this.configureButton = this.button(toolbar, localize('vectorGraphConnect', 'Choose Workspace'), () => this.configure());
		this.refreshButton = this.button(toolbar, localize('vectorGraphRefresh', 'Refresh'), () => this.refresh());
		this.status = append(this.root, $('.vector-graph-tickets__status'));
		this.status.setAttribute('role', 'status');
		this.search = append(this.root, $<HTMLInputElement>('input.vector-graph-tickets__search'));
		this.search.type = 'search';
		this.search.placeholder = localize('vectorGraphSearch', 'Search loaded tickets');
		this.search.setAttribute('aria-label', this.search.placeholder);
		this.category = append(this.root, $<HTMLSelectElement>('select.vector-graph-tickets__filter'));
		this.category.setAttribute('aria-label', localize('vectorGraphStatusFilter', 'Filter tickets by status'));
		for (const [value, label] of [
			['', localize('vectorGraphAll', 'All statuses')], ['unstarted', localize('vectorGraphTodo', 'Todo')],
			['started', localize('vectorGraphStarted', 'In Progress')], ['completed', localize('vectorGraphDone', 'Done')],
			['backlog', localize('vectorGraphBacklog', 'Backlog')], ['triage', localize('vectorGraphTriage', 'Triage')], ['canceled', localize('vectorGraphCanceled', 'Canceled')]
		]) {
			const option = append(this.category, $<HTMLOptionElement>('option'));
			option.value = value;
			option.textContent = label;
		}
		this._register(addDisposableListener(this.search, EventType.INPUT, () => this.renderTickets()));
		this._register(addDisposableListener(this.category, EventType.CHANGE, () => this.renderTickets()));
		this.list = append(this.root, $('.vector-graph-tickets__list'));
		this.list.setAttribute('role', 'list');
		this.list.setAttribute('aria-label', localize('vectorGraphTicketList', 'VectorGraph tickets'));
		this._register(addDisposableListener(this.list, EventType.KEY_DOWN, event => {
			const buttons = this.ticketButtons;
			const index = buttons.indexOf(this.list.ownerDocument.activeElement as HTMLButtonElement);
			const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
			if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
		}));
		this.moreButton = this.button(this.root, localize('vectorGraphMore', 'Load more tickets'), () => this.refresh(true));
		this._register(this.onDidChangeBodyVisibility(visible => { if (visible) { void this.refresh(); } }));
		void this.refresh();
	}

	private projectKey(): string | undefined { return this.projects.getActiveProjectUri()?.toString(); }
	private binding(): IVectorGraphBinding | undefined {
		const key = this.projectKey();
		if (!key) { return undefined; }
		const binding = this.storage.getObject<IVectorGraphBinding>(BINDING_KEY + key, StorageScope.PROFILE);
		return binding && typeof binding.workspace?.id === 'string' && typeof binding.workspace.name === 'string' && typeof binding.team?.id === 'string' && typeof binding.team.name === 'string' ? binding : undefined;
	}

	private async configure(): Promise<void> {
		const project = this.projectKey();
		const projectGeneration = this.projectGeneration;
		if (!project || this.configuring) { return; }
		this.configuring = true;
		this.configureButton.disabled = true;
		try {
			const workspaces = await this.graph.listWorkspaces();
			if (!workspaces.length) { throw new Error(localize('vectorGraphSignIn', 'Sign in with vectorgraph auth login, then choose a workspace.')); }
			const workspace = await this.quickInput.pick(workspaces.map(value => ({ label: value.name, description: value.id, value })), { placeHolder: localize('vectorGraphChooseWorkspace', 'Choose the VectorGraph workspace for this project') });
			if (!workspace || project !== this.projectKey() || projectGeneration !== this.projectGeneration || this._store.isDisposed) { return; }
			const teams = await this.graph.listTeams(workspace.value.id);
			if (!teams.length) { throw new Error(localize('vectorGraphNoTeams', 'No teams are accessible in this workspace. Check your VectorGraph access.')); }
			const team = await this.quickInput.pick(teams.map(value => ({ label: value.name, description: value.identifier, value })), { placeHolder: localize('vectorGraphChooseTeam', 'Choose the team whose tickets belong to this project') });
			if (!team || project !== this.projectKey() || projectGeneration !== this.projectGeneration || this._store.isDisposed) { return; }
			this.selectedIdentifier = undefined;
			this.storage.store(BINDING_KEY + project, { workspace: workspace.value, team: team.value }, StorageScope.PROFILE, StorageTarget.MACHINE);
			await this.refresh();
		} catch (error) {
			if (project === this.projectKey() && projectGeneration === this.projectGeneration && !this._store.isDisposed) { this.status.textContent = toErrorMessage(error); }
		} finally {
			this.configuring = false;
			if (!this._store.isDisposed) { this.configureButton.disabled = !this.projectKey(); }
		}
	}

	private async refresh(more = false): Promise<void> {
		if (more && (this.loading || !this.cursor)) { return; }
		const generation = ++this.generation;
		const binding = this.binding();
		if (!more) { this.tickets = []; this.cursor = undefined; }
		this.configureButton.disabled = !this.projectKey() || this.configuring;
		if (!binding) {
			this.loading = false;
			this.status.textContent = this.projectKey() ? localize('vectorGraphBind', 'Choose a workspace and team to see tickets for this project.') : localize('vectorGraphOpenProject', 'Open a project to view its VectorGraph tickets.');
			this.renderTickets();
			return;
		}
		this.loading = true;
		this.status.textContent = localize('vectorGraphLoading', 'Loading {0} / {1}…', binding.workspace.name, binding.team.name);
		this.renderTickets();
		try {
			const page = await this.graph.listTickets(binding.workspace.id, binding.team.id, more ? this.cursor : undefined);
			if (generation !== this.generation || this._store.isDisposed) { return; }
			if (page.nextCursor && page.nextCursor === this.cursor) { throw new Error(localize('vectorGraphRepeatedCursor', 'VectorGraph returned the same page. Refresh to retry.')); }
			this.tickets = [...new Map([...this.tickets, ...page.tickets].map(ticket => [ticket.identifier, ticket])).values()];
			this.cursor = page.nextCursor;
			this.status.textContent = localize('vectorGraphLoaded', '{0} / {1} · {2} tickets loaded', binding.workspace.name, binding.team.name, this.tickets.length);
		} catch (error) {
			if (generation === this.generation && !this._store.isDisposed) { this.status.textContent = toErrorMessage(error); }
		} finally {
			if (generation === this.generation && !this._store.isDisposed) {
				this.loading = false;
				this.renderTickets();
			}
		}
	}

	private renderTickets(): void {
		const focused = this.list.ownerDocument.activeElement;
		const focusedId = this.list.contains(focused) ? focused?.getAttribute('data-ticket') : undefined;
		this.listDisposables.clear();
		clearNode(this.list);
		this.ticketButtons = [];
		const binding = this.binding();
		const visible = filterVectorGraphTickets(this.tickets, this.search.value, this.category.value);
		for (const ticket of visible) {
			const item = append(this.list, $('.vector-graph-tickets__item'));
			item.setAttribute('role', 'listitem');
			const button = append(item, $<HTMLButtonElement>('button.vector-graph-tickets__ticket'));
			button.type = 'button';
			this.ticketButtons.push(button);
			button.setAttribute('data-ticket', ticket.identifier);
			button.classList.toggle('selected', ticket.identifier === this.selectedIdentifier);
			button.setAttribute('aria-pressed', String(ticket.identifier === this.selectedIdentifier));
			append(button, $('.vector-graph-tickets__identifier')).textContent = `${ticket.identifier} · ${ticket.status}`;
			append(button, $('.vector-graph-tickets__title')).textContent = ticket.title;
			append(button, $('.vector-graph-tickets__meta')).textContent = [ticket.priority, ticket.project].filter(Boolean).join(' · ');
			this.listDisposables.add(addDisposableListener(button, EventType.CLICK, () => { if (binding) { void this.openTicket(binding, ticket); } }));
			if (focusedId === ticket.identifier) { button.focus(); }
		}
		if (!visible.length && !this.loading && binding) {
			append(this.list, $('.vector-graph-tickets__empty')).textContent = this.tickets.length ? localize('vectorGraphNoMatch', 'No loaded tickets match these filters.') : localize('vectorGraphNoTickets', 'No tickets to show. Refresh to check again.');
		}
		this.list.setAttribute('aria-busy', String(this.loading));
		this.moreButton.hidden = !this.cursor;
		this.moreButton.disabled = this.loading;
		this.refreshButton.disabled = this.loading || !binding;
	}

	private async openTicket(binding: IVectorGraphBinding, ticket: IVectorGraphTicket): Promise<void> {
		try {
			this.selectedIdentifier = ticket.identifier;
			this.renderTickets();
			await this.editors.openEditor(new VectorGraphTicketInput(binding.workspace.id, ticket.identifier), { pinned: true });
		} catch (error) {
			if (!this._store.isDisposed) { this.notifications.error(toErrorMessage(error)); }
		}
	}

	private button(container: HTMLElement, label: string, action: () => Promise<void>): HTMLButtonElement {
		const button = append(container, $<HTMLButtonElement>('button.vector-graph-tickets__action'));
		button.type = 'button';
		button.textContent = label;
		this._register(addDisposableListener(button, EventType.CLICK, () => { void action(); }));
		return button;
	}

	override focus(): void { super.focus(); (this.search ?? this.configureButton)?.focus(); }
	override dispose(): void { this.generation++; super.dispose(); }
}

const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: VIEW_ID, title: localize2('vectorGraphTickets', 'Tickets'), icon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: VIEW_ID, order: 2,
	openCommandActionDescriptor: { id: VIEW_ID, mnemonicTitle: localize('vectorGraphOpenTickets', '&&Tickets'), order: 2 }
}, ViewContainerLocation.Sidebar);
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: VIEW_ID + '.list', name: localize2('vectorGraphTicketView', 'VectorGraph Tickets'), containerIcon: icon,
	canToggleVisibility: false, canMoveView: true, ctorDescriptor: new SyncDescriptor(VectorGraphTicketsView)
}], container);
