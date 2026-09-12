/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { IVectorCodeLibraryService, VECTOR_CODE_LIBRARY_CHANNEL } from '../common/vectorCodeLibrary.js';

// @ts-expect-error: interface is implemented by the proxy returned from the constructor.
class VectorCodeLibraryService implements IVectorCodeLibraryService {
	declare readonly _serviceBrand: undefined;
	constructor(@IMainProcessService mainProcess: IMainProcessService) { return ProxyChannel.toService<IVectorCodeLibraryService>(mainProcess.getChannel(VECTOR_CODE_LIBRARY_CHANNEL)); }
}
registerSingleton(IVectorCodeLibraryService, VectorCodeLibraryService, InstantiationType.Delayed);
