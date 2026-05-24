/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WebSocket as WebSocketType } from 'ws';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogService } from '../../log/common/log.js';
import { IVectorCodeMobileRelayBridgeConnectOptions, IVectorCodeMobileRelayBridgeConnectionChange, IVectorCodeMobileRelayBridgeMessage, IVectorCodeMobileRelayBridgeService, IVectorCodeMobileRelayBridgeTokenOptions, IVectorCodeMobileRelayBridgeTokenResponse } from '../common/vectorCodeMobileRelayBridge.js';

interface IVectorCodeMobileRelayBridgeConnection {
	readonly socket: WebSocketType;
	readonly disposables: DisposableStore;
}

const WEB_SOCKET_OPEN_STATE = 1;

export class VectorCodeMobileRelayBridgeMainService extends Disposable implements IVectorCodeMobileRelayBridgeService {
	declare readonly _serviceBrand: undefined;

	private readonly connections = new Map<string, IVectorCodeMobileRelayBridgeConnection>();
	private readonly _onDidReceiveMessage = this._register(new Emitter<IVectorCodeMobileRelayBridgeMessage>());
	readonly onDidReceiveMessage = this._onDidReceiveMessage.event;
	private readonly _onDidChangeConnection = this._register(new Emitter<IVectorCodeMobileRelayBridgeConnectionChange>());
	readonly onDidChangeConnection = this._onDidChangeConnection.event;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async connect(options: IVectorCodeMobileRelayBridgeConnectOptions): Promise<string> {
		const { WebSocket } = await import('ws');
		const connectionId = `vector-mobile-${generateUuid()}`;
		const socket = new WebSocket(options.url, {
			headers: {
				Authorization: options.authorizationHeader
			}
		});
		const disposables = new DisposableStore();

		this.connections.set(connectionId, { socket, disposables });
		disposables.add(toDisposable(() => socket.close()));
		socket.on('message', data => {
			this._onDidReceiveMessage.fire({
				connectionId,
				message: data.toString()
			});
		});
		socket.on('close', () => {
			this.connections.delete(connectionId);
			this._onDidChangeConnection.fire({ connectionId, state: 'closed' });
			disposables.dispose();
		});
		socket.on('error', error => {
			const detail = error instanceof Error ? error.message : String(error);
			this.logService.warn(`VectorCode mobile relay bridge socket error: ${detail}`);
			this._onDidChangeConnection.fire({ connectionId, state: 'error', detail });
		});

		try {
			await waitForOpen(socket);
			this._onDidChangeConnection.fire({ connectionId, state: 'open' });
			return connectionId;
		} catch (error) {
			this.connections.delete(connectionId);
			disposables.dispose();
			throw error;
		}
	}

	async createRelayToken(options: IVectorCodeMobileRelayBridgeTokenOptions): Promise<IVectorCodeMobileRelayBridgeTokenResponse | undefined> {
		try {
			const response = await fetch(options.url, {
				method: 'POST',
				headers: {
					Authorization: options.authorizationHeader,
					'content-type': 'application/json'
				},
				body: JSON.stringify(options.payload)
			});
			if (!response.ok) {
				this.logService.warn(`VectorCode mobile relay token request failed with status ${response.status}.`);
				return undefined;
			}

			const body = await response.json() as { token?: unknown; expiresAt?: unknown };
			const relayToken = typeof body?.token === 'string' ? body.token.trim() : '';
			const relayTokenExpiresAt = typeof body?.expiresAt === 'string' ? body.expiresAt.trim() : '';
			if (!relayToken || !relayTokenExpiresAt) {
				this.logService.warn('VectorCode mobile relay token response did not include a token and expiry.');
				return undefined;
			}
			return { relayToken, relayTokenExpiresAt };
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.logService.warn(`VectorCode mobile relay token request failed: ${detail}`);
			return undefined;
		}
	}

	async send(connectionId: string, message: string): Promise<void> {
		const connection = this.connections.get(connectionId);
		if (!connection || connection.socket.readyState !== WEB_SOCKET_OPEN_STATE) {
			throw new Error('VectorCode mobile relay bridge is not connected.');
		}
		await new Promise<void>((resolve, reject) => {
			connection.socket.send(message, error => error ? reject(error) : resolve());
		});
	}

	async disconnect(connectionId: string): Promise<void> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			return;
		}
		this.connections.delete(connectionId);
		connection.disposables.dispose();
	}
}

function waitForOpen(socket: WebSocketType): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Timed out connecting to the VectorCode mobile relay.'));
		}, 10_000);
		const cleanup = () => {
			clearTimeout(timeout);
			socket.off('open', onOpen);
			socket.off('error', onError);
		};
		const onOpen = () => {
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		socket.once('open', onOpen);
		socket.once('error', onError);
	});
}
