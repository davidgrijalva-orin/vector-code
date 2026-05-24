/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const VECTOR_CODE_MOBILE_RELAY_BRIDGE_CHANNEL = 'vectorCodeMobileRelayBridge';

export interface IVectorCodeMobileRelayBridgeConnectOptions {
	readonly url: string;
	readonly authorizationHeader: string;
}

export interface IVectorCodeMobileRelayBridgeTokenOptions {
	readonly url: string;
	readonly authorizationHeader: string;
	readonly payload: {
		readonly role: 'phone' | 'desktop';
		readonly userId: string;
		readonly desktopId: string;
		readonly pairingId?: string;
		readonly ttlSeconds: number;
	};
}

export interface IVectorCodeMobileRelayBridgeTokenResponse {
	readonly relayToken: string;
	readonly relayTokenExpiresAt: string;
}

export interface IVectorCodeMobileRelayBridgeMessage {
	readonly connectionId: string;
	readonly message: string;
}

export interface IVectorCodeMobileRelayBridgeConnectionChange {
	readonly connectionId: string;
	readonly state: 'open' | 'closed' | 'error';
	readonly detail?: string;
}

export const IVectorCodeMobileRelayBridgeService = createDecorator<IVectorCodeMobileRelayBridgeService>('vectorCodeMobileRelayBridgeService');

export interface IVectorCodeMobileRelayBridgeService {
	readonly _serviceBrand: undefined;

	readonly onDidReceiveMessage: Event<IVectorCodeMobileRelayBridgeMessage>;
	readonly onDidChangeConnection: Event<IVectorCodeMobileRelayBridgeConnectionChange>;

	connect(options: IVectorCodeMobileRelayBridgeConnectOptions): Promise<string>;
	createRelayToken(options: IVectorCodeMobileRelayBridgeTokenOptions): Promise<IVectorCodeMobileRelayBridgeTokenResponse | undefined>;
	send(connectionId: string, message: string): Promise<void>;
	disconnect(connectionId: string): Promise<void>;
}
