/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { existsSync } from 'fs';
import { createInterface, Interface as ReadlineInterface } from 'readline';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { dirname, join } from '../../../base/common/path.js';
import { findExecutable } from '../../../base/node/processes.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogService } from '../../log/common/log.js';
import { VectorCodeRuntimeError, VectorCodeRuntimeErrorCode } from '../../vectorCode/common/vectorCodeRuntime.js';
import { isVectorCodeCodexAuthenticationError, IVectorCodeCodexBridgeConnectionChange, IVectorCodeCodexBridgeNotification, IVectorCodeCodexBridgeRequest, IVectorCodeCodexBridgeServerRequest, IVectorCodeCodexBridgeService, IVectorCodeCodexBridgeStartOptions, VectorCodeCodexRequestId } from '../common/vectorCodeCodexBridge.js';
import { VectorCodeCodexPendingRequests } from '../common/vectorCodeCodexPendingRequests.js';

interface IVectorCodeCodexBridgeConnection {
	readonly process: ChildProcessWithoutNullStreams;
	readonly output: ReadlineInterface;
	readonly pending: VectorCodeCodexPendingRequests;
	stderrBytes: number;
	stopping: boolean;
}

interface IVectorCodeCodexProtocolMessage {
	readonly id?: VectorCodeCodexRequestId;
	readonly method?: string;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

const CODEX_REQUEST_TIMEOUT_MS = 120_000;
const CODEX_REQUEST_TIMEOUT_MIN_MS = 1_000;
const CODEX_REQUEST_TIMEOUT_MAX_MS = 300_000;

export class VectorCodeCodexBridgeMainService extends Disposable implements IVectorCodeCodexBridgeService {
	declare readonly _serviceBrand: undefined;

	private readonly connections = new Map<string, IVectorCodeCodexBridgeConnection>();
	private readonly _onDidReceiveNotification = this._register(new Emitter<IVectorCodeCodexBridgeNotification>());
	readonly onDidReceiveNotification = this._onDidReceiveNotification.event;
	private readonly _onDidReceiveServerRequest = this._register(new Emitter<IVectorCodeCodexBridgeServerRequest>());
	readonly onDidReceiveServerRequest = this._onDidReceiveServerRequest.event;
	private readonly _onDidChangeConnection = this._register(new Emitter<IVectorCodeCodexBridgeConnectionChange>());
	readonly onDidChangeConnection = this._onDidChangeConnection.event;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async start(options: IVectorCodeCodexBridgeStartOptions): Promise<string> {
		const startupCorrelationId = `vector-codex-start-${generateUuid()}`;
		const executable = await findExecutable('codex', options.cwd);
		if (!executable) {
			throw new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.DependencyMissing,
				'Codex CLI was not found. Install it with "npm install -g @openai/codex" and sign in before using Codex in Vector Code.',
				'Executable lookup returned no Codex CLI candidate.',
				false,
				startupCorrelationId,
			);
		}

		const connectionId = `vector-codex-${generateUuid()}`;
		const launch = resolveCodexLaunch(executable);
		const child = spawn(launch.executable, launch.args, {
			cwd: options.cwd,
			env: launch.env,
			stdio: ['pipe', 'pipe', 'pipe'],
			windowsHide: true,
			shell: launch.shell,
		}) as ChildProcessWithoutNullStreams;
		const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
		const connection: IVectorCodeCodexBridgeConnection = {
			process: child,
			output,
			pending: new VectorCodeCodexPendingRequests(),
			stderrBytes: 0,
			stopping: false,
		};
		this.connections.set(connectionId, connection);

		output.on('line', line => this.handleOutputLine(connectionId, line));
		child.stderr.on('data', data => {
			connection.stderrBytes += Buffer.byteLength(data);
		});
		child.on('exit', (code, signal) => this.handleProcessExit(connectionId, code, signal));
		child.on('error', error => this.handleProcessError(connectionId, error));

		try {
			await new Promise<void>((resolve, reject) => {
				const onSpawn = () => {
					cleanup();
					resolve();
				};
				const onError = (error: Error) => {
					cleanup();
					reject(error);
				};
				const cleanup = () => {
					child.off('spawn', onSpawn);
					child.off('error', onError);
				};
				child.once('spawn', onSpawn);
				child.once('error', onError);
			});
		} catch (error) {
			this.disposeConnection(connectionId, false);
			throw error;
		}

