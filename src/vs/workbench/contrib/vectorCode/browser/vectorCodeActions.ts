/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { ITerminalGroupService, ITerminalService } from '../../terminal/browser/terminal.js';
import { TERMINAL_VIEW_ID } from '../../terminal/common/terminal.js';
import {
	IVectorCodeWorkbenchService,
	VECTOR_CODE_ADD_PROJECT_COMMAND_ID,
	VECTOR_CODE_CONNECT_MOBILE_COMMAND_ID,
	VECTOR_CODE_OPEN_CONTROL_COMMAND_ID,
	VECTOR_CODE_VIEW_CONTAINER_ID
} from '../common/vectorCode.js';

const vectorCodeCategory = localize2('vectorCodeCategory', 'Vector Code');
const projectsCategory = localize2('vectorCodeProjectsCategory', 'Projects');

registerAction2(class OpenVectorCodeTerminalPanelAction extends Action2 {
	constructor() {
		super({
			id: 'vectorCode.openTerminalPanel',
			title: localize2('vectorCodeOpenTerminalPanel', 'Terminal'),
			icon: Codicon.terminal,
			category: vectorCodeCategory,
			f1: true,
			menu: {
				id: MenuId.LayoutControlMenu,
				group: 'navigation',
				order: -100
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const viewsService = accessor.get(IViewsService);
		const terminalGroupService = accessor.get(ITerminalGroupService);
		const terminalService = accessor.get(ITerminalService);
		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);

		if (layoutService.isVisible(Parts.PANEL_PART) && viewsService.isViewVisible(TERMINAL_VIEW_ID)) {
			layoutService.setPartHidden(true, Parts.PANEL_PART);
			return;
		}

		let instance = terminalGroupService.activeInstance;
		if (!instance && terminalService.isProcessSupportRegistered) {
			instance = await terminalService.createTerminal({
				location: TerminalLocation.Panel,
				cwd: vectorCodeWorkbenchService.getActiveProjectUri()
			});
			terminalService.setActiveInstance(instance);
		}
		if (!layoutService.isVisible(Parts.PANEL_PART)) {
			layoutService.setPartHidden(false, Parts.PANEL_PART);
		}
		await terminalGroupService.showPanel(true);
		await instance?.focusWhenReady();
	}
});

registerAction2(class OpenVectorCodeControlAction extends Action2 {
	constructor() {
		super({
			id: VECTOR_CODE_OPEN_CONTROL_COMMAND_ID,
			title: localize2('vectorCodeOpenControl', 'Phone Connection: Open Pairing'),
			category: vectorCodeCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		await viewsService.openViewContainer(VECTOR_CODE_VIEW_CONTAINER_ID, true);
	}
});

registerAction2(class AddVectorCodeProjectAction extends Action2 {
	constructor() {
		super({
			id: VECTOR_CODE_ADD_PROJECT_COMMAND_ID,
			title: localize2('vectorCodeAddProjectCommand', 'Projects: Add Project'),
			category: projectsCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);
		await vectorCodeWorkbenchService.addProjectToWorkspace();
	}
});

registerAction2(class ConnectVectorCodeMobileAction extends Action2 {
	constructor() {
		super({
			id: VECTOR_CODE_CONNECT_MOBILE_COMMAND_ID,
			title: localize2('vectorCodeConnectMobileCommand', 'Phone Connection: Create Pairing QR'),
			category: vectorCodeCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);
		await vectorCodeWorkbenchService.connectMobileApp();
	}
});
