/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
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
				id: MenuId.TitleBar,
				group: 'navigation',
				order: 9000
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);
		await vectorCodeWorkbenchService.toggleActiveProjectTerminalPanel();
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
