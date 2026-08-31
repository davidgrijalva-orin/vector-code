/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { localize } from '../../../nls.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IVectorCodeCodexBridgeConnectionChange, IVectorCodeCodexBridgeNotification, IVectorCodeCodexBridgeRequest, IVectorCodeCodexBridgeServerRequest, IVectorCodeCodexBridgeService, IVectorCodeCodexBridgeStartOptions, VectorCodeCodexRequestId } from '../common/vectorCodeCodexBridge.js';

class BrowserVectorCodeCodexBridgeService implements IVectorCodeCodexBridgeService {
	declare readonly _serviceBrand: undefined;

	readonly onDidReceiveNotification = Event.None as Event<IVectorCodeCodexBridgeNotification>;
	readonly onDidReceiveServerRequest = Event.None as Event<IVectorCodeCodexBridgeServerRequest>;
	readonly onDidChangeConnection = Event.None as Event<IVectorCodeCodexBridgeConnectionChange>;

	start(_options: IVectorCodeCodexBridgeStartOptions): Promise<string> {
		return Promise.reject(this.unavailable());
	}

	request<TResult = unknown>(_connectionId: string, _request: IVectorCodeCodexBridgeRequest): Promise<TResult> {
		return Promise.reject(this.unavailable());
	}

	cancelRequest(_connectionId: string, _requestId: VectorCodeCodexRequestId): Promise<void> {
		return Promise.reject(this.unavailable());
	}

	notify(_connectionId: string, _method: string, _params?: unknown): Promise<void> {
		return Promise.reject(this.unavailable());
	}

	respond(_connectionId: string, _id: VectorCodeCodexRequestId, _result: unknown): Promise<void> {
		return Promise.reject(this.unavailable());
	}

	respondError(_connectionId: string, _id: VectorCodeCodexRequestId, _message: string): Promise<void> {
		return Promise.reject(this.unavailable());
	}

	stop(_connectionId: string): Promise<void> {
		return Promise.reject(this.unavailable());
	}

	private unavailable(): Error {
		return new Error(localize('vectorCodeCodexBridgeUnavailable', 'Codex is available only in the desktop application.'));
	}
}

registerSingleton(IVectorCodeCodexBridgeService, BrowserVectorCodeCodexBridgeService, InstantiationType.Delayed);
