/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { IVectorCodeMobileRelayBridgeService, VECTOR_CODE_MOBILE_RELAY_BRIDGE_CHANNEL } from '../common/vectorCodeMobileRelayBridge.js';

// @ts-expect-error: interface is implemented by the proxy returned from the constructor.
class VectorCodeMobileRelayBridgeService implements IVectorCodeMobileRelayBridgeService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		return ProxyChannel.toService<IVectorCodeMobileRelayBridgeService>(mainProcessService.getChannel(VECTOR_CODE_MOBILE_RELAY_BRIDGE_CHANNEL));
	}
}

registerSingleton(IVectorCodeMobileRelayBridgeService, VectorCodeMobileRelayBridgeService, InstantiationType.Delayed);
