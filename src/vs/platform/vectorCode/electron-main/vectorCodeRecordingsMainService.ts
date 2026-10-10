/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from '../../../base/common/path.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IVectorCodeLibraryService } from '../common/vectorCodeLibrary.js';
import { VectorCodeRecordings } from '../node/vectorCodeRecordings.js';

export class VectorCodeRecordingsMainService extends VectorCodeRecordings {
	constructor(@IEnvironmentMainService environment: IEnvironmentMainService, @IVectorCodeLibraryService library: IVectorCodeLibraryService) { super(join(environment.userDataPath, 'VectorCode', 'Recordings'), library); }
}
