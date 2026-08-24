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
import { IVectorCodeCodexBridgeConnectionChange, IVectorCodeCodexBridgeNotification, IVectorCodeCodexBridgeRequest, IVectorCodeCodexBridgeServerRequest, IVectorCodeCodexBridgeService, IVectorCodeCodexBridgeStartOptions, VectorCodeCodexRequestId } from '../common/vectorCodeCodexBridge.js';
import { VectorCodeCodexPendingRequests } from '../common/vectorCodeCodexPendingRequests.js';

interface IVectorCodeCodexBridgeConnection {
	readonly process: ChildProcessWithoutNullStreams;
	readonly output: ReadlineInterface;
	readonly pending: VectorCodeCodexPendingRequests;
	stderr: string;
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
const CODEX_STDERR_DETAIL_LIMIT = 8_000;

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
		const executable = await findExecutable('codex', options.cwd);
		if (!executable) {
			throw new Error('Codex CLI was not found. Install it with "npm install -g @openai/codex" and sign in before using Codex in Vector Code.');
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
			stderr: '',
			stopping: false,
		};
		this.connections.set(connectionId, connection);

		output.on('line', line => this.handleOutputLine(connectionId, line));
		child.stderr.on('data', data => {
			connection.stderr = `${connection.stderr}${data.toString()}`.slice(-CODEX_STDERR_DETAIL_LIMIT);
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
		try {
			this.writeMessage(connection, request.params === undefined
				? { id: request.id, method: request.method }
				: { id: request.id, method: request.method, params: request.params });
		} catch (error) {
			connection.pending.reject(request.id, error instanceof Error ? error : new Error(String(error)));
		}
		return result;
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
			this.logService.warn(`Codex App Server emitted invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			this.logService.warn('Codex App Server emitted a JSON value that is not a protocol message.');
			return;
		}
		const message = parsed as IVectorCodeCodexProtocolMessage;

		if (isRequestId(message.id) && message.method === undefined) {
			const settled = message.error !== undefined
				? connection.pending.reject(message.id, new Error(formatProtocolError(message.error)))
				: connection.pending.resolve(message.id, message.result);
			if (!settled) {
				this.logService.debug(`Codex App Server response ignored for settled or unknown request: ${message.id}`);
			}
			return;
		}

		if (typeof message.method !== 'string') {
			this.logService.warn('Codex App Server emitted an unrecognized protocol message.');
			return;
		}
		if (message.id !== undefined && !isRequestId(message.id)) {
			this.logService.warn(`Codex App Server emitted a request with an invalid identifier for method: ${message.method}`);
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
		const stderr = connection.stderr.trim();
		if (stderr) {
			this.logService.warn(`${exitDetail} Recent stderr: ${stderr}`);
		}
		const stopping = connection.stopping;
		this.disposeConnection(connectionId, false);
		this._onDidChangeConnection.fire({ connectionId, state: stopping ? 'stopped' : 'error', detail: exitDetail });
	}

	private handleProcessError(connectionId: string, error: Error): void {
		if (!this.connections.has(connectionId)) {
			return;
		}
		this.logService.error(`Codex App Server process error: ${error.message}`);
		this.disposeConnection(connectionId, false);
		this._onDidChangeConnection.fire({ connectionId, state: 'error', detail: error.message });
	}

	private getConnection(connectionId: string): IVectorCodeCodexBridgeConnection {
		const connection = this.connections.get(connectionId);
		if (!connection || connection.stopping || connection.process.stdin.destroyed) {
			throw new Error('Codex App Server is not running.');
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
		connection.pending.rejectAll(new Error('Codex App Server stopped before the request completed.'));
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

function formatProtocolError(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (value && typeof value === 'object') {
		const message = (value as { message?: unknown }).message;
		if (typeof message === 'string') {
			return message;
		}
	}
	return JSON.stringify(value);
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