		this._onDidChangeConnection.fire({ connectionId, state: 'started' });
		this.logService.debug(`[VectorCode][Codex][${connectionId}] helper started.`);
		return connectionId;
	}

	async request<TResult = unknown>(connectionId: string, request: IVectorCodeCodexBridgeRequest): Promise<TResult> {
		const connection = this.getConnection(connectionId);
		if (!isRequestId(request.id)) {
			throw new Error('Codex App Server requests require a string or numeric correlation identifier.');
		}
		if (!request.method.trim()) {
			throw new Error('Codex App Server requests require a method.');
		}
		const result = connection.pending.create<TResult>(request.id, request.method, normalizeRequestTimeout(request.timeoutMs));
		const startedAt = Date.now();
		this.logService.debug(`[VectorCode][Codex][${request.id}] bridge request started (${request.method}).`);
		try {
			this.writeMessage(connection, request.params === undefined
				? { id: request.id, method: request.method }
				: { id: request.id, method: request.method, params: request.params });
		} catch (error) {
			connection.pending.reject(request.id, error instanceof Error ? error : new Error(String(error)));
		}
		try {
			const value = await result;
			this.logService.debug(`[VectorCode][Codex][${request.id}] bridge request completed (${request.method}, ${Date.now() - startedAt} ms).`);
			return value;
		} catch (error) {
			const code = error instanceof VectorCodeRuntimeError ? error.code : VectorCodeRuntimeErrorCode.Unknown;
			this.logService.warn(`[VectorCode][Codex][${request.id}] bridge request failed (${request.method}, ${code}, ${Date.now() - startedAt} ms).`);
			throw error;
		}
	}

	async cancelRequest(connectionId: string, requestId: VectorCodeCodexRequestId): Promise<void> {
		const connection = this.connections.get(connectionId);
		connection?.pending.cancel(requestId);
	}

	async notify(connectionId: string, method: string, params?: unknown): Promise<void> {
		const connection = this.getConnection(connectionId);
		this.writeMessage(connection, params === undefined ? { method } : { method, params });
	}

	async respond(connectionId: string, id: VectorCodeCodexRequestId, result: unknown): Promise<void> {
		this.writeMessage(this.getConnection(connectionId), { id, result });
	}

	async respondError(connectionId: string, id: VectorCodeCodexRequestId, message: string): Promise<void> {
		this.writeMessage(this.getConnection(connectionId), { id, error: { code: -32_001, message } });
	}

	async stop(connectionId: string): Promise<void> {
		this.disposeConnection(connectionId, true);
		this._onDidChangeConnection.fire({ connectionId, state: 'stopped' });
	}

	override dispose(): void {
		for (const connectionId of [...this.connections.keys()]) {
			this.disposeConnection(connectionId, true);
		}
		super.dispose();
	}

	private handleOutputLine(connectionId: string, line: string): void {
		const connection = this.connections.get(connectionId);
		if (!connection || !line.trim()) {
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			this.logService.warn(`[VectorCode][Codex][${connectionId}] helper emitted invalid JSON (${error instanceof Error ? error.name : 'unknown_error'}).`);
			return;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			this.logService.warn(`[VectorCode][Codex][${connectionId}] helper emitted a JSON value that is not a protocol message.`);
			return;
		}
		const message = parsed as IVectorCodeCodexProtocolMessage;

		if (isRequestId(message.id) && message.method === undefined) {
			const settled = message.error !== undefined
				? connection.pending.reject(message.id, createCodexProtocolError(message.error, message.id))
				: connection.pending.resolve(message.id, message.result);
			if (!settled) {
				this.logService.debug(`[VectorCode][Codex][${message.id}] response ignored for a settled or unknown request.`);
			}
			return;
		}

		if (typeof message.method !== 'string') {
			this.logService.warn(`[VectorCode][Codex][${connectionId}] helper emitted an unrecognized protocol message.`);
			return;
		}
		if (message.id !== undefined && !isRequestId(message.id)) {
			this.logService.warn(`[VectorCode][Codex][${connectionId}] helper emitted an invalid request identifier for method ${message.method}.`);
			return;
		}
		if (isRequestId(message.id)) {
			this._onDidReceiveServerRequest.fire({ connectionId, id: message.id, method: message.method, params: message.params });
		} else {
			this._onDidReceiveNotification.fire({ connectionId, method: message.method, params: message.params });
		}
	}

