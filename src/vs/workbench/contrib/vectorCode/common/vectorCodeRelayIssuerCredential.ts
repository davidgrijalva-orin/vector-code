/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeVectorCodeRelayHost, VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST } from './vectorCodeHosts.js';

export interface IVectorCodeRelayIssuerCredentialMatch {
	readonly token: string;
	readonly requiresMigration: boolean;
}

export function matchVectorCodeRelayIssuerCredential(rawCredential: string | undefined, expectedRelayHost: string, legacyRelayHost?: string): IVectorCodeRelayIssuerCredentialMatch | undefined {
	const raw = rawCredential?.trim();
	if (!raw) {
		return undefined;
	}

	try {
		const candidate = JSON.parse(raw) as unknown;
		if (!isRecord(candidate)
			|| typeof candidate.relayHost !== 'string'
			|| normalizeVectorCodeRelayHost(candidate.relayHost) !== expectedRelayHost
			|| typeof candidate.token !== 'string'
			|| !candidate.token.trim()) {
			return undefined;
		}
		return { token: candidate.token.trim(), requiresMigration: false };
	} catch {
		const normalizedLegacyHost = normalizeVectorCodeRelayHost(legacyRelayHost) ?? VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST;
		return normalizedLegacyHost === expectedRelayHost ? { token: raw, requiresMigration: true } : undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
