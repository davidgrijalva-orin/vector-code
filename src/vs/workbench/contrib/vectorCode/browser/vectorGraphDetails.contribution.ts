/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { $, append, clearNode, addDisposableListener, EventType, Dimension } from '../../../../base/browser/dom.js';
import { localize, localize2 } from '../../../../nls.js';
import { IViewContainersRegistry, IViewsRegistry, IViewDescriptorService, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IVectorGraphWorkService, IVectorGraphSelection, VECTOR_GRAPH_DETAILS_VIEW } from '../common/vectorGraphWork.js';
import { VectorGraphTicketDetails } from './vectorGraphTicketDetails.js';
import { VectorGraphProjectWidget } from './vectorGraphProjectEditor.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import './vectorGraphWorkService.js';

export class VectorGraphDetailsView extends ViewPane {
	private navigation!: HTMLElement;
	private readonly tabButtons: HTMLButtonElement[] = [];
	private account!: HTMLElement;
	private accountListeners = this._register(new DisposableStore());
	private accountGeneration = 0;
	private railBody!: HTMLElement;
	private home!: HTMLElement;
	private project!: VectorGraphProjectWidget;
	private active: string | undefined;
	private lastSelection: IVectorGraphSelection | undefined;
	private readonly navigationListeners = this._register(new DisposableStore());
	private readonly tickets = new Map<string, { selection: IVectorGraphSelection; root: HTMLElement; details: VectorGraphTicketDetails }>();
	constructor(options: IViewletViewOptions,
		@IVectorGraphService private readonly graph: IVectorGraphService,
		@INotificationService private readonly notifications: INotificationService,
		@IVectorGraphWorkService private readonly work: IVectorGraphWorkService,
		@IVectorCodeWorkbenchService private readonly projects: IVectorCodeWorkbenchService,
		@IKeybindingService keybindings: IKeybindingService,
		@IContextMenuService contextMenus: IContextMenuService,
		@IConfigurationService configuration: IConfigurationService,
		@IContextKeyService contextKeys: IContextKeyService,
		@IViewDescriptorService descriptors: IViewDescriptorService,
		@IInstantiationService instantiation: IInstantiationService,
		@IOpenerService graphOpener: IOpenerService,
		@IThemeService theme: IThemeService,
		@IHoverService hover: IHoverService,
	) {
		super(options, keybindings, contextMenus, configuration, contextKeys, descriptors, instantiation, graphOpener, theme, hover);
		this._register(graph.onDidChangeSession(() => { this.clearTickets(); this.activate(undefined); void this.renderAccount(); }));
		this._register(work.onDidChange(() => { if (this.lastSelection !== work.selection) { this.showSelection(); } }));
		this._register(projects.onDidChangeActiveProject(() => { this.clearTickets(); this.showSelection(); }));
	}
	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent); parent.classList.add('vector-project-rail');
		this.navigation = append(parent, $('nav.vector-project-rail__tabs', { role: 'tablist', 'aria-label': localize('projectRailTabs', 'Project workspace and open tickets') }));
		this.railBody = append(parent, $('.vector-project-rail__body'));
		this.home = append(this.railBody, $('.vector-project-rail__page', { role: 'tabpanel' }));
		this.project = this._register(this.instantiationService.createInstance(VectorGraphProjectWidget));
		this.account = append(parent, $('.vector-project-rail__account')); void this.renderAccount();
		this.project.render(this.home); void this.project.selectSection('overview');
		this.showSelection();
	}
	private async renderAccount(): Promise<void> {
		if (!this.account) { return; } const generation = ++this.accountGeneration;
		try {
			const session = await this.graph.getSession(); if (generation !== this.accountGeneration || this._store.isDisposed) { return; }
			this.accountListeners.clear(); clearNode(this.account);
			append(this.account, $('span')).textContent = session.workspaces.length ? localize('railGraphConnected', 'VectorGraph · Signed in') : localize('railGraphDisconnected', 'VectorGraph · Not signed in');
			const manage = append(this.account, $<HTMLButtonElement>('button', { type: 'button' })); manage.textContent = session.workspaces.length ? localize('railGraphManage', 'Account & workspace') : localize('railGraphSignIn', 'Sign in');
			this.accountListeners.add(addDisposableListener(manage, EventType.CLICK, () => { this.activate(undefined); void this.project.openAccount(!session.workspaces.length).catch(error => this.notifications.error(error)); }));
			if (session.workspaces.length || session.authorization) {
				const signOut = append(this.account, $<HTMLButtonElement>('button', { type: 'button' })); signOut.textContent = session.authorization ? localize('railCancelSignIn', 'Cancel sign-in') : localize('railSignOut', 'Sign out');
				this.accountListeners.add(addDisposableListener(signOut, EventType.CLICK, () => { void (session.authorization ? this.graph.cancelSignIn() : this.graph.signOut()).catch(error => this.notifications.error(error)); }));
			}
		} catch { if (generation === this.accountGeneration && !this._store.isDisposed) { this.account.textContent = localize('railAccountUnavailable', 'VectorGraph account unavailable. Open Workspace → Tickets to reconnect.'); } }
	}
	private showSelection(): void {
		if (!this.railBody) { return; }
		const selection = this.work.selection; this.lastSelection = selection;
		if (!selection || selection.project !== this.projects.getActiveProjectUri()?.toString()) { this.activate(undefined); return; }
		const key = JSON.stringify([selection.project, selection.workspace, selection.identifier ?? 'new']);
		if (!this.tickets.has(key)) {
			const root = append(this.railBody, $('.vector-project-rail__page.vector-graph-ticket-editor', { role: 'tabpanel' }));
			const details = this.instantiationService.createInstance(VectorGraphTicketDetails, root);
			this.tickets.set(key, { selection, root, details }); void details.show(selection);
		}
		this.activate(key);
	}
	private activate(key: string | undefined): void {
		if (!this.home) { return; }
		this.active = key;
		this.home.hidden = key !== undefined;
		for (const [id, ticket] of this.tickets) { ticket.root.hidden = id !== key; }
		this.renderTabs();
	}
	private renderTabs(): void {
		this.navigationListeners.clear(); clearNode(this.navigation); this.tabButtons.length = 0;
		const entries = [{ key: undefined as string | undefined, label: localize('projectHomeTab', 'Workspace') }, ...[...this.tickets].map(([key, ticket]) => ({ key, label: ticket.selection.identifier ?? localize('newTicketTab', 'New ticket') }))];
		for (const entry of entries) {
			const item = append(this.navigation, $('.vector-project-rail__tab'));
			const button = append(item, $<HTMLButtonElement>('button', { type: 'button', role: 'tab', 'aria-selected': String(this.active === entry.key) }));
			this.tabButtons.push(button); button.textContent = entry.label; button.tabIndex = this.active === entry.key ? 0 : -1;
			this.navigationListeners.add(addDisposableListener(button, EventType.CLICK, () => this.activate(entry.key)));
			this.navigationListeners.add(addDisposableListener(button, EventType.KEY_DOWN, event => {
				const index = entries.indexOf(entry);
				const next = event.key === 'ArrowRight' ? (index + 1) % entries.length : event.key === 'ArrowLeft' ? (index + entries.length - 1) % entries.length : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : -1;
				if (next >= 0) { event.preventDefault(); this.activate(entries[next].key); this.tabButtons[next]?.focus(); }
			}));
			if (entry.key !== undefined) {
				const close = append(item, $<HTMLButtonElement>('button.vector-project-rail__close', { type: 'button', 'aria-label': localize('closeRailTicket', 'Close {0}', entry.label) })); close.textContent = '×';
				this.navigationListeners.add(addDisposableListener(close, EventType.CLICK, () => {
					const ticket = this.tickets.get(entry.key!); ticket?.details.dispose(); ticket?.root.remove(); this.tickets.delete(entry.key!);
					this.activate(this.active === entry.key ? undefined : this.active); this.focus();
				}));
			}
		}
	}
	private clearTickets(): void { for (const ticket of this.tickets.values()) { ticket.details.dispose(); ticket.root.remove(); } this.tickets.clear(); }
	protected override layoutBody(height: number, width: number): void { super.layoutBody(height, width); if (this.railBody) { this.railBody.style.height = Math.max(0, height - this.navigation.offsetHeight - (this.account?.offsetHeight ?? 0)) + 'px'; this.project.layout(new Dimension(width, Math.max(0, height - this.navigation.offsetHeight - (this.account?.offsetHeight ?? 0)))); } }
	override focus(): void { this.tabButtons.find(button => button.getAttribute('aria-selected') === 'true')?.focus(); }
	override dispose(): void { this.clearTickets(); super.dispose(); }
}

const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'vectorCode.workDetails', title: localize2('vectorGraphProjectRail', 'Project Workspace'), icon: Codicon.home,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['vectorCode.workDetails', { mergeViewWithContainerWhenSingleView: true }]),
	storageId: 'vectorCode.workDetails', hideIfEmpty: false
}, ViewContainerLocation.AuxiliaryBar);
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: VECTOR_GRAPH_DETAILS_VIEW, name: localize2('vectorGraphWorkspaceView', 'Project Workspace'), canToggleVisibility: false, canMoveView: false,
	ctorDescriptor: new SyncDescriptor(VectorGraphDetailsView)
}], container);
