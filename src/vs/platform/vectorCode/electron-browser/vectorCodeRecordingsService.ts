/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { IVectorCodeRecordingsService, VECTOR_CODE_RECORDINGS_CHANNEL, VectorCodeRecordingsChannelClient } from '../common/vectorCodeRecordings.js';

class VectorCodeRecordingsService extends VectorCodeRecordingsChannelClient {
	constructor(@IMainProcessService mainProcess: IMainProcessService) { super(mainProcess.getChannel(VECTOR_CODE_RECORDINGS_CHANNEL)); }
}
registerSingleton(IVectorCodeRecordingsService, VectorCodeRecordingsService, InstantiationType.Delayed);
