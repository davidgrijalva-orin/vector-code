/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphBinding } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { isVectorGraphBinding, readVectorGraphBinding } from './vectorGraphBinding.js';

export const VECTOR_CODE_WORK_PROJECT_KEY = 'vectorGraph.document.workProject';

/** Backend identity is independent of the number and location of local folders. */
export function workProjectFolderKey(binding: IVectorGraphBinding): string {
	if (!binding.project) { throw new Error('A work project must have a project identity.'); }
	return 'vectorCode.workProject.folders.' + JSON.stringify([binding.workspace.id, binding.team.id, binding.project.id]);
}

export function readSelectedWorkProject(storage: IStorageService): IVectorGraphBinding | undefined {
	const binding = storage.getObject<IVectorGraphBinding>(VECTOR_CODE_WORK_PROJECT_KEY, StorageScope.WORKSPACE);
	return isVectorGraphBinding(binding) && typeof binding.project?.id === 'string' && typeof binding.project.name === 'string' ? binding : undefined;
}

/** Associations are local presentation state, not filesystem or execution grants. */
export function readWorkProjectFolders(storage: IStorageService, binding: IVectorGraphBinding): readonly string[] | undefined {
	const value = storage.getObject<object>(workProjectFolderKey(binding), StorageScope.PROFILE);
	return Array.isArray(value) && value.every(folder => typeof folder === 'string') ? [...new Set(value)] : undefined;
}

export function writeWorkProjectFolders(storage: IStorageService, binding: IVectorGraphBinding, folders: readonly string[]): void {
	storage.store(workProjectFolderKey(binding), [...new Set(folders)], StorageScope.PROFILE, StorageTarget.MACHINE);
}

/** Offer existing same-project folder bindings for migration; an explicit empty set stays empty. */
export function resolveWorkProjectFolders(storage: IStorageService, binding: IVectorGraphBinding, openFolders: readonly string[]): readonly string[] {
	return readWorkProjectFolders(storage, binding) ?? openFolders.filter(folder => {
		const legacy = readVectorGraphBinding(storage, folder);
		return legacy?.project && workProjectFolderKey(legacy) === workProjectFolderKey(binding);
	});
}
