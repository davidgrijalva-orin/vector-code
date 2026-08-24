/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../base/common/uuid.js';

const VECTOR_CODE_DIAGNOSTIC_DETAIL_LIMIT = 600;
const VECTOR_CODE_DIAGNOSTIC_EVENT_LIMIT = 120;
const VECTOR_CODE_DIAGNOSTIC_HISTORY_LIMIT = 24;

export const enum VectorCodeRuntimeState {
	Stopped = 'stopped',
	Starting = 'starting',
	Ready = 'ready',
	Degraded = 'degraded',
	Unavailable = 'unavailable',
	Retrying = 'retrying',
}

export const enum VectorCodeRuntimeErrorCode {
	AuthenticationRequired = 'authentication_required',
	ConnectionLost = 'connection_lost',
	DependencyMissing = 'dependency_missing',
	InvalidState = 'invalid_state',
	NetworkUnavailable = 'network_unavailable',
	RequestTimeout = 'request_timeout',
	StartupTimeout = 'startup_timeout',
	StorageCorrupt = 'storage_corrupt',
	StorageUnavailable = 'storage_unavailable',
	Unknown = 'unknown',
}

export interface IVectorCodeRuntimeError {
	readonly code: VectorCodeRuntimeErrorCode;
	readonly userMessage: string;
	readonly cause: string;
	readonly retryable: boolean;
	readonly correlationId: string;
}

export interface IVectorCodeRuntimeStatus {
	readonly state: VectorCodeRuntimeState;
	readonly capabilities: readonly string[];
	readonly since: number;
	readonly attempt?: number;
	readonly nextRetryAt?: number;
	readonly error?: IVectorCodeRuntimeError;
}

export interface IVectorCodeRuntimeDiagnostic {
	readonly timestamp: number;
	readonly correlationId: string;
	readonly event: string;
	readonly state: VectorCodeRuntimeState;
	readonly errorCode?: VectorCodeRuntimeErrorCode;
}

export interface IVectorCodeRuntimeDiagnosticSummary {
	readonly service: string;
	readonly generatedAt: number;
	readonly status: IVectorCodeRuntimeStatus;
	readonly recentEvents: readonly IVectorCodeRuntimeDiagnostic[];
	readonly recoveryActions: readonly string[];
}

export interface IVectorCodeRuntimeTransition {
	readonly capabilities?: readonly string[];
	readonly error?: IVectorCodeRuntimeError;
	readonly attempt?: number;
	readonly nextRetryAt?: number;
	readonly correlationId?: string;
	readonly event?: string;
}

export interface IVectorCodeJsonStateRecovery<T> {
	readonly action: 'current' | 'rolled_back' | 'reset' | 'empty';
	readonly value?: T;
	readonly serializedValue?: string;
	readonly quarantinedValue?: string;
}

export class VectorCodeRuntimeError extends Error implements IVectorCodeRuntimeError {
	override readonly name = 'VectorCodeRuntimeError';
	override readonly cause: string;

	constructor(
		readonly code: VectorCodeRuntimeErrorCode,
		readonly userMessage: string,
		cause: unknown,
		readonly retryable: boolean,
		readonly correlationId = `vector-code-${generateUuid()}`,
	) {
		super(userMessage);
		this.cause = sanitizeVectorCodeDiagnosticText(cause);
	}
}

/**
 * Maintains one truthful lifecycle snapshot and a bounded metadata-only diagnostic history.
 * Callers deliberately provide capability names and static event names; request payloads never
 * enter the controller.
 */
export class VectorCodeRuntimeController {
	private status: IVectorCodeRuntimeStatus;
	private readonly diagnostics: IVectorCodeRuntimeDiagnostic[] = [];

	constructor(
		private readonly service: string,
		private readonly now: () => number = Date.now,
		private readonly diagnosticHistoryLimit = VECTOR_CODE_DIAGNOSTIC_HISTORY_LIMIT,
	) {
		this.status = {
			state: VectorCodeRuntimeState.Stopped,
			capabilities: [],
			since: this.now(),
		};
	}

	getStatus(): IVectorCodeRuntimeStatus {
		return this.status;
	}

	transition(state: VectorCodeRuntimeState, options: IVectorCodeRuntimeTransition = {}): IVectorCodeRuntimeStatus {
		const capabilities = [...new Set(options.capabilities ?? [])].sort();
		const error = options.error
			? toVectorCodeRuntimeError(options.error, {
				code: options.error.code,
				userMessage: options.error.userMessage,
				retryable: options.error.retryable,
				correlationId: options.error.correlationId,
			})
			: (keepsRuntimeError(state) ? this.status.error : undefined);
		const correlationId = options.correlationId ?? error?.correlationId;
		this.status = {
			state,
			capabilities,
			since: this.now(),
			attempt: options.attempt,
			nextRetryAt: options.nextRetryAt,
			error,
		};
		this.record(options.event ?? `lifecycle.${state}`, correlationId, error);
		return this.status;
	}

	record(event: string, correlationId = `${this.service}-${generateUuid()}`, error?: IVectorCodeRuntimeError): string {
		this.diagnostics.push({
			timestamp: this.now(),
			correlationId,
			event: sanitizeVectorCodeDiagnosticEvent(event),
			state: this.status.state,
			errorCode: error?.code,
		});
		if (this.diagnostics.length > this.diagnosticHistoryLimit) {
			this.diagnostics.splice(0, this.diagnostics.length - this.diagnosticHistoryLimit);
		}
		return correlationId;
	}

