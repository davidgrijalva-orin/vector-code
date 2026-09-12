/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, clearNode, EventType } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
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
import { IVectorGraphService, IVectorGraphBinding, IVectorGraphTicket, IVectorGraphSession, isVectorGraphConnectionError, filterVectorGraphTickets } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, Extensions as ViewExtensions } from '../../../common/views.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IVectorGraphWorkService, VECTOR_GRAPH_DETAILS_VIEW } from '../common/vectorGraphWork.js';
import './vectorGraphDetails.contribution.js';
import './vectorGraphDocuments.contribution.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { VECTOR_GRAPH_BINDING_KEY as BINDING_KEY, readVectorGraphBinding } from '../common/vectorGraphBinding.js';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';
import './media/vectorGraphTickets.css';

const VIEW_ID = 'vectorCode.vectorGraphTickets';
const icon = registerIcon('vector-code-tickets', Codicon.issues, localize('vectorGraphTicketsIcon', 'VectorGraph tickets.'));

export class VectorGraphTicketsView extends ViewPane {
	private scope!: HTMLSelectElement;
	private assignee!: HTMLSelectElement;
	private activeWork!: HTMLElement;
	private metadataKey: string | undefined;
	private session: IVectorGraphSession = { workspaces: [] };
	private account!: HTMLElement;
	private signInButton!: HTMLButtonElement;
	private signOutButton!: HTMLButtonElement;
	private signingIn = false;
	private pollFailures = 0;
	private readonly pollTimer = this._register(new MutableDisposable());
	private discoveryProject: string | undefined;
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
		@IViewsService private readonly views: IViewsService,
		@IVectorGraphWorkService private readonly work: IVectorGraphWorkService,
		@INotificationService private readonly notifications: INotificationService,
		@IKeybindingService keybindings: IKeybindingService,
		@IContextMenuService contextMenus: IContextMenuService,
		@IConfigurationService configuration: IConfigurationService,
		@IContextKeyService contextKeys: IContextKeyService,
		@IViewDescriptorService descriptors: IViewDescriptorService,
		@IInstantiationService instantiation: IInstantiationService,
		@IOpenerService private readonly graphOpener: IOpenerService,
		@IThemeService theme: IThemeService,
		@IHoverService hover: IHoverService,
	) {
		super(options, keybindings, contextMenus, configuration, contextKeys, descriptors, instantiation, graphOpener, theme, hover);
		this._register(graph.onDidChangeTickets(event => { if (this.root && event.workspace === this.binding()?.workspace.id) { void this.refresh(); } }));
		this._register(work.onDidChange(() => { if (this.root) { this.renderActiveWork(); } }));
		this._register(graph.onDidChangeSession(() => {
			this.generation++;
			this.discoveryProject = undefined;
			if (this.root) { void this.refresh(); }
		}));
		this._register(projects.onDidChangeActiveProject(() => {
			this.generation++;
			this.projectGeneration++;
			this.selectedIdentifier = undefined;
			this.tickets = [];
			this.cursor = undefined;
			this.loading = false;
			if (this.root) {
				this.search.value = '';
				this.category.value = ''; this.scope.value = 'project'; this.assignee.value = ''; this.metadataKey = undefined;
				this.renderTickets();
				if (this.isBodyVisible()) { void this.refresh(); }
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.root = append(container, $('.vector-graph-tickets'));
		this.account = append(this.root, $('.vector-graph-tickets__account'));
		const accountActions = append(this.root, $('.vector-graph-tickets__toolbar'));
		this.signInButton = this.button(accountActions, localize('vectorGraphSignInAction', 'Sign in to VectorGraph'), () => this.signIn());
		this.signOutButton = this.button(accountActions, localize('vectorGraphSignOutAction', 'Sign Out'), async () => {
			this.pollTimer.clear();
			if (this.session.authorization) { await this.graph.cancelSignIn(); } else { await this.graph.signOut(); }
		});
		const toolbar = append(this.root, $('.vector-graph-tickets__toolbar'));
		this.configureButton = this.button(toolbar, localize('vectorGraphConnect', 'Choose Workspace'), () => this.configure());
		this.button(toolbar, localize('vectorGraphChooseProject', 'Choose Project'), () => this.chooseProject());
		this.button(toolbar, localize('vectorGraphNewTicket', 'New Ticket'), () => this.newTicket());
		this.button(toolbar, localize('workDocuments', 'Documents'), () => this.instantiationService.invokeFunction(accessor => accessor.get(ICommandService).executeCommand('vectorCode.openDocuments')));
		this.button(toolbar, localize('workNewDocument', 'New Document'), () => this.instantiationService.invokeFunction(accessor => accessor.get(ICommandService).executeCommand('vectorCode.newDocument')));
		this.refreshButton = this.button(toolbar, localize('vectorGraphRefresh', 'Refresh'), () => { this.discoveryProject = undefined; return this.refresh(); });
		this.activeWork = append(this.root, $('.vector-graph-active-work'));
		this.scope = append(this.root, $<HTMLSelectElement>('select')); this.scope.setAttribute('aria-label', localize('workTicketScope', 'Ticket scope'));
		for (const [value, title] of [['project', localize('workLinkedProject', 'Linked project')], ['team', localize('workWholeTeam', 'Whole team')]]) { const option = append(this.scope, $<HTMLOptionElement>('option')); option.value = value; option.textContent = title; }
		this.assignee = append(this.root, $<HTMLSelectElement>('select')); this.assignee.setAttribute('aria-label', localize('workAssigneeFilter', 'Filter by assignee'));
		const all = append(this.assignee, $<HTMLOptionElement>('option')); all.value = ''; all.textContent = localize('workAllAssignees', 'All assignees');
		for (const control of [this.scope, this.assignee]) { this._register(addDisposableListener(control, EventType.CHANGE, () => { void this.refresh(); })); }
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

	private renderAccount(): void {
		this.account.textContent = this.session.authorization
			? localize('vectorGraphApproving', 'Approve in your browser · {0}', this.session.authorization.code)
			: this.session.workspaces.length ? localize('vectorGraphConnected', 'VectorGraph · Connected') : localize('vectorGraphDisconnected', 'VectorGraph · Not signed in');
		this.signInButton.textContent = this.session.authorization ? localize('vectorGraphContinueSignIn', 'Open Sign-in Page') : this.session.workspaces.length ? localize('vectorGraphReconnect', 'Reconnect') : localize('vectorGraphSignInAction', 'Sign in to VectorGraph');
		this.signOutButton.hidden = !this.session.workspaces.length && !this.session.authorization;
		this.signOutButton.textContent = this.session.authorization ? localize('vectorGraphCancelSignIn', 'Cancel Sign-in') : localize('vectorGraphSignOutAction', 'Sign Out');
		this.configureButton.disabled = !this.projectKey() || this.configuring || !this.session.workspaces.length;
		if (this.session.authorization) { this.schedulePoll(); }
	}
	private async signIn(): Promise<void> {
		if (this.signingIn) { return; }
		this.signingIn = true;
		this.pollFailures = 0;
		this.signInButton.disabled = true;
		try {
			const session = this.session.authorization ? this.session : await this.graph.beginSignIn();
			if (this._store.isDisposed) { return; }
			this.session = session;
			this.renderAccount();
			if (session.authorization) { await this.graphOpener.open(session.authorization.url, { openExternal: true, skipValidation: true, allowContributedOpeners: false }); }
		} catch (error) { this.notifications.error(error); }
		finally { this.signingIn = false; if (!this._store.isDisposed) { this.signInButton.disabled = false; } }
	}
	private schedulePoll(): void {
		this.pollTimer.value = disposableTimeout(async () => {
			try {
				const session = await this.graph.pollSignIn();
				this.pollFailures = 0;
				if (this._store.isDisposed) { return; }
				this.session = session;
				this.renderAccount();
			} catch (error) {
				if (this._store.isDisposed) { return; }
				this.status.textContent = toErrorMessage(error);
				if (isVectorGraphConnectionError(error) && ++this.pollFailures < 5 && this.session.authorization && Date.now() < this.session.authorization.expiresAt) { this.schedulePoll(); }
			}
		}, 2000);
	}

	private projectKey(): string | undefined { return this.projects.getActiveProjectUri()?.toString(); }
	private binding(): IVectorGraphBinding | undefined { return readVectorGraphBinding(this.storage, this.projectKey()); }

	private async configure(): Promise<void> {
		const project = this.projectKey();
		const projectGeneration = this.projectGeneration;
		if (!project || this.configuring) { return; }
		this.configuring = true;
		this.configureButton.disabled = true;
		try {
			const workspaces = await this.graph.listWorkspaces();
			if (!workspaces.length) { await this.signIn(); return; }
			const workspace = await this.quickInput.pick(workspaces.map(value => ({ label: value.name, description: value.id, value })), { placeHolder: localize('vectorGraphChooseWorkspace', 'Choose the VectorGraph workspace for this project') });
			if (!workspace || project !== this.projectKey() || projectGeneration !== this.projectGeneration || this._store.isDisposed) { return; }
			const teams = await this.graph.listTeams(workspace.value.id);
			if (!teams.length) { throw new Error(localize('vectorGraphNoTeams', 'No teams are accessible in this workspace. Check your VectorGraph access.')); }
			const team = await this.quickInput.pick(teams.map(value => ({ label: value.name, description: value.identifier, value })), { placeHolder: localize('vectorGraphChooseTeam', 'Choose the team whose tickets belong to this project') });
			if (!team || project !== this.projectKey() || projectGeneration !== this.projectGeneration || this._store.isDisposed) { return; }
			this.selectedIdentifier = undefined;
			this.storage.store(BINDING_KEY + project, { workspace: workspace.value, team: team.value }, StorageScope.PROFILE, StorageTarget.MACHINE);
			this.invalidateBinding(project);
			await this.refresh();
			await this.chooseProject();
		} catch (error) {
			if (project === this.projectKey() && projectGeneration === this.projectGeneration && !this._store.isDisposed) { this.status.textContent = toErrorMessage(error); }
		} finally {
			this.configuring = false;
			if (!this._store.isDisposed) { this.configureButton.disabled = !this.projectKey(); }
		}
	}

	private invalidateBinding(project: string): void {
		this.generation++; this.tickets = []; this.cursor = undefined; this.selectedIdentifier = undefined;
		this.work.select(undefined); this.work.setActive(project, undefined);
		this.metadataKey = undefined; this.assignee.value = ''; this.scope.value = 'project';
		this.renderTickets(); this.renderActiveWork();
	}
	private async chooseProject(): Promise<void> {
		const project = this.projectKey(); const generation = this.projectGeneration; const binding = this.binding();
		if (!project || !binding) { throw new Error('Choose a workspace and team first.'); }
		const projects = await this.graph.listProjects(binding.workspace.id, binding.team.id);
		if (!projects.length) { throw new Error('No accessible VectorGraph projects belong to this team. Create or join a project in VectorGraph, then try again.'); }
		const selected = await this.quickInput.pick(projects.map(value => ({ label: value.name, description: value.id, value })), { placeHolder: 'Link this repository to a VectorGraph project' });
		if (!selected || project !== this.projectKey() || generation !== this.projectGeneration || binding.workspace.id !== this.binding()?.workspace.id || binding.team.id !== this.binding()?.team.id || this._store.isDisposed) { return; }
		this.storage.store(BINDING_KEY + project, { ...binding, project: selected.value }, StorageScope.PROFILE, StorageTarget.MACHINE);
		this.invalidateBinding(project);
		await this.refresh();
	}
	private async newTicket(): Promise<void> {
		const binding = this.binding(); const project = this.projectKey();
		if (!binding?.project || !project) { throw new Error('Choose a linked VectorGraph project before creating a ticket.'); }
		this.work.select({ workspace: binding.workspace.id, project, binding });
		await this.views.openView(VECTOR_GRAPH_DETAILS_VIEW, true);
	}
	private renderActiveWork(): void {
		clearNode(this.activeWork);
		const project = this.projectKey(); const active = project ? this.work.getActive(project) : undefined;
		if (active && this.session.workspaces.some(workspace => workspace.id === active.workspace)) {
			const button = append(this.activeWork, $<HTMLButtonElement>('button')); button.type = 'button'; button.textContent = localize('workActiveTicket', 'Working on {0}', active.identifier);
			// This node owns its click handler and is discarded when the active ticket changes.
			button.onclick = () => { this.work.select({ workspace: active.workspace, identifier: active.identifier, project: project! }); void this.views.openView(VECTOR_GRAPH_DETAILS_VIEW, true); };
		}
	}
	private async refresh(more = false): Promise<void> {
		if (more && (this.loading || !this.cursor)) { return; }
		const generation = ++this.generation;
		this.loading = true;
		let binding = this.binding();
		if (!more) { this.tickets = []; this.cursor = undefined; this.renderTickets(); }
		this.configureButton.disabled = !this.projectKey() || this.configuring || !this.session.workspaces.length;
		try {
			const session = await this.graph.getSession();
			if (generation !== this.generation || this._store.isDisposed) { return; }
			this.session = session;
			this.renderAccount();
			if (!this.session.workspaces.length) {
				this.loading = false;
				this.tickets = [];
				this.cursor = undefined;
				this.status.textContent = localize('vectorGraphConnectAccount', 'Sign in to connect your project with VectorGraph.');
				this.renderTickets();
				return;
			}
			if (binding && !this.session.workspaces.some(workspace => workspace.id === binding!.workspace.id)) {
				throw new Error(localize('vectorGraphAuthorizeWorkspace', 'This project belongs to a workspace that is not authorized. Reconnect or choose another workspace.'));
			}
			const project = this.projectKey();
			if (!binding && project && this.discoveryProject !== project) {
				this.discoveryProject = project;
				this.status.textContent = localize('vectorGraphDiscovering', 'Finding the workspace for this repository…');
				const discovery = await this.graph.discoverRepository(project);
				if (generation !== this.generation || this._store.isDisposed) { return; }
				if (!discovery.incomplete && discovery.bindings.length === 1) {
					binding = discovery.bindings[0];
					this.storage.store(BINDING_KEY + project, binding, StorageScope.PROFILE, StorageTarget.MACHINE);
				} else {
					this.loading = false;
					this.status.textContent = discovery.incomplete ? localize('vectorGraphDiscoveryIncomplete', 'Some workspace mappings are unavailable. Choose a workspace or reconnect to restore access.') : discovery.bindings.length > 1 ? localize('vectorGraphAmbiguous', 'This repository is linked to multiple teams. Choose the workspace and team for this project.') : localize('vectorGraphUnmapped', 'No workspace is linked to this repository yet. Choose a workspace to connect this project.');
					this.renderTickets();
					return;
				}
			}
		} catch (error) {
			if (generation === this.generation && !this._store.isDisposed) {
				this.loading = false;
				this.status.textContent = toErrorMessage(error);
				this.renderTickets();
			}
			return;
		}
		if (!binding) {
			this.loading = false;
			this.status.textContent = this.projectKey() ? localize('vectorGraphBind', 'Choose a workspace and team to see tickets for this project.') : localize('vectorGraphOpenProject', 'Open a project to view its VectorGraph tickets.');
			this.renderTickets();
			return;
		}
		if (this.scope.value === 'project' && !binding.project) {
			this.loading = false; this.status.textContent = localize('workChooseProjectPrompt', 'Choose Project to link this repository, or select Whole team to browse the team.'); this.renderTickets(); return;
		}
		if (this.metadataKey !== binding.workspace.id + ':' + binding.team.id) {
			try {
				const metadata = await this.graph.getTeamMetadata(binding.workspace.id, binding.team.id);
				if (generation !== this.generation || this._store.isDisposed) { return; }
				clearNode(this.assignee); const all = append(this.assignee, $<HTMLOptionElement>('option')); all.value = ''; all.textContent = localize('workAllAssignees', 'All assignees');
				for (const member of metadata.members) { const option = append(this.assignee, $<HTMLOptionElement>('option')); option.value = member.id; option.textContent = member.name; }
				this.metadataKey = binding.workspace.id + ':' + binding.team.id;
			} catch (error) { if (generation === this.generation) { this.loading = false; this.status.textContent = toErrorMessage(error); this.renderTickets(); } return; }
		}
		this.loading = true;
		this.status.textContent = localize('vectorGraphLoading', 'Loading {0} / {1}…', binding.workspace.name, binding.team.name);
		this.renderTickets();
		try {
			const page = await this.graph.listTickets(binding.workspace.id, binding.team.id, more ? this.cursor : undefined, this.scope.value === 'project' ? binding.project?.id : undefined, this.assignee.value || undefined);
			if (generation !== this.generation || this._store.isDisposed) { return; }
			if (page.nextCursor && page.nextCursor === this.cursor) { throw new Error(localize('vectorGraphRepeatedCursor', 'VectorGraph returned the same page. Refresh to retry.')); }
			this.tickets = [...new Map([...this.tickets, ...page.tickets].map(ticket => [ticket.identifier, ticket])).values()];
			this.cursor = page.nextCursor;
			this.status.textContent = localize('vectorGraphLoaded', '{0} / {1} · {2} tickets loaded', binding.workspace.name, this.scope.value === 'project' ? binding.project?.name ?? binding.team.name : binding.team.name, this.tickets.length);
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
		this.renderActiveWork();
		const focused = this.list.ownerDocument.activeElement;
		const focusedId = this.list.contains(focused) ? focused?.getAttribute('data-ticket') : undefined;
		this.listDisposables.clear();
		clearNode(this.list);
		this.ticketButtons = [];
		const binding = this.binding();
		const connected = !!this.session.workspaces.length;
		this.search.hidden = !connected || !binding;
		this.category.hidden = this.search.hidden;
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
		if (!visible.length && !this.loading && binding && connected) {
			append(this.list, $('.vector-graph-tickets__empty')).textContent = this.tickets.length ? localize('vectorGraphNoMatch', 'No loaded tickets match these filters.') : localize('vectorGraphNoTickets', 'No tickets to show. Refresh to check again.');
		}
		this.list.setAttribute('aria-busy', String(this.loading));
		this.moreButton.hidden = !this.cursor;
		this.moreButton.disabled = this.loading;
		this.refreshButton.disabled = this.loading || !this.projectKey() || !connected;
	}

	private async openTicket(binding: IVectorGraphBinding, ticket: IVectorGraphTicket): Promise<void> {
		try {
			this.selectedIdentifier = ticket.identifier;
			this.renderTickets();
			this.work.select({ workspace: binding.workspace.id, identifier: ticket.identifier, project: this.projectKey()!, binding });
			await this.views.openView(VECTOR_GRAPH_DETAILS_VIEW, true);
		} catch (error) {
			if (!this._store.isDisposed) { this.notifications.error(toErrorMessage(error)); }
		}
	}

	private button(container: HTMLElement, label: string, action: () => Promise<void>): HTMLButtonElement {
		const button = append(container, $<HTMLButtonElement>('button.vector-graph-tickets__action'));
		button.type = 'button';
		button.textContent = label;
		this._register(addDisposableListener(button, EventType.CLICK, () => { void action().catch(error => this.notifications.error(error)); }));
		return button;
	}

	override focus(): void {
		super.focus();
		if (!this.session.workspaces.length) { this.signInButton?.focus(); }
		else if (this.search?.hidden) { this.configureButton?.focus(); }
		else { this.search?.focus(); }
	}
	override dispose(): void { this.generation++; super.dispose(); }
}

const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).get(EXPLORER_VIEWLET_ID);
if (container) {
	Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
		id: VIEW_ID + '.list', name: localize2('vectorGraphWorkView', 'Work'), containerIcon: icon,
		canToggleVisibility: true, canMoveView: false, ctorDescriptor: new SyncDescriptor(VectorGraphTicketsView), order: 10, weight: 30
	}], container);
}
