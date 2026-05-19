/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IVectorCodeMobileConnectionStatus, IVectorCodeMobileRelayService, VectorCodeMobileConnectionState } from '../common/vectorCode.js';

class VectorCodeMobileRelayService implements IVectorCodeMobileRelayService {
	readonly _serviceBrand: undefined;

	getStatus(): IVectorCodeMobileConnectionStatus {
		return {
			state: VectorCodeMobileConnectionState.Unconfigured,
			label: localize('vectorCodeMobileRelayPending', 'Native relay adapter pending'),
			detail: localize('vectorCodeMobileRelayPendingDetail', 'Vector Code mobile pairing will use the native relay adapter once the desktop runtime is connected to the relay service.')
		};
	}

	async startPairing(): Promise<IVectorCodeMobileConnectionStatus> {
		return this.getStatus();
	}
}

registerSingleton(IVectorCodeMobileRelayService, VectorCodeMobileRelayService, InstantiationType.Delayed);