	createCorrelationId(operation: string): string {
		const correlationId = `${this.service}-${generateUuid()}`;
		this.record(`${operation}.started`, correlationId);
		return correlationId;
	}

	getDiagnosticSummary(recoveryActions: readonly string[]): IVectorCodeRuntimeDiagnosticSummary {
		return {
			service: this.service,
			generatedAt: this.now(),
			status: this.status,
			recentEvents: [...this.diagnostics],
			recoveryActions: [...recoveryActions],
		};
	}
}

export function hasVectorCodeRuntimeCapability(status: IVectorCodeRuntimeStatus, capability: string): boolean {
	return status.capabilities.includes(capability);
}

export function toVectorCodeRuntimeError(
	error: unknown,
	options: {
		readonly code: VectorCodeRuntimeErrorCode;
		readonly userMessage: string;
		readonly retryable: boolean;
		readonly correlationId?: string;
	},
): VectorCodeRuntimeError {
	if (error instanceof VectorCodeRuntimeError) {
		return error;
	}
	if (isVectorCodeRuntimeError(error)) {
		return new VectorCodeRuntimeError(error.code, error.userMessage, error.cause, error.retryable, error.correlationId);
	}
	return new VectorCodeRuntimeError(options.code, options.userMessage, error, options.retryable, options.correlationId);
}

export function isVectorCodeRuntimeError(error: unknown): error is IVectorCodeRuntimeError {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const candidate = error as Partial<IVectorCodeRuntimeError>;
	return typeof candidate.code === 'string'
		&& typeof candidate.userMessage === 'string'
		&& typeof candidate.cause === 'string'
		&& typeof candidate.retryable === 'boolean'
		&& typeof candidate.correlationId === 'string';
}

export function sanitizeVectorCodeDiagnosticText(value: unknown): string {
	const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : String(value ?? '');
	const sanitized = raw
		.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer <redacted>')
		.replace(/\b(?:vta_|sk-|gh[opusr]_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, '<redacted>')
		.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<redacted>')
		.replace(/["']?\b([A-Za-z0-9_-]*(?:token|key|secret)|authorization)\b["']?\s*(?:=|:)\s*(?:"[^"]*"|'[^']*'|[^\s,&;]+)/gi, '$1=<redacted>')
		.replace(/\bhttps?:\/\/[^\s,;]+/gi, '<url>')
		.replace(/\b[a-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/gi, '<path>')
		.replace(/\\\\[^\\\s]+\\(?:[^\\\s]+\\)*[^\\\s]*/g, '<path>')
		.replace(/\/(?:Users|home|private|tmp|var|workspace)\/[^\s,;]+/g, '<path>')
		.replace(/[\r\n\t]+/g, ' ')
		.trim();
	return (sanitized || 'No internal cause was provided.').slice(0, VECTOR_CODE_DIAGNOSTIC_DETAIL_LIMIT);
}

export async function runVectorCodeRuntimeWithTimeout<T>(
	operation: Promise<T>,
	timeoutMs: number,
	timeoutError: VectorCodeRuntimeError,
	onLateResult?: (value: T) => void | Promise<void>,
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error(`Invalid VectorCode runtime timeout: ${timeoutMs}`);
	}
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let didTimeout = false;
	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutHandle = setTimeout(() => {
			didTimeout = true;
			reject(timeoutError);
		}, timeoutMs);
	});
	try {
		return await Promise.race([operation, timeout]);
	} finally {
		if (timeoutHandle !== undefined) {
			clearTimeout(timeoutHandle);
		}
		if (didTimeout && onLateResult) {
			void operation.then(value => onLateResult(value)).catch(() => undefined);
		}
	}
}

export function recoverVectorCodeJsonState<T>(
	currentValue: string | undefined,
	knownGoodValue: string | undefined,
	isValid: (value: unknown) => value is T,
): IVectorCodeJsonStateRecovery<T> {
	if (currentValue === undefined) {
		return { action: 'empty' };
	}
	const current = parseValidJson(currentValue, isValid);
	if (current !== undefined) {
		return { action: 'current', value: current, serializedValue: currentValue };
	}
	const knownGood = knownGoodValue === undefined ? undefined : parseValidJson(knownGoodValue, isValid);
	if (knownGood !== undefined) {
		return {
			action: 'rolled_back',
			value: knownGood,
			serializedValue: knownGoodValue,
			quarantinedValue: currentValue,
		};
	}
	return { action: 'reset', quarantinedValue: currentValue };
}

function parseValidJson<T>(value: string, isValid: (value: unknown) => value is T): T | undefined {
	try {
		const parsed = JSON.parse(value) as unknown;
		return isValid(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function keepsRuntimeError(state: VectorCodeRuntimeState): boolean {
	return state === VectorCodeRuntimeState.Degraded
		|| state === VectorCodeRuntimeState.Retrying
		|| state === VectorCodeRuntimeState.Unavailable;
}

function sanitizeVectorCodeDiagnosticEvent(event: string): string {
	return event.replace(/[^A-Za-z0-9._:/-]+/g, '_').slice(0, VECTOR_CODE_DIAGNOSTIC_EVENT_LIMIT) || 'unknown';
}
