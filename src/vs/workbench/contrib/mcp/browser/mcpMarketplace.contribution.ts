/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, addDisposableListener, clearNode, EventType } from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IIterativePager } from '../../../../base/common/paging.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IMcpGalleryManifestService } from '../../../../platform/mcp/common/mcpGalleryManifest.js';
import { McpGalleryManifestService } from '../../../../platform/mcp/common/mcpGalleryManifestService.js';
import { McpGalleryService } from '../../../../platform/mcp/common/mcpGalleryService.js';
import { GalleryMcpServerStatus, IGalleryMcpServer, IMcpGalleryService } from '../../../../platform/mcp/common/mcpManagement.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { Extensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry } from '../../../common/views.js';
import { IJSONEditingService } from '../../../services/configuration/common/jsonEditing.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { VIEWLET_ID } from '../../extensions/common/extensions.js';
import { IVectorCodeWorkbenchService } from '../../vectorCode/common/vectorCode.js';
import { mcpInstallEdits, mcpInstallOptions, mcpRemoveEdits, readMcpConfiguration } from '../common/mcpMarketplaceConfiguration.js';
import './mcpMarketplace.css';

export const MCP_MARKETPLACE_VIEW_ID = 'vectorCode.mcpMarketplace';
registerSingleton(IMcpGalleryManifestService, McpGalleryManifestService, InstantiationType.Delayed);
registerSingleton(IMcpGalleryService, McpGalleryService, InstantiationType.Delayed);

export class McpMarketplaceView extends ViewPane {
	private root!: HTMLElement;
	private search!: HTMLInputElement;
	private status!: HTMLElement;
	private results!: HTMLElement;
	private more!: HTMLButtonElement;
	private pager: IIterativePager<IGalleryMcpServer> | undefined;
	private readonly request = this._register(new MutableDisposable<CancellationTokenSource>());
	private readonly rows = this._register(new DisposableStore());
	private generation = 0;
	private loading = false;
	private installing = false;
	private installedMode = false;

	constructor(options: IViewletViewOptions,
		@IMcpGalleryService private readonly gallery: IMcpGalleryService,
		@IVectorCodeWorkbenchService private readonly projects: IVectorCodeWorkbenchService,
		@IFileService private readonly files: IFileService,
		@ITextFileService private readonly textFiles: ITextFileService,
		@IJSONEditingService private readonly json: IJSONEditingService,
		@IEditorService private readonly editors: IEditorService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@IDialogService private readonly dialogs: IDialogService,
		@INotificationService private readonly notifications: INotificationService,
		@IWorkspaceTrustManagementService private readonly trust: IWorkspaceTrustManagementService,
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
			if (this.root && this.installedMode) { void this.showInstalled(); }
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.root = append(container, $('.mcp-marketplace'));
		const toolbar = append(this.root, $('.mcp-marketplace__toolbar'));
		this.search = append(toolbar, $<HTMLInputElement>('input'));
		this.search.type = 'search';
		this.search.placeholder = localize('searchMcp', 'Search MCP servers');
		this.search.setAttribute('aria-label', this.search.placeholder);
		this._register(addDisposableListener(this.search, EventType.KEY_DOWN, event => { if (event.key === 'Enter') { void this.browse(); } }));
		this.button(toolbar, localize('browseMcp', 'Search'), () => this.browse());
		this.button(toolbar, localize('installedMcp', 'Installed'), () => this.showInstalled());
		this.button(toolbar, localize('configMcp', 'Configuration'), () => this.openConfiguration());
		this.status = append(this.root, $('.mcp-marketplace__status'));
		this.status.setAttribute('role', 'status');
		this.results = append(this.root, $('.mcp-marketplace__results'));
		this.more = this.button(this.root, localize('moreMcp', 'Load More'), () => this.browse(true));
		this.more.hidden = true;
		void this.browse();
	}

