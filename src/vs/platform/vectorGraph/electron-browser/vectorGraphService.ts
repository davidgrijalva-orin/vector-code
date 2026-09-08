/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { IVectorGraphService, VECTOR_GRAPH_CHANNEL } from '../common/vectorGraph.js';

// @ts-expect-error: interface is implemented by the proxy returned from the constructor.
class VectorGraphService implements IVectorGraphService {
	declare readonly _serviceBrand: undefined;
	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		return ProxyChannel.toService<IVectorGraphService>(mainProcessService.getChannel(VECTOR_GRAPH_CHANNEL));
	}
}
registerSingleton(IVectorGraphService, VectorGraphService, InstantiationType.Delayed);
