/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const VECTOR_CODE_VIEW_CONTAINER_ID = 'workbench.view.vectorCode';
export const VECTOR_CODE_CONTROL_VIEW_ID = 'workbench.views.vectorCode.control';

export const VECTOR_CODE_OPEN_CONTROL_COMMAND_ID = 'vectorCode.openControl';
export const VECTOR_CODE_ADD_PROJECT_COMMAND_ID = 'vectorCode.addProjectToWorkspace';
export const VECTOR_CODE_SEND_SELECTION_TO_TERMINAL_COMMAND_ID = 'vectorCode.sendSelectionOrLineToTerminal';
export const VECTOR_CODE_OPEN_PROJECT_TERMINAL_COMMAND_ID = 'vectorCode.openProjectTerminal';
export const VECTOR_CODE_CONNECT_MOBILE_COMMAND_ID = 'vectorCode.connectMobileApp';

export interface IVectorCodeProjectSummary {
	readonly name: string;
	readonly uriLabel: string;
}

export const IVectorCodeWorkbenchService = createDecorator<IVectorCodeWorkbenchService>('vectorCodeWorkbenchService');

export interface IVectorCodeWorkbenchService {
	readonly _serviceBrand: undefined;

	getProjectStatusLabel(): string;
	getProjectSummaries(): readonly IVectorCodeProjectSummary[];
	addProjectToWorkspace(): Promise<void>;
	sendSelectionOrLineToTerminal(): Promise<void>;
	openProjectTerminal(): Promise<void>;
	connectMobileApp(): Promise<void>;
}
