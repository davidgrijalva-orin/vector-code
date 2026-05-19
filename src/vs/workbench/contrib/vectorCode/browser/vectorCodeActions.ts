/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import {
	IVectorCodeWorkbenchService,
	VECTOR_CODE_ADD_PROJECT_COMMAND_ID,
	VECTOR_CODE_CONNECT_MOBILE_COMMAND_ID,
	VECTOR_CODE_OPEN_CONTROL_COMMAND_ID,
	VECTOR_CODE_OPEN_PROJECT_TERMINAL_COMMAND_ID,
	VECTOR_CODE_SEND_SELECTION_TO_TERMINAL_COMMAND_ID,
	VECTOR_CODE_VIEW_CONTAINER_ID
} from '../common/vectorCode.js';

const vectorCodeCategory = localize2('vectorCodeCategory', 'Vector Code');

registerAction2(class OpenVectorCodeControlAction extends Action2 {
	constructor() {
		super({
			id: VECTOR_CODE_OPEN_CONTROL_COMMAND_ID,
			title: localize2('vectorCodeOpenControl', 'Vector Code: Open Control'),
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
			title: localize2('vectorCodeAddProjectCommand', 'Vector Code: Add Project to Workspace'),
			category: vectorCodeCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);
		await vectorCodeWorkbenchService.addProjectToWorkspace();
	}
});

registerAction2(class SendVectorCodeSelectionToTerminalAction extends Action2 {
	constructor() {
		super({
			id: VECTOR_CODE_SEND_SELECTION_TO_TERMINAL_COMMAND_ID,
			title: localize2('vectorCodeSendSelectionToTerminalCommand', 'Vector Code: Send Selection or Line to Terminal'),
			category: vectorCodeCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);
		await vectorCodeWorkbenchService.sendSelectionOrLineToTerminal();
	}
});

registerAction2(class OpenVectorCodeProjectTerminalAction extends Action2 {
	constructor() {
		super({
			id: VECTOR_CODE_OPEN_PROJECT_TERMINAL_COMMAND_ID,
			title: localize2('vectorCodeOpenProjectTerminalCommand', 'Vector Code: Open Project Terminal'),
			category: vectorCodeCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);
		await vectorCodeWorkbenchService.openProjectTerminal();
	}
});

registerAction2(class ConnectVectorCodeMobileAction extends Action2 {
	constructor() {
		super({
			id: VECTOR_CODE_CONNECT_MOBILE_COMMAND_ID,
			title: localize2('vectorCodeConnectMobileCommand', 'Vector Code: Connect Mobile App'),
			category: vectorCodeCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);
		await vectorCodeWorkbenchService.connectMobileApp();
	}
});
