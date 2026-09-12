/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import { IWorkspacesManagementMainService } from '../../workspaces/electron-main/workspacesManagementMainService.js';
import { isSingleFolderWorkspaceIdentifier } from '../../workspace/common/workspace.js';
import { IWorkspaceTrustInfo, WORKSPACE_TRUST_STORAGE_KEY } from '../../workspace/common/workspaceTrust.js';
import { authorizeVectorGraphRepository } from '../node/vectorGraphRepositoryAccess.js';

export class VectorGraphRepositoryAccess {
	constructor(
		@IWindowsMainService private readonly windows: IWindowsMainService,
		@IWorkspacesManagementMainService private readonly workspaces: IWorkspacesManagementMainService,
		@IStorageMainService private readonly storage: IStorageMainService,
		@IConfigurationService private readonly configuration: IConfigurationService,
	) { }
	async authorize(context: unknown, project: string, write: boolean): Promise<string> {
		const match = typeof context === 'string' ? /^window:([0-9]+)$/.exec(context) : undefined;
		const window = match ? this.windows.getWindowById(Number(match[1])) : undefined;
		const workspace = window?.openedWorkspace;
		if (!workspace) { throw new Error('Open a workspace before using repository actions.'); }
		const roots = isSingleFolderWorkspaceIdentifier(workspace) ? [workspace.uri] : (await this.workspaces.resolveLocalWorkspace(workspace.configPath))?.folders.map(folder => folder.uri) ?? [];
		let trusted: URI[] | undefined;
		if (write && this.configuration.getValue('security.workspace.trust.enabled') !== false) {
			await this.storage.applicationSharedStorage.whenInit;
			const model: IWorkspaceTrustInfo = JSON.parse(this.storage.applicationSharedStorage.storage.get(WORKSPACE_TRUST_STORAGE_KEY, '{}'));
			trusted = (model.uriTrustInfo ?? []).filter(info => info.trusted).map(info => URI.revive(info.uri));
		}
		const additionalTrustRoots = !isSingleFolderWorkspaceIdentifier(workspace) && !this.workspaces.isUntitledWorkspace(workspace) ? [workspace.configPath] : [];
		const result = await authorizeVectorGraphRepository(project, roots, trusted, additionalTrustRoots);
		if (window.openedWorkspace !== workspace) { throw new Error('The workspace changed. Retry from Work.'); }
		return result;
	}
}
