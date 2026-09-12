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
import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { localize, localize2 } from '../../../../nls.js';
import { IViewContainersRegistry, IViewsRegistry, IViewDescriptorService, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IVectorGraphWorkService, VECTOR_GRAPH_DETAILS_VIEW } from '../common/vectorGraphWork.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { VectorGraphTicketDetails } from './vectorGraphTicketDetails.js';
import { VectorGraphTicketInput } from './vectorGraphTicketEditor.js';
import './vectorGraphWorkService.js';

export class VectorGraphDetailsView extends ViewPane {
	private details: VectorGraphTicketDetails | undefined;
	private lastSelection: unknown;
	constructor(options: IViewletViewOptions,
		@IVectorGraphWorkService private readonly work: IVectorGraphWorkService,
		@IEditorService private readonly editors: IEditorService,
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
		this._register(work.onDidChange(() => { if (this.details && this.lastSelection !== work.selection) { this.lastSelection = work.selection; void this.details.show(work.selection); } }));
	}
	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent); parent.classList.add('vector-graph-details-pane');
		const button = append(parent, $<HTMLButtonElement>('button')); button.type = 'button'; button.textContent = localize('workOpenEditorTab', 'Open in Editor Tab');
		this._register(addDisposableListener(button, EventType.CLICK, () => { const selection = this.work.selection; if (selection?.identifier) { void this.editors.openEditor(new VectorGraphTicketInput(selection.workspace, selection.identifier, selection.project), { pinned: true }); } }));
		const root = append(parent, $('.vector-graph-ticket-editor'));
		this.details = this._register(this.instantiationService.createInstance(VectorGraphTicketDetails, root));
		this.lastSelection = this.work.selection;
		void this.details.show(this.work.selection);
	}
}
const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'vectorCode.workDetails', title: localize2('vectorGraphWorkDetails', 'Work Details'), icon: Codicon.issues,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['vectorCode.workDetails', { mergeViewWithContainerWhenSingleView: true }]),
	storageId: 'vectorCode.workDetails', hideIfEmpty: true
}, ViewContainerLocation.AuxiliaryBar);
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: VECTOR_GRAPH_DETAILS_VIEW, name: localize2('vectorGraphTicketDetails', 'Ticket Details'), canToggleVisibility: true, canMoveView: true,
	ctorDescriptor: new SyncDescriptor(VectorGraphDetailsView)
}], container);
