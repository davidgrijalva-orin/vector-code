/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { realpath } from 'fs/promises';
import { URI } from '../../../base/common/uri.js';
import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';

async function canonical(uri: URI): Promise<URI> {
	if (uri.scheme !== 'file' || uri.authority || !uri.path.startsWith('/') || uri.query || uri.fragment) { throw new Error('Open a local workspace folder.'); }
	return URI.file(await realpath(uri.fsPath));
}
/** Approve only actual workspace roots, resolving symlinks before comparing trust. */
export async function authorizeVectorGraphRepository(project: string, roots: readonly URI[], trusted?: readonly URI[], additionalTrustRoots: readonly URI[] = []): Promise<string> {
	const requested = await canonical(URI.parse(project));
	const folders = await Promise.all(roots.map(canonical));
	if (!folders.some(folder => extUriBiasedIgnorePathCase.isEqual(folder, requested))) { throw new Error('Repository is not an open workspace folder.'); }
	if (trusted) {
		const grants = (await Promise.all(trusted.map(uri => canonical(uri).catch(() => undefined)))).filter((uri): uri is URI => !!uri);
		const trustTargets = [...folders, ...await Promise.all(additionalTrustRoots.map(canonical))];
		if (!trustTargets.every(folder => grants.some(grant => extUriBiasedIgnorePathCase.isEqualOrParent(folder, grant)))) { throw new Error('Trust every workspace folder before creating a branch.'); }
	}
	return requested.toString();
}
