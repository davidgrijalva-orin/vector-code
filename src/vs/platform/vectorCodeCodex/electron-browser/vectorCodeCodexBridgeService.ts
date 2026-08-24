/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { IVectorCodeCodexBridgeService, VECTOR_CODE_CODEX_BRIDGE_CHANNEL } from '../common/vectorCodeCodexBridge.js';

// @ts-expect-error: interface is implemented by the proxy returned from the constructor.
class VectorCodeCodexBridgeService implements IVectorCodeCodexBridgeService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		return ProxyChannel.toService<IVectorCodeCodexBridgeService>(mainProcessService.getChannel(VECTOR_CODE_CODEX_BRIDGE_CHANNEL));
	}
}

registerSingleton(IVectorCodeCodexBridgeService, VectorCodeCodexBridgeService, InstantiationType.Delayed);
