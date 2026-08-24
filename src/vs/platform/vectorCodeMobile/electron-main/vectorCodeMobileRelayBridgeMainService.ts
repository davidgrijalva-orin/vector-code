/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { net } from 'electron';
import { getCACertificates } from 'tls';
import type { WebSocket as WebSocketType } from 'ws';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogService } from '../../log/common/log.js';
import { isVectorCodeRuntimeError, VectorCodeRuntimeError, VectorCodeRuntimeErrorCode } from '../../vectorCode/common/vectorCodeRuntime.js';
import { IVectorCodeMobileRelayBridgeConnectOptions, IVectorCodeMobileRelayBridgeConnectionChange, IVectorCodeMobileRelayBridgeMessage, IVectorCodeMobileRelayBridgeService, IVectorCodeMobileRelayBridgeTokenOptions, IVectorCodeMobileRelayBridgeTokenResponse } from '../common/vectorCodeMobileRelayBridge.js';
import { normalizeVectorCodeRelayTokenResponse } from '../common/vectorCodeMobileRelayToken.js';

interface IVectorCodeMobileRelayBridgeConnection {
	readonly socket: WebSocketType;
	readonly disposables: DisposableStore;
	readonly correlationId: string;
}

const WEB_SOCKET_OPEN_STATE = 1;
const VECTOR_CODE_MOBILE_RELAY_REQUEST_TIMEOUT_MS = 10_000;
const VECTOR_CODE_MOBILE_RELAY_CA_CERTIFICATES = [...new Set([
	...getCACertificates('default'),
	...getCACertificates('system')
])];

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
		this.logService.info(`[VectorCode][Mobile][${options.correlationId}] relay.connect.started`);
		const { WebSocket } = await import('ws');
		const connectionId = `vector-mobile-${generateUuid()}`;
		const socket = new WebSocket(options.url, {
			headers: {
				Authorization: options.authorizationHeader
			},
			ca: VECTOR_CODE_MOBILE_RELAY_CA_CERTIFICATES
		});
		const disposables = new DisposableStore();

		this.connections.set(connectionId, { socket, disposables, correlationId: options.correlationId });
		disposables.add(toDisposable(() => socket.close()));
		socket.on('message', data => {
			this._onDidReceiveMessage.fire({
				connectionId,
				message: data.toString()
			});
		});
		socket.on('close', () => {
			this.connections.delete(connectionId);
			this.logService.info(`[VectorCode][Mobile][${options.correlationId}] relay.connect.closed`);
			this._onDidChangeConnection.fire({ connectionId, state: 'closed' });
			disposables.dispose();
		});
		socket.on('error', error => {
			const errorName = error instanceof Error ? error.name : typeof error;
			this.logService.warn(`[VectorCode][Mobile][${options.correlationId}] relay.connect.error (${errorName})`);
			this._onDidChangeConnection.fire({ connectionId, state: 'error', detail: 'Relay socket transport error.' });
		});

		try {
			await waitForOpen(socket, options.correlationId);
			this.logService.info(`[VectorCode][Mobile][${options.correlationId}] relay.connect.open`);
			this._onDidChangeConnection.fire({ connectionId, state: 'open' });
			return connectionId;
		} catch (error) {
			this.connections.delete(connectionId);
			disposables.dispose();
			if (isVectorCodeRuntimeError(error)) {
				throw error;
			}
			throw new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.NetworkUnavailable,
				'The phone relay could not be reached. Check the network and try again.',
				error instanceof Error ? error.name : typeof error,
				true,
				options.correlationId,
			);
		}
	}

	async createRelayToken(options: IVectorCodeMobileRelayBridgeTokenOptions): Promise<IVectorCodeMobileRelayBridgeTokenResponse | undefined> {
		this.logService.info(`[VectorCode][Mobile][${options.correlationId}] relay.token.started`);
		let response: Response;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), VECTOR_CODE_MOBILE_RELAY_REQUEST_TIMEOUT_MS);
		try {
			response = await net.fetch(options.url, {
				method: 'POST',
				headers: {
					Authorization: options.authorizationHeader,
					'content-type': 'application/json'
				},
				body: JSON.stringify(options.payload),
				signal: controller.signal,
			});
		} catch (error) {
			const timedOut = controller.signal.aborted;
			const errorName = error instanceof Error ? error.name : typeof error;
			this.logService.warn(`[VectorCode][Mobile][${options.correlationId}] relay.token.failed (${timedOut ? VectorCodeRuntimeErrorCode.RequestTimeout : errorName})`);
			throw new VectorCodeRuntimeError(
				timedOut ? VectorCodeRuntimeErrorCode.RequestTimeout : VectorCodeRuntimeErrorCode.NetworkUnavailable,
				timedOut
					? 'The phone relay token service took too long to respond. Try again.'
					: 'The phone relay token service is unavailable. Check the network and try again.',
				timedOut ? `Relay token request timed out after ${VECTOR_CODE_MOBILE_RELAY_REQUEST_TIMEOUT_MS}ms.` : errorName,
				true,
				options.correlationId,
			);
		} finally {
			clearTimeout(timeout);
		}
		if (!response.ok) {
			this.logService.warn(`[VectorCode][Mobile][${options.correlationId}] relay.token.rejected (${response.status})`);
			if (response.status === 400 || response.status === 401 || response.status === 403) {
				return undefined;
			}
			throw new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.NetworkUnavailable,
				'The phone relay token service returned an unexpected response. Try again.',
				`HTTP status ${response.status}`,
				true,
				options.correlationId,
			);
		}

		let relayToken: IVectorCodeMobileRelayBridgeTokenResponse | undefined;
		try {
			relayToken = normalizeVectorCodeRelayTokenResponse(await response.json());
		} catch (error) {
			const errorName = error instanceof Error ? error.name : typeof error;
			this.logService.warn(`[VectorCode][Mobile][${options.correlationId}] relay.token.invalid_json (${errorName})`);
		}
		if (!relayToken) {
			this.logService.warn(`[VectorCode][Mobile][${options.correlationId}] relay.token.invalid_response`);
			throw new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.InvalidState,
				'The phone relay token service returned an invalid response. Try again.',
				'Token response validation failed.',
				true,
				options.correlationId,
			);
		}
		this.logService.info(`[VectorCode][Mobile][${options.correlationId}] relay.token.completed`);
		return relayToken;
	}

	async send(connectionId: string, message: string): Promise<void> {
		const connection = this.connections.get(connectionId);
		if (!connection || connection.socket.readyState !== WEB_SOCKET_OPEN_STATE) {
			throw new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.ConnectionLost,
				'The phone relay connection was lost. Reconnect and try again.',
				'Relay socket is not open.',
				true,
				connection?.correlationId,
			);
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

function waitForOpen(socket: WebSocketType, correlationId: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.RequestTimeout,
				'The phone relay took too long to connect. Try again.',
				'Relay socket open timed out after 10000ms.',
				true,
				correlationId,
			));
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
			reject(new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.NetworkUnavailable,
				'The phone relay could not be reached. Check the network and try again.',
				error.name,
				true,
				correlationId,
			));
		};
		socket.once('open', onOpen);
		socket.once('error', onError);
	});
}
