/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Schemas } from '../../../../base/common/network.js';
import { isWindows } from '../../../../base/common/platform.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IsWindowsContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { IExternalTerminalSettings } from '../../../../platform/externalTerminal/common/externalTerminal.js';
import { IExternalTerminalService } from '../../../../platform/externalTerminal/electron-browser/externalTerminalService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IVectorCodeWorkbenchService, VECTOR_CODE_OPEN_ADMIN_TERMINAL_COMMAND_ID } from '../common/vectorCode.js';

const vectorCodeCategory = localize2('vectorCodeAdminTerminalCategory', 'Vector Code');
const terminalMenuCreateGroup = '1_create';

registerAction2(class OpenVectorCodeAdminTerminalWindowAction extends Action2 {
	constructor() {
		super({
			id: VECTOR_CODE_OPEN_ADMIN_TERMINAL_COMMAND_ID,
			title: localize2('vectorCodeOpenAdminTerminalWindow', 'Terminal: Open Admin Terminal Window'),
			icon: Codicon.shield,
			category: vectorCodeCategory,
			f1: true,
			precondition: IsWindowsContext,
			menu: {
				id: MenuId.MenubarTerminalMenu,
				group: terminalMenuCreateGroup,
				order: 3,
				when: IsWindowsContext
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		if (!isWindows) {
			notificationService.warn(localize('vectorCodeAdminTerminalWindowsOnly', 'Admin terminal windows are only supported on Windows.'));
			return;
		}

		const vectorCodeWorkbenchService = accessor.get(IVectorCodeWorkbenchService);
		const configurationService = accessor.get(IConfigurationService);
		const externalTerminalService = accessor.get(IExternalTerminalService);
		const projectUri = vectorCodeWorkbenchService.getActiveProjectUri() ?? vectorCodeWorkbenchService.getProjectSummaries()[0]?.uri;
		const cwd = projectUri?.scheme === Schemas.file ? projectUri.fsPath : undefined;
		const config = configurationService.getValue<IExternalTerminalSettings>('terminal.external');

		try {
			await externalTerminalService.openTerminal(config, cwd, { elevated: true });
		} catch (error) {
			notificationService.error(error instanceof Error ? error.message : localize('vectorCodeAdminTerminalOpenFailed', 'Unable to open an admin terminal window.'));
		}
	}
});
