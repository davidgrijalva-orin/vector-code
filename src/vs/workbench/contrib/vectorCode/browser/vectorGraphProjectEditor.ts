/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, addDisposableListener, EventType, Dimension } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import { readVectorGraphBinding, VECTOR_GRAPH_BINDING_KEY } from '../common/vectorGraphBinding.js';
import { IVectorGraphWorkService, VECTOR_GRAPH_DETAILS_VIEW } from '../common/vectorGraphWork.js';
import { VectorGraphArtifactInput } from './vectorGraphArtifactEditor.js';
import { VectorGraphTicketsWidget } from './vectorGraphTicketsWidget.js';
import { openVectorGraphDocument } from './vectorGraphDocuments.contribution.js';
import './media/vectorGraphProject.css';

export const PROJECT_SECTIONS = ['overview', 'tickets', 'documents', 'canvas', 'graph', 'code'] as const;
export type ProjectSection = typeof PROJECT_SECTIONS[number];
export function isProjectSection(value: unknown): value is ProjectSection { return PROJECT_SECTIONS.some(section => section === value); }
const titles = { overview: localize('projectOverview', 'Overview'), tickets: localize('projectTickets', 'Tickets'), documents: localize('projectDocuments', 'Documents'), canvas: localize('projectCanvas', 'Canvas'), graph: localize('projectGraph', 'Graph'), code: localize('projectCode', 'Code') };
const icons = { overview: Codicon.home, tickets: Codicon.issues, documents: Codicon.fileText, canvas: Codicon.symbolColor, graph: Codicon.typeHierarchy, code: Codicon.code };

