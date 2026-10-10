/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from '../../../base/common/path.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { VectorCodeLibrary } from '../node/vectorCodeLibrary.js';

export class VectorCodeLibraryMainService extends VectorCodeLibrary {
	constructor(@IEnvironmentMainService environment: IEnvironmentMainService) { super(join(environment.userDataPath, 'VectorCode', 'LocalLibrary')); }
}
