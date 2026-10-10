/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphBinding } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorCodeProjectSummary } from '../common/vectorCode.js';
import { resolveWorkProjectFolders, writeWorkProjectFolders } from '../common/vectorCodeWorkProject.js';

export interface IWorkProjectFolder {
	readonly uri: string;
	readonly label: string;
	readonly description: string;
	readonly open: boolean;
}

export function workProjectFolderItems(storage: IStorageService, binding: IVectorGraphBinding, openFolders: readonly IVectorCodeProjectSummary[]): readonly IWorkProjectFolder[] {
	return resolveWorkProjectFolders(storage, binding, openFolders.map(folder => folder.uri.toString())).map(uri => {
		const folder = openFolders.find(folder => folder.uri.toString() === uri);
		return {
			uri, label: folder?.name ?? URI.parse(uri).path.split('/').filter(Boolean).at(-1) ?? uri,
			description: folder?.uriLabel ?? localize('workProjectFolderClosed', 'Not open in this window: {0}', uri), open: !!folder
		};
	});
}

/** Change membership only. Never open, close, delete or authorize local resources. */
export async function manageWorkProjectFolders(storage: IStorageService, quick: IQuickInputService, binding: IVectorGraphBinding, openFolders: readonly IVectorCodeProjectSummary[], isCurrent: () => boolean): Promise<void> {
	const folders = workProjectFolderItems(storage, binding, openFolders);
	const existing = new Set(folders.map(folder => folder.uri));
	const items = [...folders.map(folder => ({ ...folder, picked: true })), ...openFolders.filter(folder => !existing.has(folder.uri.toString())).map(folder => ({
		uri: folder.uri.toString(), label: folder.name, description: folder.uriLabel, open: true, picked: false
	}))];
	const selected = await quick.pick(items, {
		canPickMany: true, title: localize('manageWorkProjectFolders', 'Folders in {0}', binding.project!.name),
		placeHolder: localize('workProjectFoldersHint', 'Select any number of folders, or none. Add other folders to this window first.')
	});
	if (selected && isCurrent()) { writeWorkProjectFolders(storage, binding, selected.map(folder => folder.uri)); }
}
