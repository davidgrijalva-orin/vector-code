/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { dirname } from '../../../base/common/path.js';

/** Only service-owned paths reach this helper. Keep the prior committed file until replacement is ready. */
export async function writeLocalWorkFile(path: string, content: string | Uint8Array, committed?: () => void): Promise<void> {
	const directory = dirname(path);
	await fs.mkdir(directory, { recursive: true, mode: 0o700 });
	const temporary = path + '.pending';
	const handle = await fs.open(temporary, 'w', 0o600);
	try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
	await fs.rename(temporary, path);
	try {
		if (process.platform !== 'win32') {
			const handle = await fs.open(directory, 'r');
			try { await handle.sync(); } finally { await handle.close(); }
		}
	} finally { committed?.(); }
}
