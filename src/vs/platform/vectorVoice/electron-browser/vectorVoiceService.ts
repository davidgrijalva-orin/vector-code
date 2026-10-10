/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { IVectorVoiceService, VECTOR_VOICE_CHANNEL } from '../common/vectorVoice.js';

// @ts-expect-error: interface is implemented by the proxy returned from the constructor.
class VectorVoiceService implements IVectorVoiceService {
	declare readonly _serviceBrand: undefined;
	constructor(@IMainProcessService mainProcess: IMainProcessService) { return ProxyChannel.toService<IVectorVoiceService>(mainProcess.getChannel(VECTOR_VOICE_CHANNEL)); }
}
registerSingleton(IVectorVoiceService, VectorVoiceService, InstantiationType.Delayed);
