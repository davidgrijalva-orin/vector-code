/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { IVectorCodeRecordingsService, VECTOR_CODE_RECORDINGS_CHANNEL } from '../common/vectorCodeRecordings.js';

// @ts-expect-error: interface is implemented by the proxy returned from the constructor.
class VectorCodeRecordingsService implements IVectorCodeRecordingsService {
	declare readonly _serviceBrand: undefined;
	constructor(@IMainProcessService mainProcess: IMainProcessService) { return ProxyChannel.toService<IVectorCodeRecordingsService>(mainProcess.getChannel(VECTOR_CODE_RECORDINGS_CHANNEL)); }
}
registerSingleton(IVectorCodeRecordingsService, VectorCodeRecordingsService, InstantiationType.Delayed);
