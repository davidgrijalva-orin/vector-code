/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LayoutPriority, Orientation, Sizing, SplitView } from '../../../../base/browser/ui/splitview/splitview.js';
import { Disposable, DisposableStore, dispose, IDisposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ITerminalConfigurationService, ITerminalGroupService, ITerminalInstance, ITerminalService, TerminalConnectionState, TerminalDataTransfers } from './terminal.js';
import { TerminalTabList } from './terminalTabsList.js';
import * as dom from '../../../../base/browser/dom.js';
import { Action, IAction, Separator } from '../../../../base/common/actions.js';
import { IMenu, IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { TerminalLocation, TerminalSettingId } from '../../../../platform/terminal/common/terminal.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchLayoutService, Parts, Position } from '../../../services/layout/browser/layoutService.js';
import { localize } from '../../../../nls.js';
import { openContextMenu } from './terminalContextMenu.js';
import { TerminalContextKeys } from '../common/terminalContextKey.js';
import { getInstanceHoverInfo } from './terminalTooltip.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { containsDragType } from '../../../../platform/dnd/browser/dnd.js';
import { getTerminalResourcesFromDragEvent, parseTerminalUri } from './terminalUri.js';
import type { IProcessDetails } from '../../../../platform/terminal/common/terminalProcess.js';
import { IVectorCodeWorkbenchService } from '../../vectorCode/common/vectorCode.js';

const $ = dom.$;

const enum CssClass {
	ViewIsVertical = 'terminal-side-view',
}

const enum VectorTerminalTabs {
	TopTabsHeight = 34
}

export class TerminalTabbedView extends Disposable {

	private _splitView: SplitView;

	private _terminalContainer: HTMLElement;
	private _tabListElement: HTMLElement;
	private _tabContainer: HTMLElement;
	private _horizontalTabStrip: HTMLElement;
	private _horizontalTabList: HTMLElement;
	private _horizontalTabActions: HTMLElement;

	private _tabList: TerminalTabList;
	private _tabListContainer: HTMLElement;
	private _tabListDomElement: HTMLElement;
	private _sashDisposables: IDisposable[] | undefined;
	private readonly _horizontalTabDisposables = this._register(new DisposableStore());

	private _plusButton: HTMLElement | undefined;

	private _tabTreeIndex: number;
	private _terminalContainerIndex: number;

	private _width: number | undefined;

	private _cancelContextMenu: boolean = false;
	private _instanceMenu: IMenu;
	private _tabsListMenu: IMenu;
	private _tabsListEmptyMenu: IMenu;

	private _terminalIsTabsNarrowContextKey: IContextKey<boolean>;
	private _terminalTabsFocusContextKey: IContextKey<boolean>;
	private _terminalTabsMouseContextKey: IContextKey<boolean>;

	private _panelOrientation: Orientation | undefined;
	private _emptyAreaDropTargetCount = 0;

	constructor(
		parentElement: HTMLElement,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ITerminalConfigurationService private readonly _terminalConfigurationService: ITerminalConfigurationService,
		@ITerminalGroupService private readonly _terminalGroupService: ITerminalGroupService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IMenuService menuService: IMenuService,
		@IStorageService private readonly _storageService: IStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IVectorCodeWorkbenchService private readonly _vectorCodeWorkbenchService: IVectorCodeWorkbenchService,
	) {
		super();

		this._tabContainer = $('.tabs-container');
		const tabListContainer = $('.tabs-list-container');
		this._tabListContainer = tabListContainer;
		this._tabListElement = $('.tabs-list');
		tabListContainer.appendChild(this._tabListElement);
		this._tabContainer.appendChild(tabListContainer);
		this._horizontalTabStrip = dom.append(this._tabContainer, $('.vector-terminal-tabs-strip'));
		this._horizontalTabList = dom.append(this._horizontalTabStrip, $('.vector-terminal-tabs-list'));
		this._horizontalTabActions = dom.append(this._horizontalTabStrip, $('.vector-terminal-tabs-actions'));

		this._instanceMenu = this._register(menuService.createMenu(MenuId.TerminalInstanceContext, contextKeyService));
		this._tabsListMenu = this._register(menuService.createMenu(MenuId.TerminalTabContext, contextKeyService));
		this._tabsListEmptyMenu = this._register(menuService.createMenu(MenuId.TerminalTabEmptyAreaContext, contextKeyService));

		this._tabList = this._register(this._instantiationService.createInstance(TerminalTabList, this._tabListElement));
		this._tabListDomElement = this._tabList.getHTMLElement();

		const terminalOuterContainer = $('.terminal-outer-container');
		this._terminalContainer = $('.terminal-groups-container');
		terminalOuterContainer.appendChild(this._terminalContainer);

		this._terminalService.setContainers(parentElement, this._terminalContainer);

		this._terminalIsTabsNarrowContextKey = TerminalContextKeys.tabsNarrow.bindTo(contextKeyService);
		this._terminalTabsFocusContextKey = TerminalContextKeys.tabsFocus.bindTo(contextKeyService);
		this._terminalTabsMouseContextKey = TerminalContextKeys.tabsMouse.bindTo(contextKeyService);

		this._terminalContainerIndex = 0;
		this._tabTreeIndex = 0;

		this._register(_configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(TerminalSettingId.TabsEnabled) ||
				e.affectsConfiguration(TerminalSettingId.TabsHideCondition)) {
				this._refreshShowTabs();
			} else if (e.affectsConfiguration(TerminalSettingId.TabsLocation)) {
				this._refreshShowTabs();
			}
		}));
		this._register(Event.any(this._terminalGroupService.onDidChangeInstances, this._terminalGroupService.onDidChangeGroups)(() => {
			this._refreshShowTabs();
			this._renderHorizontalTabs();
		}));
		this._register(this._terminalGroupService.onDidChangeActiveInstance(() => this._renderHorizontalTabs()));
		this._register(this._layoutService.onDidChangePanelPosition(() => this._renderHorizontalTabs()));

		this._register(Event.any(this._terminalService.onDidChangeInstances, this._terminalService.onDidDisposeInstance)(() => {
			this._refreshShowTabs();
			this._renderHorizontalTabs();
		}));

		this._attachEventListeners(parentElement, this._terminalContainer);

		this._register(this._terminalGroupService.onDidChangePanelOrientation((orientation) => {
			this._panelOrientation = orientation;
			if (this._panelOrientation === Orientation.VERTICAL) {
				this._terminalContainer.classList.add(CssClass.ViewIsVertical);
			} else {
				this._terminalContainer.classList.remove(CssClass.ViewIsVertical);
			}
		}));

		this._tabContainer.classList.add('vector-terminal-tabs-top');
		this._splitView = new SplitView(parentElement, { orientation: Orientation.VERTICAL, proportionalLayout: false });
		this._setupSplitView(terminalOuterContainer);
		this._renderHorizontalTabs();
	}

	private _shouldShowTabs(): boolean {
		const enabled = this._terminalConfigurationService.config.tabs.enabled;
		const hide = this._terminalConfigurationService.config.tabs.hideCondition;
		if (!enabled) {
			return false;
		}
		if (this._terminalGroupService.instances.length > 0) {
			return true;
		}

		switch (hide) {
			case 'never':
				return true;
			case 'singleTerminal':
				if (this._terminalGroupService.instances.length > 1) {
					return true;
				}
				break;
			case 'singleGroup':
				if (this._terminalGroupService.groups.length > 1) {
					return true;
				}
				break;
		}
		return false;
	}

	private _refreshShowTabs() {
		if (this._shouldShowTabs()) {
			if (this._splitView.length === 1) {
				this._addTabTree();
				this._addSashListener();
				this._splitView.resizeView(this._tabTreeIndex, this._getTopTabsHeight());
				this.rerenderTabs();
			}
		} else {
			if (this._splitView.length === 2 && !this._terminalTabsMouseContextKey.get()) {
				this._splitView.removeView(this._tabTreeIndex);
				this._plusButton?.remove();
				this._removeSashListener();
				this._horizontalTabDisposables.clear();
				this._clearHorizontalTabs();
			}
		}
	}

	private _getTopTabsHeight(): number {
		return VectorTerminalTabs.TopTabsHeight;
	}

	private _handleOnDidSashReset(): void {
		this._splitView.resizeView(this._tabTreeIndex, this._getTopTabsHeight());
		this.rerenderTabs();
	}

	private _handleOnDidSashChange(): void {
		this.rerenderTabs();
	}

	private _setupSplitView(terminalOuterContainer: HTMLElement): void {
		this._register(this._splitView.onDidSashReset(() => this._handleOnDidSashReset()));
		this._register(this._splitView.onDidSashChange(() => this._handleOnDidSashChange()));

		this._splitView.addView({
			element: terminalOuterContainer,
			layout: height => this._terminalGroupService.groups.forEach(tab => tab.layout(this._width || 0, height)),
			minimumSize: 120,
			maximumSize: Number.POSITIVE_INFINITY,
			onDidChange: () => Disposable.None,
			priority: LayoutPriority.High
		}, Sizing.Distribute, this._terminalContainerIndex);

		if (this._shouldShowTabs()) {
			this._addTabTree();
			this._addSashListener();
		}
	}

	private _addTabTree() {
		this._splitView.addView({
			element: this._tabContainer,
			layout: height => {
				this._tabList.layout(0, this._width || 0);
				this._renderHorizontalTabs();
			},
			minimumSize: this._getTopTabsHeight(),
			maximumSize: this._getTopTabsHeight(),
			onDidChange: () => Disposable.None,
			priority: LayoutPriority.Low
		}, this._getTopTabsHeight(), this._tabTreeIndex);
		this.rerenderTabs();
	}

	rerenderTabs() {
		this._updateHasText();
		this._tabList.refresh();
		this._renderHorizontalTabs();
	}

	private _renderHorizontalTabs(): void {
		this._horizontalTabDisposables.clear();
		this._clearHorizontalTabs();

		if (!this._shouldShowTabs()) {
			return;
		}

		this._renderTerminalTabActions();

		const activeInstance = this._terminalGroupService.activeInstance;
		let activeTab: HTMLElement | undefined;
		for (const [index, instance] of this._terminalGroupService.instances.entries()) {
			const terminalTitle = instance.title || localize('vectorTerminalDefaultTitle', 'Terminal {0}', index + 1);
			const tab = document.createElement('button');
			tab.className = 'vector-terminal-tab';
			tab.classList.toggle('vector-terminal-tab--active', activeInstance === instance);
			if (activeInstance === instance) {
				activeTab = tab;
			}
			tab.type = 'button';
			tab.setAttribute('aria-label', terminalTitle);
			tab.title = localize('vectorTerminalTabTitle', 'Click to focus. Double-click or use the edit icon to rename.');
			const title = dom.append(tab, $('.vector-terminal-tab__title'));
			title.textContent = terminalTitle;
			if (instance.description) {
				const description = dom.append(tab, $('.vector-terminal-tab__description'));
				description.textContent = instance.description;
			}
			const rename = dom.append(tab, $('.vector-terminal-tab__rename.codicon.codicon-edit'));
			rename.title = localize('vectorTerminalTabRename', 'Rename Terminal');
			rename.setAttribute('aria-hidden', 'true');
			const close = dom.append(tab, $('.vector-terminal-tab__close'));
			close.textContent = 'x';
			close.title = localize('vectorTerminalTabClose', 'Close Terminal');
			close.setAttribute('aria-hidden', 'true');
			this._horizontalTabList.appendChild(tab);

			this._horizontalTabDisposables.add(dom.addDisposableListener(tab, dom.EventType.CLICK, event => {
				const target = event.target as HTMLElement | null;
				if (target?.classList.contains('vector-terminal-tab__rename')) {
					this._terminalService.setActiveInstance(instance);
					void this._renameTerminalTab(instance);
					return;
				}
				if (target?.classList.contains('vector-terminal-tab__close')) {
					void this._terminalService.safeDisposeTerminal(instance);
					return;
				}
				this._terminalService.setActiveInstance(instance);
				instance.focusWhenReady();
			}));
			this._horizontalTabDisposables.add(dom.addDisposableListener(tab, dom.EventType.DBLCLICK, event => {
				event.preventDefault();
				event.stopPropagation();
				this._terminalService.setActiveInstance(instance);
				void this._renameTerminalTab(instance);
			}));
		}
		activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	private _clearHorizontalTabs(): void {
		dom.clearNode(this._horizontalTabList);
		dom.clearNode(this._horizontalTabActions);
	}

	private _renderTerminalTabActions(): void {
		const newTerminalButton = document.createElement('button');
		newTerminalButton.className = 'vector-terminal-tabs-action codicon codicon-add';
		newTerminalButton.type = 'button';
		newTerminalButton.title = localize('vectorTerminalNewTerminal', 'New Terminal');
		newTerminalButton.setAttribute('aria-label', localize('vectorTerminalNewTerminalAria', 'New Terminal'));
		this._horizontalTabActions.appendChild(newTerminalButton);
		this._horizontalTabDisposables.add(dom.addDisposableListener(newTerminalButton, dom.EventType.CLICK, event => {
			event.preventDefault();
			event.stopPropagation();
			void this._createPanelTerminal();
		}));

		const panelOnRight = this._layoutService.getPanelPosition() === Position.RIGHT;
		const positionButton = document.createElement('button');
		positionButton.className = `vector-terminal-tabs-action codicon ${panelOnRight ? 'codicon-layout-panel' : 'codicon-layout-panel-right'}`;
		positionButton.type = 'button';
		const title = panelOnRight
			? localize('vectorTerminalMoveBottom', 'Move Terminal to Bottom')
			: localize('vectorTerminalMoveRight', 'Move Terminal to Right');
		positionButton.title = title;
		positionButton.setAttribute('aria-label', title);
		this._horizontalTabActions.appendChild(positionButton);
		this._horizontalTabDisposables.add(dom.addDisposableListener(positionButton, dom.EventType.CLICK, event => {
			event.preventDefault();
			event.stopPropagation();
			const nextPosition = this._layoutService.getPanelPosition() === Position.RIGHT ? Position.BOTTOM : Position.RIGHT;
			this._layoutService.setPanelPosition(nextPosition);
			if (!this._layoutService.isVisible(Parts.PANEL_PART)) {
				this._layoutService.setPartHidden(false, Parts.PANEL_PART);
			}
			void this._terminalGroupService.showPanel(true);
			this._renderHorizontalTabs();
		}));
	}

	private async _createPanelTerminal(): Promise<void> {
		const instance = await this._terminalService.createTerminal({
			location: TerminalLocation.Panel,
			cwd: this._vectorCodeWorkbenchService.getActiveProjectUri()
		});
		this._terminalService.setActiveInstance(instance);
		await this._terminalGroupService.showPanel(true);
		await instance.focusWhenReady();
	}

	private async _renameTerminalTab(instance: ITerminalInstance): Promise<void> {
		const title = await this._quickInputService.input({
			value: instance.title,
			prompt: localize('vectorTerminalTabRenamePrompt', 'Enter terminal tab name')
		});
		if (title === undefined) {
			return;
		}
		await instance.rename(title);
		this._renderHorizontalTabs();
	}

	private _addSashListener() {
		let interval: IDisposable;
		this._sashDisposables = [
			this._splitView.sashes[0].onDidStart(e => {
				interval = dom.disposableWindowInterval(dom.getWindow(this._splitView.el), () => {
					this.rerenderTabs();
				}, 100);
			}),
			this._splitView.sashes[0].onDidEnd(e => {
				interval.dispose();
			})
		];
	}

	private _removeSashListener() {
		if (this._sashDisposables) {
			dispose(this._sashDisposables);
			this._sashDisposables = undefined;
		}
	}

	private _updateHasText() {
		const hasText = true;
		this._tabContainer.classList.toggle('has-text', hasText);
		this._terminalIsTabsNarrowContextKey.set(!hasText);
	}

	layout(width: number, height: number): void {
		this._width = width;
		this._splitView.layout(height);
		if (this._shouldShowTabs()) {
			this._splitView.resizeView(this._tabTreeIndex, this._getTopTabsHeight());
		}
		this._updateHasText();
		this._renderHorizontalTabs();
	}


	private _attachEventListeners(parentDomElement: HTMLElement, terminalContainer: HTMLElement): void {
		this._register(dom.addDisposableListener(this._tabContainer, 'mouseleave', async (event: MouseEvent) => {
			this._terminalTabsMouseContextKey.set(false);
			this._refreshShowTabs();
			event.stopPropagation();
		}));
		this._register(dom.addDisposableListener(this._tabContainer, 'mouseenter', async (event: MouseEvent) => {
			this._terminalTabsMouseContextKey.set(true);
			event.stopPropagation();
		}));
		this._register(dom.addDisposableListener(this._tabContainer, 'dragenter', (event: DragEvent) => {
			if (!this._shouldHandleEmptyAreaDrop(event)) {
				this._resetEmptyAreaDropState();
				return;
			}
			this._emptyAreaDropTargetCount++;
			this._setEmptyAreaDropState(true);
		}));
		this._register(dom.addDisposableListener(this._tabContainer, 'dragover', (event: DragEvent) => {
			if (!this._shouldHandleEmptyAreaDrop(event)) {
				this._resetEmptyAreaDropState();
				return;
			}
			event.preventDefault();
			this._setEmptyAreaDropState(true);
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move';
			}
		}));
		this._register(dom.addDisposableListener(this._tabContainer, 'dragleave', (event: DragEvent) => {
			if (!this._shouldHandleEmptyAreaDrop(event)) {
				if (!this._tabContainer.contains(event.relatedTarget as Node | null)) {
					this._resetEmptyAreaDropState();
				}
				return;
			}
			if (this._tabContainer.contains(event.relatedTarget as Node | null)) {
				return;
			}
			this._emptyAreaDropTargetCount = Math.max(0, this._emptyAreaDropTargetCount - 1);
			if (this._emptyAreaDropTargetCount === 0) {
				this._resetEmptyAreaDropState();
			}
		}));
		this._register(dom.addDisposableListener(this._tabContainer, 'drop', (event: DragEvent) => {
			if (!this._shouldHandleEmptyAreaDrop(event)) {
				return;
			}
			void this._handleContainerDrop(event);
		}));
		this._register(dom.addDisposableListener(terminalContainer, 'mousedown', async (event: MouseEvent) => {
			const terminal = this._terminalGroupService.activeInstance;
			if (this._terminalGroupService.instances.length > 0 && terminal) {
				const result = await terminal.handleMouseEvent(event, this._instanceMenu);
				if (typeof result === 'object' && result.cancelContextMenu) {
					this._cancelContextMenu = true;
				}
			}
		}));
		this._register(dom.addDisposableListener(terminalContainer, 'contextmenu', (event: MouseEvent) => {
			const rightClickBehavior = this._terminalConfigurationService.config.rightClickBehavior;
			if (rightClickBehavior === 'nothing' && !event.shiftKey) {
				this._cancelContextMenu = true;
			}
			terminalContainer.focus();
			if (!this._cancelContextMenu) {
				openContextMenu(dom.getWindow(terminalContainer), event, this._terminalGroupService.activeInstance, this._instanceMenu, this._contextMenuService);
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			this._cancelContextMenu = false;
		}));
		this._register(dom.addDisposableListener(this._tabContainer, 'contextmenu', (event: MouseEvent) => {
			const rightClickBehavior = this._terminalConfigurationService.config.rightClickBehavior;
			if (rightClickBehavior === 'nothing' && !event.shiftKey) {
				this._cancelContextMenu = true;
			}
			if (!this._cancelContextMenu) {
				const emptyList = this._tabList.getFocus().length === 0;
				if (!emptyList) {
					this._terminalGroupService.lastAccessedMenu = 'tab-list';
				}

				// Put the focused item first as it's used as the first positional argument
				const selectedInstances = this._tabList.getSelectedElements();
				const focusedInstance = this._tabList.getFocusedElements()?.[0];
				if (focusedInstance) {
					selectedInstances.splice(selectedInstances.findIndex(e => e.instanceId === focusedInstance.instanceId), 1);
					selectedInstances.unshift(focusedInstance);
				}

				openContextMenu(dom.getWindow(this._tabContainer), event, selectedInstances, emptyList ? this._tabsListEmptyMenu : this._tabsListMenu, this._contextMenuService, emptyList ? this._getTabActions() : undefined);
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			this._cancelContextMenu = false;
		}));
		this._register(dom.addDisposableListener(terminalContainer.ownerDocument, 'keydown', (event: KeyboardEvent) => {
			terminalContainer.classList.toggle('alt-active', !!event.altKey);
		}));
		this._register(dom.addDisposableListener(terminalContainer.ownerDocument, 'keyup', (event: KeyboardEvent) => {
			terminalContainer.classList.toggle('alt-active', !!event.altKey);
		}));
		this._register(dom.addDisposableListener(parentDomElement, 'keyup', (event: KeyboardEvent) => {
			if (event.keyCode === 27) {
				// Keep terminal open on escape
				event.stopPropagation();
			}
		}));
		this._register(dom.addDisposableListener(this._tabContainer, dom.EventType.FOCUS_IN, () => {
			this._terminalTabsFocusContextKey.set(true);
		}));
		this._register(dom.addDisposableListener(this._tabContainer, dom.EventType.FOCUS_OUT, () => {
			this._terminalTabsFocusContextKey.set(false);
		}));
	}

	private _shouldHandleEmptyAreaDrop(event: DragEvent): boolean {
		const targetNode = event.target as Node | null;
		if (targetNode && (this._tabListDomElement.contains(targetNode) || this._tabListElement.contains(targetNode))) {
			return false;
		}
		return !!event.dataTransfer && containsDragType(event, TerminalDataTransfers.Terminals);
	}

	private _setEmptyAreaDropState(active: boolean): void {
		this._tabListContainer.classList.toggle('drop-target', active);
		this._tabContainer.classList.toggle('drop-target', active);
	}

	private _resetEmptyAreaDropState(): void {
		this._emptyAreaDropTargetCount = 0;
		this._setEmptyAreaDropState(false);
	}

	private async _handleContainerDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		this._resetEmptyAreaDropState();
		const primaryBackend = this._terminalService.getPrimaryBackend();
		const resources = getTerminalResourcesFromDragEvent(event);
		let sourceInstances: ITerminalInstance[] | undefined;
		const promises: Promise<IProcessDetails | undefined>[] = [];
		if (resources) {
			for (const uri of resources) {
				const instance = this._terminalService.getInstanceFromResource(uri);
				if (instance) {
					if (sourceInstances) {
						sourceInstances.push(instance);
					} else {
						sourceInstances = [instance];
					}
					this._terminalService.moveToTerminalView(instance);
				} else if (primaryBackend) {
					const terminalIdentifier = parseTerminalUri(uri);
					if (terminalIdentifier.instanceId) {
						promises.push(primaryBackend.requestDetachInstance(terminalIdentifier.workspaceId, terminalIdentifier.instanceId));
					}
				}
			}
		}
		if (promises.length) {
			const processes = (await Promise.all(promises)).filter((process): process is IProcessDetails => !!process);
			let lastInstance: ITerminalInstance | undefined;
			for (const attachPersistentProcess of processes) {
				lastInstance = await this._terminalService.createTerminal({ config: { attachPersistentProcess } });
			}
			if (lastInstance) {
				this._terminalService.setActiveInstance(lastInstance);
			}
			return;
		}
		if (!sourceInstances || !sourceInstances.length) {
			sourceInstances = this._tabList.getSelectedElements();
			if (!sourceInstances.length) {
				return;
			}
		}
		this._terminalGroupService.moveGroupToEnd(sourceInstances);
		this._terminalService.setActiveInstance(sourceInstances[0]);
		const indexes = sourceInstances
			.map(instance => this._terminalGroupService.instances.indexOf(instance))
			.filter(index => index >= 0);
		if (indexes.length) {
			this._tabList.setSelection(indexes);
			this._tabList.setFocus([indexes[0]]);
		}
	}

	private _getTabActions(): IAction[] {
		return [
			new Separator(),
			new Action('hideTabs', localize('hideTabs', "Hide Tabs"), undefined, undefined, async () => {
				this._configurationService.updateValue(TerminalSettingId.TabsEnabled, false);
			})
		];
	}

	setEditable(isEditing: boolean): void {
		if (!isEditing) {
			this._tabList.domFocus();
		}
		this._tabList.refresh(false);
	}

	focusTabs(): void {
		if (!this._shouldShowTabs()) {
			return;
		}
		this._terminalTabsFocusContextKey.set(true);
		const selected = this._tabList.getSelection();
		this._tabList.domFocus();
		if (selected) {
			this._tabList.setFocus(selected);
		}
	}

	focus() {
		if (this._terminalService.connectionState === TerminalConnectionState.Connected) {
			this._focus();
			return;
		}

		// If the terminal is waiting to reconnect to remote terminals, then there is no TerminalInstance yet that can
		// be focused. So wait for connection to finish, then focus.
		const previousActiveElement = this._tabListElement.ownerDocument.activeElement;
		if (previousActiveElement) {
			const listener = this._register(Event.once(this._terminalService.onDidChangeConnectionState)(() => {
				// Only focus the terminal if the activeElement has not changed since focus() was called
				if (dom.isActiveElement(previousActiveElement)) {
					this._focus();
				}
				this._store.delete(listener);
			}));
		}
	}

	focusHover() {
		if (this._shouldShowTabs()) {
			this._tabList.focusHover();
			return;
		}
		const instance = this._terminalGroupService.activeInstance;
		if (!instance) {
			return;
		}
		this._hoverService.showInstantHover({
			...getInstanceHoverInfo(instance, this._storageService),
			target: this._terminalContainer,
			trapFocus: true
		}, true);
	}

	private _focus() {
		this._terminalGroupService.activeInstance?.focusWhenReady();
	}
}
