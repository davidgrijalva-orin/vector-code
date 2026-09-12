/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, addDisposableListener, EventType, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext, IUntypedEditorInput, EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import { readVectorGraphBinding, VECTOR_GRAPH_BINDING_KEY } from '../common/vectorGraphBinding.js';
import { IVectorGraphWorkService, VECTOR_GRAPH_DETAILS_VIEW } from '../common/vectorGraphWork.js';
import { VectorGraphTicketsWidget } from './vectorGraphTicketsWidget.js';
import { openVectorGraphDocument } from './vectorGraphDocuments.contribution.js';
import './media/vectorGraphProject.css';

export const PROJECT_SECTIONS = ['overview', 'tickets', 'documents', 'graph', 'code'] as const;
export type ProjectSection = typeof PROJECT_SECTIONS[number];
export function isProjectSection(value: unknown): value is ProjectSection { return PROJECT_SECTIONS.some(section => section === value); }
const titles = { overview: localize('projectOverview', 'Overview'), tickets: localize('projectTickets', 'Tickets'), documents: localize('projectDocuments', 'Documents'), graph: localize('projectGraph', 'Graph'), code: localize('projectCode', 'Code') };
const icons = { overview: Codicon.home, tickets: Codicon.issues, documents: Codicon.fileText, graph: Codicon.typeHierarchy, code: Codicon.code };

/** One project page follows the active repository; document/file editors retain their own identity. */
export class VectorGraphProjectInput extends EditorInput {
	static readonly ID = 'workbench.input.vectorGraphProject';
	constructor(public section: ProjectSection = 'overview') { super(); }
	override get typeId(): string { return VectorGraphProjectInput.ID; }
	override get resource(): URI { return URI.from({ scheme: 'vectorgraph-project', path: '/workspace' }); }
	override get capabilities(): EditorInputCapabilities { return super.capabilities | EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton; }
	override getName(): string { return localize('projectWorkspace', 'Project workspace'); }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof VectorGraphProjectInput; }
}
export class VectorGraphProjectSerializer implements IEditorSerializer {
	canSerialize(input: EditorInput): boolean { return input instanceof VectorGraphProjectInput; }
	serialize(input: EditorInput): string | undefined { return input instanceof VectorGraphProjectInput ? JSON.stringify({ section: input.section }) : undefined; }
	deserialize(_instantiation: IInstantiationService, value: string): EditorInput | undefined {
		try { const data = JSON.parse(value); return isProjectSection(data.section) ? new VectorGraphProjectInput(data.section) : undefined; } catch { return undefined; }
	}
}

export class VectorGraphProjectEditor extends EditorPane {
	static readonly ID = 'workbench.editor.vectorGraphProject';
	private root!: HTMLElement;
	private heading!: HTMLElement;
	private subtitle!: HTMLElement;
	private content!: HTMLElement;
	private tabs!: HTMLElement;
	private readonly tabButtons = new Map<ProjectSection, HTMLButtonElement>();
	private section: ProjectSection = 'overview';
	private generation = 0;
	private readonly page = this._register(new DisposableStore());
	constructor(group: IEditorGroup,
		@ITelemetryService telemetry: ITelemetryService, @IThemeService theme: IThemeService,
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
		super(VectorGraphProjectEditor.ID, group, telemetry, theme, storage);
		this._register(projects.onDidChangeActiveProject(() => { if (this.root) { void this.renderSection(); } }));
		this._register(graph.onDidChangeSession(() => { if (this.root) { void this.renderSection(); } }));
		this._register(storage.onDidChangeValue(StorageScope.PROFILE, undefined, this._store)(event => {
			if (event.key.startsWith(VECTOR_GRAPH_BINDING_KEY) && this.root) { this.updateHeading(); if (this.section !== 'tickets') { void this.renderSection(); } }
		}));
	}
	protected override createEditor(parent: HTMLElement): void {
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
		this.heading.textContent = binding?.project?.name ?? this.projects.getProjectSummaries().find(item => item.uri.toString() === project?.toString())?.name ?? localize('chooseProject', 'Choose a project');
		this.subtitle.textContent = binding ? `${binding.workspace.name} / ${binding.team.name} · ${project?.fsPath ?? ''}` : project ? localize('localProjectPath', 'Local project · {0}', project.fsPath) : localize('standaloneWelcome', 'Open a folder to start coding. VectorGraph is optional.');
	}
	private async selectSection(section: ProjectSection): Promise<void> {
		this.section = section; if (this.input instanceof VectorGraphProjectInput) { this.input.section = section; }
		await this.renderSection();
	}
	private button(parent: HTMLElement, label: string, action: () => Promise<unknown>, primary = false): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.vector-project__button')); button.type = 'button'; button.textContent = label; button.classList.toggle('primary', primary);
		this.page.add(addDisposableListener(button, EventType.CLICK, () => { void action().catch(error => this.notifications.error(error)); })); return button;
	}
	private async renderSection(): Promise<void> {
		const generation = ++this.generation; this.page.clear(); clearNode(this.content); this.updateHeading();
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
			const widget = this.page.add(this.instantiation.createInstance(VectorGraphTicketsWidget)); widget.render(append(this.content, $('.vector-project__tickets'))); return;
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
			append(this.content, $('h2.vector-project__connected-heading')).textContent = binding ? localize('connectedProject', 'Connected with VectorGraph') : localize('optionalGraph', 'Add VectorGraph when you need it');
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
	override async setInput(input: VectorGraphProjectInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token); if (!token.isCancellationRequested && this.input === input) { await this.selectSection(input.section); }
	}
	override clearInput(): void { this.generation++; this.page.clear(); if (this.content) { clearNode(this.content); } super.clearInput(); }
	override layout(dimension: Dimension): void { this.root.style.width = dimension.width + 'px'; this.root.style.height = dimension.height + 'px'; }
	override focus(): void { this.tabButtons.get(this.section)?.focus(); }
}
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(EditorPaneDescriptor.create(VectorGraphProjectEditor, VectorGraphProjectEditor.ID, localize('projectEditor', 'Project workspace')), [new SyncDescriptor(VectorGraphProjectInput)]);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(VectorGraphProjectInput.ID, VectorGraphProjectSerializer);
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.openProjectWorkspace', title: localize2('openProjectWorkspace', 'VectorCode: Open Project Workspace'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IEditorService).openEditor(new VectorGraphProjectInput(), { pinned: true }); }
});
