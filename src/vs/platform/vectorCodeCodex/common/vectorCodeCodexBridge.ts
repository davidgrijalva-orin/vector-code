/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const VECTOR_CODE_CODEX_BRIDGE_CHANNEL = 'vectorCodeCodexBridge';

export type VectorCodeCodexRequestId = number | string;

export interface IVectorCodeCodexBridgeStartOptions {
	readonly cwd?: string;
}

export interface IVectorCodeCodexBridgeRequest {
	readonly id: VectorCodeCodexRequestId;
	readonly method: string;
	readonly params?: unknown;
	readonly timeoutMs?: number;
}

export interface IVectorCodeCodexBridgeNotification {
	readonly connectionId: string;
	readonly method: string;
	readonly params?: unknown;
}

export interface IVectorCodeCodexBridgeServerRequest extends IVectorCodeCodexBridgeNotification {
	readonly id: VectorCodeCodexRequestId;
}

export interface IVectorCodeCodexBridgeConnectionChange {
	readonly connectionId: string;
	readonly state: 'started' | 'stopped' | 'error';
	readonly detail?: string;
}

export const IVectorCodeCodexBridgeService = createDecorator<IVectorCodeCodexBridgeService>('vectorCodeCodexBridgeService');

/**
 * Process-isolated JSONL transport for the public Codex App Server protocol.
 * Product behavior belongs in the workbench adapter; this service only owns the process and RPC framing.
 */
export interface IVectorCodeCodexBridgeService {
	readonly _serviceBrand: undefined;

	readonly onDidReceiveNotification: Event<IVectorCodeCodexBridgeNotification>;
	readonly onDidReceiveServerRequest: Event<IVectorCodeCodexBridgeServerRequest>;
	readonly onDidChangeConnection: Event<IVectorCodeCodexBridgeConnectionChange>;

	start(options: IVectorCodeCodexBridgeStartOptions): Promise<string>;
	request<TResult = unknown>(connectionId: string, request: IVectorCodeCodexBridgeRequest): Promise<TResult>;
	cancelRequest(connectionId: string, requestId: VectorCodeCodexRequestId): Promise<void>;
	notify(connectionId: string, method: string, params?: unknown): Promise<void>;
	respond(connectionId: string, id: VectorCodeCodexRequestId, result: unknown): Promise<void>;
	respondError(connectionId: string, id: VectorCodeCodexRequestId, message: string): Promise<void>;
	stop(connectionId: string): Promise<void>;
}