	private handleProcessExit(connectionId: string, code: number | null, signal: NodeJS.Signals | null): void {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			return;
		}
		const exitDetail = `Codex App Server exited${code === null ? '' : ` with code ${normalizeExitCode(code)}`}${signal ? ` (${signal})` : ''}.`;
		if (connection.stderrBytes > 0) {
			this.logService.warn(`[VectorCode][Codex][${connectionId}] ${exitDetail} Helper stderr was suppressed (${connection.stderrBytes} bytes).`);
		}
		const stopping = connection.stopping;
		this.disposeConnection(connectionId, false);
		this._onDidChangeConnection.fire({ connectionId, state: stopping ? 'stopped' : 'error', detail: exitDetail });
	}

	private handleProcessError(connectionId: string, error: Error): void {
		if (!this.connections.has(connectionId)) {
			return;
		}
		this.logService.error(`[VectorCode][Codex][${connectionId}] helper process error (${error.name}).`);
		this.disposeConnection(connectionId, false);
		this._onDidChangeConnection.fire({ connectionId, state: 'error', detail: 'Codex helper process error.' });
	}

	private getConnection(connectionId: string): IVectorCodeCodexBridgeConnection {
		const connection = this.connections.get(connectionId);
		if (!connection || connection.stopping || connection.process.stdin.destroyed) {
			throw new VectorCodeRuntimeError(
				VectorCodeRuntimeErrorCode.ConnectionLost,
				'Codex App Server is not running.',
				'No writable helper connection exists for the requested identifier.',
				true,
				connectionId,
			);
		}
		return connection;
	}

	private writeMessage(connection: IVectorCodeCodexBridgeConnection, message: object): void {
		connection.process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private disposeConnection(connectionId: string, terminate: boolean): void {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			return;
		}
		this.connections.delete(connectionId);
		connection.stopping = terminate;
		connection.output.close();
		connection.pending.rejectAll(new VectorCodeRuntimeError(
			VectorCodeRuntimeErrorCode.ConnectionLost,
			'Codex App Server stopped before the request completed.',
			'The helper connection closed while correlated requests were pending.',
			true,
			connectionId,
		));
		if (terminate && !connection.process.killed) {
			connection.process.stdin.end();
			connection.process.kill();
		}
	}
}

function isRequestId(value: unknown): value is VectorCodeCodexRequestId {
	return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length > 0);
}

function normalizeRequestTimeout(timeoutMs: number | undefined): number {
	if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
		return CODEX_REQUEST_TIMEOUT_MS;
	}
	return Math.min(CODEX_REQUEST_TIMEOUT_MAX_MS, Math.max(CODEX_REQUEST_TIMEOUT_MIN_MS, Math.floor(timeoutMs)));
}

function normalizeExitCode(code: number): number {
	return process.platform === 'win32' && code > 0x7fff_ffff ? code - 0x1_0000_0000 : code;
}

function createCodexProtocolError(value: unknown, requestId: VectorCodeCodexRequestId): VectorCodeRuntimeError {
	const record = value && typeof value === 'object' ? value as { code?: unknown; message?: unknown } : undefined;
	const message = typeof value === 'string' ? value : typeof record?.message === 'string' ? record.message : '';
	const protocolCode = typeof record?.code === 'number' && Number.isFinite(record.code)
		? String(record.code)
		: typeof record?.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(record.code)
			? record.code
			: 'unknown';
	const authenticationRequired = isVectorCodeCodexAuthenticationError(message, protocolCode);
	return new VectorCodeRuntimeError(
		authenticationRequired ? VectorCodeRuntimeErrorCode.AuthenticationRequired : VectorCodeRuntimeErrorCode.Unknown,
		authenticationRequired
			? 'Codex authentication is required. Sign in from the full terminal, then retry.'
			: 'Codex could not complete the request. Try again or open Diagnostics.',
		`Codex App Server returned protocol error code ${protocolCode}. Response content was suppressed.`,
		!authenticationRequired,
		String(requestId),
	);
}

function resolveCodexLaunch(executable: string): { executable: string; args: string[]; env: NodeJS.ProcessEnv; shell: boolean } {
	if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
		const codexEntryPoint = join(dirname(executable), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
		if (existsSync(codexEntryPoint)) {
			return {
				executable: process.execPath,
				args: [codexEntryPoint, 'app-server'],
				env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
				shell: false,
			};
		}
	}
	return {
		executable,
		args: ['app-server'],
		env: process.env,
		shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable),
	};
}
