/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST, VECTOR_CODE_MOBILE_LEGACY_RELAY_HOSTS, VECTOR_CODE_MOBILE_RELAY_HOST_PATTERN } from './vectorCodeGeneratedConfig.js';

export { VECTOR_CODE_CANONICAL_HOST, VECTOR_CODE_RELEASE_DOWNLOAD_URL, VECTOR_CODE_UPDATE_FEED_URL, VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST, VECTOR_CODE_MOBILE_DEFAULT_USER_ID, VECTOR_CODE_MOBILE_LEGACY_RELAY_HOST_VALUES, VECTOR_CODE_MOBILE_LEGACY_RELAY_HOSTS, VECTOR_CODE_MOBILE_RELAY_HOST_NORMALIZATION_CASES, VECTOR_CODE_MOBILE_RELAY_HOST_PATTERN } from './vectorCodeGeneratedConfig.js';

const VECTOR_CODE_MOBILE_RELAY_HOST_REGEX = new RegExp(VECTOR_CODE_MOBILE_RELAY_HOST_PATTERN);

export function normalizeVectorCodeRelayHost(value?: string | null): string | undefined {
	const rawValue = value?.trim();
	if (!rawValue) {
		return undefined;
	}

	try {
		const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue) ? rawValue : `wss://${rawValue}`);
		const hostname = url.hostname.toLowerCase();
		const relayHost = url.port ? `${hostname}:${url.port}` : hostname;
		if (VECTOR_CODE_MOBILE_LEGACY_RELAY_HOSTS.has(hostname)) {
			return VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST;
		}
		return VECTOR_CODE_MOBILE_RELAY_HOST_REGEX.test(relayHost) ? relayHost : undefined;
	} catch {
		return undefined;
	}
}