export class VectorGraphProjectWidget extends Disposable {
	private root!: HTMLElement;
	private heading!: HTMLElement;
	private subtitle!: HTMLElement;
	private content!: HTMLElement;
	private tabs!: HTMLElement;
	private readonly tabButtons = new Map<ProjectSection, HTMLButtonElement>();
	private section: ProjectSection = 'overview';
	private generation = 0;
	private ticketWidget: VectorGraphTicketsWidget | undefined;
	private readonly page = this._register(new DisposableStore());
	constructor(
		@IStorageService private readonly storage: IStorageService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IVectorCodeWorkbenchService private readonly projects: IVectorCodeWorkbenchService,
		@IVectorGraphService private readonly graph: IVectorGraphService,
		@ICommandService private readonly commands: ICommandService,
		@IEditorService private readonly editors: IEditorService,
		@IViewsService private readonly views: IViewsService,
		@IVectorGraphWorkService private readonly work: IVectorGraphWorkService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super();
		this._register(projects.onDidChangeActiveProject(() => { if (this.root) { void this.renderSection(); } }));
		this._register(graph.onDidChangeSession(() => { if (this.root) { void this.renderSection(); } }));
		this._register(storage.onDidChangeValue(StorageScope.PROFILE, undefined, this._store)(event => {
			if (event.key.startsWith(VECTOR_GRAPH_BINDING_KEY) && this.root) { this.updateHeading(); if (this.section !== 'tickets') { void this.renderSection(); } }
		}));
	}
	render(parent: HTMLElement): void {
		this.root = append(parent, $('.vector-project')); this.root.tabIndex = -1;
		const header = append(this.root, $('header.vector-project__header'));
		append(header, $('p.vector-project__eyebrow')).textContent = localize('projectsBreadcrumb', 'Projects');
		this.heading = append(header, $('h1'));
		this.subtitle = append(header, $('p.vector-project__subtitle'));
		this.tabs = append(this.root, $('nav.vector-project__tabs')); this.tabs.setAttribute('role', 'tablist'); this.tabs.setAttribute('aria-label', localize('projectNavigation', 'Project navigation'));
		for (const section of PROJECT_SECTIONS) {
			const button = append(this.tabs, $<HTMLButtonElement>('button')); button.type = 'button'; button.dataset.section = section;
			this.tabButtons.set(section, button);
			button.id = 'vector-project-tab-' + section; button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'vector-project-content');
			append(button, $('span', { 'aria-hidden': 'true' })).classList.add(...ThemeIcon.asClassNameArray(icons[section]));
			append(button, $('span')).textContent = titles[section];
			this._register(addDisposableListener(button, EventType.CLICK, () => { void this.selectSection(section); }));
		}
		this._register(addDisposableListener(this.tabs, EventType.KEY_DOWN, event => {
			const index = PROJECT_SECTIONS.indexOf(this.section);
			const next = event.key === 'ArrowRight' ? (index + 1) % PROJECT_SECTIONS.length : event.key === 'ArrowLeft' ? (index + PROJECT_SECTIONS.length - 1) % PROJECT_SECTIONS.length : event.key === 'Home' ? 0 : event.key === 'End' ? PROJECT_SECTIONS.length - 1 : -1;
			if (next >= 0) { event.preventDefault(); void this.selectSection(PROJECT_SECTIONS[next]); this.tabButtons.get(PROJECT_SECTIONS[next])?.focus(); }
		}));
		this.content = append(this.root, $('section.vector-project__content')); this.content.id = 'vector-project-content'; this.content.setAttribute('role', 'tabpanel');
	}
	private updateHeading(): void {
		const project = this.projects.getActiveProjectUri(); const binding = readVectorGraphBinding(this.storage, project?.toString());
		const repository = this.projects.getProjectSummaries().find(item => item.uri.toString() === project?.toString());
		this.heading.textContent = binding?.project?.name ?? repository?.name ?? localize('chooseProject', 'Choose a project');
		this.subtitle.title = project?.fsPath ?? '';
		this.subtitle.textContent = binding ? localize('projectRepositoryContext', '{0} · Repository: {1}', binding.workspace.name, repository?.name ?? project?.path ?? '') : project ? localize('localProjectPath', 'Local project · {0}', project.fsPath) : localize('standaloneWelcome', 'Open a folder to start coding. VectorGraph is optional.');
	}
	async selectSection(section: ProjectSection): Promise<void> {
		this.section = section;
		await this.renderSection();
	}
	private button(parent: HTMLElement, label: string, action: () => Promise<unknown>, primary = false): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.vector-project__button')); button.type = 'button'; button.textContent = label; button.classList.toggle('primary', primary);
		this.page.add(addDisposableListener(button, EventType.CLICK, () => { void action().catch(error => this.notifications.error(error)); })); return button;
	}
	private async renderSection(): Promise<void> {
		const generation = ++this.generation; this.page.clear(); this.ticketWidget = undefined; clearNode(this.content); this.updateHeading();
		for (const tab of this.tabButtons.values()) { const selected = tab.dataset.section === this.section; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; }
		this.content.setAttribute('aria-labelledby', 'vector-project-tab-' + this.section);
		const project = this.projects.getActiveProjectUri()?.toString(); const binding = readVectorGraphBinding(this.storage, project);
		if (this.section === 'tickets') {
			const toolbar = append(this.content, $('.vector-project__section-heading')); append(toolbar, $('h2')).textContent = titles.tickets;
			this.button(toolbar, localize('newProjectTicket', 'New ticket'), async () => {
				const current = this.projects.getActiveProjectUri()?.toString(); const currentBinding = readVectorGraphBinding(this.storage, current);
				if (!current || !currentBinding?.project) { throw new Error(localize('linkProjectFirst', 'Choose a workspace and linked project in connection settings first.')); }
				this.work.select({ workspace: currentBinding.workspace.id, project: current, binding: currentBinding }); await this.views.openView(VECTOR_GRAPH_DETAILS_VIEW, true);
			}, true);
			const widget = this.page.add(this.instantiation.createInstance(VectorGraphTicketsWidget)); this.ticketWidget = widget; widget.render(append(this.content, $('.vector-project__tickets'))); return;
		}
		if (this.section === 'canvas') {
			append(this.content, $('h2')).textContent = titles.canvas;
			const status = append(this.content, $('p')); status.setAttribute('role', 'status');
			if (!binding) { status.textContent = localize('canvasConnect', 'Connect VectorGraph to browse shared canvases.'); this.button(this.content, localize('canvasSignIn', 'Connect VectorGraph…'), () => this.selectSection('tickets')); return; }
			status.textContent = localize('canvasLoading', 'Loading canvases…');
			try {
				const canvases = await this.graph.listCanvases(binding.workspace.id);
				if (generation !== this.generation || this._store.isDisposed) { return; }
				status.textContent = canvases.length ? localize('canvasWorkspaceList', 'Workspace canvases') : localize('canvasEmpty', 'No canvases in this workspace yet.');
				for (const canvas of canvases) { this.button(this.content, canvas.title, () => this.editors.openEditor(new VectorGraphArtifactInput(binding.workspace.id, canvas.id, canvas.title, 'canvas'), { pinned: true })).classList.add('vector-project__document'); }
			} catch (error) { if (generation === this.generation && !this._store.isDisposed) { status.textContent = toErrorMessage(error); } }
			return;
		}
		if (this.section === 'documents') {
			const toolbar = append(this.content, $('.vector-project__section-heading')); append(toolbar, $('h2')).textContent = titles.documents;
			this.button(toolbar, localize('createProjectDocument', 'New document'), () => this.commands.executeCommand('vectorCode.newDocument'), true);
			this.button(toolbar, localize('browseWorkspace', 'Browse workspace'), () => this.commands.executeCommand('vectorCode.openDocuments'));
			const status = append(this.content, $('p')); status.setAttribute('role', 'status');
			if (!binding?.project) { status.textContent = localize('documentsNeedProject', 'Shared documents are available with VectorGraph. Local files and Markdown editing work without an account.'); this.button(this.content, localize('connectForDocuments', 'Connect VectorGraph…'), () => this.selectSection('tickets')); this.button(this.content, localize('openLocalDocuments', 'Browse local files'), () => this.commands.executeCommand('workbench.view.explorer')); return; }
			status.textContent = localize('loadingProjectDocuments', 'Loading documents…');
			try {
				const documents = await this.graph.listDocuments(binding.workspace.id);
				if (generation !== this.generation || this._store.isDisposed) { return; }
				const linked = documents.filter(document => document.teamId === binding.team.id && document.projectIds.includes(binding.project!.id));
				status.textContent = linked.length ? localize('documentCount', '{0} documents', linked.length) : localize('noProjectDocuments', 'No documents yet. Create one to capture decisions and plans.');
				for (const document of linked) { this.button(this.content, document.title, () => openVectorGraphDocument(this.editors, binding.workspace.id, document)).classList.add('vector-project__document'); }
			} catch (error) { if (generation === this.generation && !this._store.isDisposed) { status.textContent = toErrorMessage(error); } }
			return;
		}
		append(this.content, $('h2')).textContent = this.section === 'overview' ? localize('continueProjectWork', 'Continue working') : titles[this.section];
		if (this.section === 'overview') {
			append(this.content, $('p')).textContent = binding ? localize('projectOverviewDescription', 'Your tickets, documents and repository share one project context.') : localize('localOverviewDescription', 'Everything you need to develop locally. No VectorGraph account required.');
			const actions = append(this.content, $('.vector-project__shortcuts'));
			this.button(actions, localize('openProjectCode', 'Browse code'), () => this.selectSection('code'), true);
			this.button(actions, localize('overviewTerminal', 'Open terminal'), () => this.projects.toggleActiveProjectTerminalPanel());
			this.button(actions, localize('overviewGit', 'Source control'), () => this.commands.executeCommand('workbench.view.scm'));
			this.button(actions, localize('overviewRun', 'Run and debug'), () => this.commands.executeCommand('workbench.view.debug'));
			if (!project) { this.button(actions, localize('openLocalProject', 'Open a folder…'), () => this.projects.addProjectToWorkspace(), true); }
			append(this.content, $('h2.vector-project__connected-heading')).textContent = binding ? localize('connectedProject', 'VectorGraph project') : localize('optionalGraph', 'Add VectorGraph when you need it');
			append(this.content, $('p')).textContent = binding ? localize('connectedBenefits', 'Plan work and keep decisions connected to this repository.') : localize('optionalBenefits', 'Connect tickets, shared documents and project context. Your local tools work independently.');
			this.button(this.content, binding ? localize('reviewProjectTickets', 'Review tickets') : localize('connectOptionalGraph', 'Connect VectorGraph…'), () => this.selectSection('tickets'));
			if (binding) { this.button(this.content, localize('readProjectDocuments', 'Open documents'), () => this.selectSection('documents')); }
			const active = project ? this.work.getActive(project) : undefined;
			if (active && binding?.workspace.id === active.workspace) { this.button(this.content, localize('resumeActiveTicket', 'Resume {0}', active.identifier), async () => { this.work.select({ workspace: active.workspace, identifier: active.identifier, project: project! }); await this.views.openView(VECTOR_GRAPH_DETAILS_VIEW, true); }); }
		} else if (this.section === 'code') {
			append(this.content, $('p')).textContent = localize('codeWorkspaceDescription', 'Open repository files in native editor tabs. Your ticket inspector can stay beside your code.');
			this.button(this.content, localize('browseProjectFiles', 'Browse files'), () => this.commands.executeCommand('workbench.view.explorer'), true);
			this.button(this.content, localize('findProjectFile', 'Go to file…'), () => this.commands.executeCommand('workbench.action.quickOpen'));
			this.button(this.content, localize('openProjectChanges', 'Source control'), () => this.commands.executeCommand('workbench.view.scm'));
			this.button(this.content, localize('openProjectTerminal', 'Terminal'), () => this.projects.toggleActiveProjectTerminalPanel());
		} else {
			append(this.content, $('p')).textContent = localize('graphNativeCoverage', 'The relationship canvas is not available yet. You can explore linked work in the ticket inspector.');
			this.button(this.content, localize('inspectProjectRelationships', 'Browse ticket relationships'), () => this.selectSection('tickets'), true);
		}
	}
	async openAccount(signIn = false): Promise<void> { if (this.section !== 'tickets' || !this.ticketWidget) { await this.selectSection('tickets'); } await this.ticketWidget?.openAccount(signIn); }
	layout(_dimension: Dimension): void { this.root.style.width = '100%'; this.root.style.height = '100%'; }
	focus(): void { this.tabButtons.get(this.section)?.focus(); }
}
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.openProjectWorkspace', title: localize2('openProjectWorkspace', 'VectorCode: Open Project Workspace'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IVectorGraphWorkService).select(undefined);
		await accessor.get(IViewsService).openView(VECTOR_GRAPH_DETAILS_VIEW, true);
	}
});
