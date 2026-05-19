/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ADD_ROOT_FOLDER_COMMAND_ID } from '../../../browser/actions/workspaceCommands.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';
import { TerminalCommandId } from '../../terminal/common/terminal.js';
import { IVectorCodeProjectSummary, IVectorCodeWorkbenchService, VECTOR_CODE_VIEW_CONTAINER_ID } from '../common/vectorCode.js';

class VectorCodeWorkbenchService implements IVectorCodeWorkbenchService {
	readonly _serviceBrand: undefined;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@ILabelService private readonly labelService: ILabelService,
		@INotificationService private readonly notificationService: INotificationService,
		@IViewsService private readonly viewsService: IViewsService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) { }

	getProjectStatusLabel(): string {
		const projectCount = this.workspaceContextService.getWorkspace().folders.length;
		if (projectCount === 0) {
			return localize('vectorCodeProjectsEmpty', 'No projects in this workspace');
		}
		if (projectCount === 1) {
			return localize('vectorCodeProjectsSingle', '1 project in this workspace');
		}
		return localize('vectorCodeProjectsMany', '{0} projects in this workspace', projectCount);
	}

	getProjectSummaries(): readonly IVectorCodeProjectSummary[] {
		return this.workspaceContextService.getWorkspace().folders.map(folder => ({
			name: folder.name,
			uriLabel: this.labelService.getUriLabel(folder.uri, { appendWorkspaceSuffix: true })
		}));
	}

	async addProjectToWorkspace(): Promise<void> {
		await this.commandService.executeCommand(ADD_ROOT_FOLDER_COMMAND_ID);
		await this.viewsService.openViewContainer(EXPLORER_VIEWLET_ID, true);
	}

	async sendSelectionOrLineToTerminal(): Promise<void> {
		await this.commandService.executeCommand(TerminalCommandId.RunSelectedText);
	}

	async openProjectTerminal(): Promise<void> {
		await this.commandService.executeCommand(TerminalCommandId.NewInActiveWorkspace);
		await this.commandService.executeCommand(TerminalCommandId.Focus);
	}

	async connectMobileApp(): Promise<void> {
		await this.viewsService.openViewContainer(VECTOR_CODE_VIEW_CONTAINER_ID, true);
		this.notificationService.info(localize('vectorCodeMobileConnectionPending', 'Vector Code mobile connection will use the native relay adapter. That adapter is the next implementation slice.'));
	}
}

registerSingleton(IVectorCodeWorkbenchService, VectorCodeWorkbenchService, InstantiationType.Delayed);
