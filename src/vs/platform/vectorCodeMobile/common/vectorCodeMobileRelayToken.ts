/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorCodeMobileRelayBridgeTokenResponse } from './vectorCodeMobileRelayBridge.js';

const VECTOR_CODE_MOBILE_RELAY_TOKEN_EXPIRY_SKEW_MS = 60_000;

export function normalizeVectorCodeRelayTokenResponse(value: unknown, now = Date.now()): IVectorCodeMobileRelayBridgeTokenResponse | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const relayToken = stringField(value, 'relayToken') ?? stringField(value, 'token');
	const relayTokenExpiresAt = stringField(value, 'relayTokenExpiresAt') ?? stringField(value, 'expiresAt');
	const expiry = relayTokenExpiresAt ? Date.parse(relayTokenExpiresAt) : Number.NaN;
	return relayToken && relayTokenExpiresAt && Number.isFinite(expiry) && expiry > now + VECTOR_CODE_MOBILE_RELAY_TOKEN_EXPIRY_SKEW_MS
		? { relayToken, relayTokenExpiresAt }
		: undefined;
}

export function isMalformedVectorCodeRelayTokenJson(error: unknown): boolean {
	return error instanceof SyntaxError
		|| (typeof error === 'object' && error !== null && (error as { readonly name?: unknown }).name === 'SyntaxError');
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
	const field = value[key];
	if (typeof field !== 'string') {
		return undefined;
	}
	const trimmed = field.trim();
	return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
