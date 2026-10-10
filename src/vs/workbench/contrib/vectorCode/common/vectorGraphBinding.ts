/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphBinding } from '../../../../platform/vectorGraph/common/vectorGraph.js';
export const VECTOR_GRAPH_BINDING_KEY = 'vectorCode.vectorGraph.binding.';
export function isVectorGraphBinding(binding: IVectorGraphBinding | undefined): binding is IVectorGraphBinding {
	return !!binding && typeof binding.workspace?.id === 'string' && typeof binding.workspace.name === 'string' && typeof binding.team?.id === 'string' && typeof binding.team.name === 'string';
}
export function readVectorGraphBinding(storage: IStorageService, project: string | undefined): IVectorGraphBinding | undefined {
	if (!project) { return undefined; }
	const binding = storage.getObject<IVectorGraphBinding>(VECTOR_GRAPH_BINDING_KEY + project, StorageScope.PROFILE);
	return isVectorGraphBinding(binding) ? binding : undefined;
}