	private button(parent: HTMLElement, label: string, action: () => Promise<unknown>, store = this._store): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button'));
		button.type = 'button'; button.textContent = label;
		store.add(addDisposableListener(button, EventType.CLICK, () => { void action().catch(error => this.notifications.error(toErrorMessage(error))); }));
		return button;
	}

	private reset(): number {
		this.request.value?.cancel(); this.request.clear();
		this.pager = undefined; this.loading = false;
		this.rows.clear(); clearNode(this.results); this.more.hidden = true;
		return ++this.generation;
	}

	private async browse(next = false): Promise<void> {
		if (next && (this.loading || !this.pager)) { return; }
		const generation = next ? this.generation : this.reset();
		this.installedMode = false;
		this.loading = true; this.more.disabled = true;
		this.status.textContent = localize('loadingMcp', 'Loading the MCP Registry…');
		const source = new CancellationTokenSource(); this.request.value = source;
		try {
			let page;
			if (next && this.pager) { page = await this.pager.getNextPage(source.token); }
			else { const pager = await this.gallery.query({ text: this.search.value }, source.token); if (generation !== this.generation) { return; } this.pager = pager; page = pager.firstPage; }
			if (generation !== this.generation || this._store.isDisposed) { return; }
			for (const server of page.items) {
				const row = append(this.results, $('article.mcp-marketplace__server'));
				append(row, $('strong')).textContent = server.displayName;
				append(row, $('small')).textContent = `${server.name} · ${server.version}`;
				append(row, $('p')).textContent = server.description;
				this.button(row, localize('detailsMcp', 'Details & Install'), () => this.inspect(server), this.rows);
			}
			this.more.hidden = !page.hasMore;
			this.status.textContent = this.results.childElementCount ? localize('mcpSource', 'Official MCP Registry · Publisher-provided servers') : localize('mcpEmpty', 'No servers found. Try another search.');
		} catch (error) {
			if (generation === this.generation && !source.token.isCancellationRequested && !this._store.isDisposed) { this.status.textContent = toErrorMessage(error) + ' ' + localize('mcpRetry', 'Search again to retry.'); }
		} finally { if (generation === this.generation) { this.loading = false; this.more.disabled = false; } }
	}

	private configurationUri(): URI {
		const project = this.projects.getActiveProjectUri();
		if (!project) { throw new Error(localize('mcpNeedsProject', 'Open a project to install or configure MCP servers.')); }
		return URI.joinPath(project, '.vscode', 'mcp.json');
	}

	private async readConfiguration(resource: URI): Promise<string> {
		if (this.textFiles.isDirty(resource)) { throw new Error(localize('mcpDirty', 'Save or revert mcp.json before changing installed servers.')); }
		return await this.files.exists(resource) ? (await this.textFiles.read(resource)).value : '{}';
	}

	private async openConfiguration(): Promise<void> {
		const resource = this.configurationUri();
		if (!await this.files.exists(resource)) { throw new Error(localize('mcpNoConfig', 'Install a server to create this project MCP configuration.')); }
		await this.editors.openEditor({ resource, options: { pinned: true } });
	}

	private async showInstalled(): Promise<void> {
		const generation = this.reset(); this.installedMode = true;
		try {
			const resource = this.configurationUri();
			const configuration = readMcpConfiguration(await this.readConfiguration(resource));
			if (generation !== this.generation || this._store.isDisposed) { return; }
			for (const name of Object.keys(configuration.servers ?? {})) {
				const row = append(this.results, $('article.mcp-marketplace__server'));
				append(row, $('strong')).textContent = name;
				this.button(row, localize('editMcp', 'Edit Configuration'), () => this.openConfiguration(), this.rows);
				this.button(row, localize('removeMcp', 'Remove'), () => this.remove(resource, name), this.rows);
			}
			this.status.textContent = this.results.childElementCount
				? localize('mcpConfigured', 'Configured for this project in .vscode/mcp.json. Use an MCP-capable client to run servers.')
				: localize('mcpNoneInstalled', 'No MCP servers configured for this project. Search the registry to add one.');
		} catch (error) { if (generation === this.generation && !this._store.isDisposed) { this.status.textContent = toErrorMessage(error); } }
	}

	private async remove(resource: URI, name: string): Promise<void> {
		if (this.installing) { return; }
		this.installing = true;
		try {
			const before = await this.readConfiguration(resource);
			if (!Object.hasOwn(readMcpConfiguration(before).servers ?? {}, name)) { return; }
			const { confirmed } = await this.dialogs.confirm({ message: localize('removeMcpConfirm', 'Remove {0} from this project?', name), detail: resource.fsPath, primaryButton: localize('removeMcpButton', 'Remove Configuration') });
			if (!confirmed) { return; }
			if (this._store.isDisposed || resource.toString() !== this.configurationUri().toString() || before !== await this.readConfiguration(resource)) {
				throw new Error(localize('mcpRemoveChanged', 'The project or configuration changed. Review it and try again.'));
			}
			if (!this.trust.isWorkspaceTrusted()) { throw new Error(localize('mcpRemoveTrust', 'Trust this workspace before changing its MCP configuration.')); }
			await this.json.write(resource, mcpRemoveEdits(name, before), true);
			await this.showInstalled();
		} finally { this.installing = false; }
	}

	private async inspect(server: IGalleryMcpServer): Promise<void> {
		if (this.installing) { return; }
		this.installing = true;
		try {
			if (server.status !== GalleryMcpServerStatus.Active) { throw new Error(localize('mcpDeprecated', 'This server is deprecated and cannot be installed from the marketplace.')); }
			const options = mcpInstallOptions(server);
			if (!options.length) { throw new Error(localize('mcpUnsupported', 'This server does not provide a supported HTTPS or stdio package.')); }
			const resource = this.configurationUri();
			const before = await this.readConfiguration(resource);
			const option = await this.quickInput.pick(options.map(type => ({ label: type === 'remote' ? 'HTTPS remote server' : type, registryType: type })), { title: server.displayName, placeHolder: server.description });
			if (!option) { return; }
			const edits = mcpInstallEdits(server, option.registryType, before);
			const { confirmed } = await this.dialogs.confirm({
				message: localize('confirmMcp', 'Install {0} for this project?', server.displayName),
				detail: `${server.name} · ${server.version}\n${server.description}\n\n${resource.fsPath}\n\n${JSON.stringify(edits[0].value, null, 2)}\n\n` + localize('mcpInstallScope', 'This saves a server configuration. Servers are not started by the marketplace. Review commands and endpoints before using them with an MCP client.'),
				primaryButton: localize('installMcp', 'Install Configuration')
			});
			if (!confirmed) { return; }
			if (this._store.isDisposed || resource.toString() !== this.configurationUri().toString()) { throw new Error(localize('mcpProjectChanged', 'The active project changed. Start the installation again.')); }
			if (!this.trust.isWorkspaceTrusted()) { throw new Error(localize('mcpTrust', 'Trust this workspace before installing MCP server configurations.')); }
			if (before !== await this.readConfiguration(resource)) { throw new Error(localize('mcpConfigChanged', 'The configuration changed. Review it and start the installation again.')); }
			await this.json.write(resource, edits, true);
			await this.editors.openEditor({ resource, options: { pinned: true } });
			await this.showInstalled();
		} finally { this.installing = false; }
	}

	override focus(): void { super.focus(); this.search?.focus(); }
	override dispose(): void { this.generation++; this.request.value?.cancel(); super.dispose(); }
}

const container = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).get(VIEWLET_ID);
if (container) {
	Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews([{
		id: MCP_MARKETPLACE_VIEW_ID, name: localize2('mcpMarketplace', 'MCP Marketplace'), containerIcon: Codicon.server,
		canToggleVisibility: true, canMoveView: false, ctorDescriptor: new SyncDescriptor(McpMarketplaceView), order: 100, weight: 40
	}], container);
}
registerAction2(class extends Action2 {
	constructor() { super({ id: 'workbench.mcp.browseMarketplace', title: localize2('browseMcpMarketplace', 'MCP: Browse Marketplace'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IViewsService).openView(MCP_MARKETPLACE_VIEW_ID, true); }
});
