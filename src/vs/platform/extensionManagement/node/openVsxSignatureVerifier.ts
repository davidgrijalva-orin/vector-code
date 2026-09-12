/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createPublicKey, verify } from 'crypto';
import { promises as fs } from 'fs';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { TargetPlatform } from '../../extensions/common/extensions.js';
import { asJson, asText, IRequestService } from '../../request/common/request.js';

const registryOrigin = 'https://open-vsx.org';

/** Open VSX signs the complete VSIX bytes with Ed25519. The key is retrieved from its HTTPS registry. */
export async function verifyOpenVsxSignature(extensionId: string, version: string, packagePath: string, signaturePath: string, request: IRequestService, targetPlatform?: TargetPlatform): Promise<boolean> {
	const parts = extensionId.split('.');
	if (parts.length !== 2 || parts.some(part => !/^[\w-]+$/.test(part)) || !version) { throw new Error('Invalid Open VSX extension identity.'); }
	const platform = targetPlatform && ![TargetPlatform.UNIVERSAL, TargetPlatform.UNDEFINED, TargetPlatform.UNKNOWN].includes(targetPlatform) ? `${encodeURIComponent(targetPlatform)}/` : '';
	const url = `${registryOrigin}/api/${parts.map(encodeURIComponent).join('/')}/${platform}${encodeURIComponent(version)}`;
	const metadata = await asJson<{ namespace?: string; name?: string; version?: string; files?: { publicKey?: string } }>(await request.request({ type: 'GET', url, timeout: 15000, callSite: 'openVsxSignatureVerifier.metadata' }, CancellationToken.None));
	if (!metadata || `${metadata.namespace}.${metadata.name}`.toLowerCase() !== extensionId.toLowerCase() || metadata.version !== version || typeof metadata.files?.publicKey !== 'string') {
		throw new Error('Open VSX did not provide a signing key for this extension version.');
	}
	const keyUrl = new URL(metadata.files.publicKey);
	if (keyUrl.origin !== registryOrigin || keyUrl.username || keyUrl.password || !/^\/api\/-\/public-key\/[\w-]+$/.test(keyUrl.pathname) || keyUrl.search || keyUrl.hash) {
		throw new Error('Open VSX returned an invalid signing key URL.');
	}
	const pem = await asText(await request.request({ type: 'GET', url: keyUrl.toString(), timeout: 15000, callSite: 'openVsxSignatureVerifier.key' }, CancellationToken.None));
	if (!pem || pem.length > 4096) { throw new Error('Invalid Open VSX signing key.'); }
	const key = createPublicKey(pem);
	if (key.asymmetricKeyType !== 'ed25519') { throw new Error('Unsupported Open VSX signing key.'); }
	const signature = await readSignature(signaturePath);
	if ((await fs.stat(packagePath)).size > 512 * 1024 * 1024) { throw new Error('Extension exceeds the signature verification size limit.'); }
	return verify(null, await fs.readFile(packagePath), key, signature);
}

async function readSignature(path: string): Promise<Buffer> {
	const { open } = await import('yauzl');
	return new Promise((resolve, reject) => {
		open(path, { lazyEntries: true }, (error, zip) => {
			if (error || !zip) { reject(error ?? new Error('Invalid signature archive.')); return; }
			const fail = (error: Error) => { zip.close(); reject(error); };
			zip.on('error', fail);
			zip.on('end', () => fail(new Error('Open VSX signature is missing.')));
			zip.on('entry', entry => {
				if (entry.fileName !== '.signature.sig') { zip.readEntry(); return; }
				if (entry.uncompressedSize !== 64) { fail(new Error('Invalid Open VSX signature size.')); return; }
				zip.openReadStream(entry, (error, stream) => {
					if (error || !stream) { fail(error ?? new Error('Unreadable signature.')); return; }
					const chunks: Buffer[] = []; let size = 0;
					stream.on('error', fail);
					stream.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 64) { stream.destroy(new Error('Invalid signature size.')); } else { chunks.push(chunk); } });
					stream.on('end', () => { zip.close(); const signature = Buffer.concat(chunks); if (signature.length !== 64) { reject(new Error('Invalid signature size.')); } else { resolve(signature); } });
				});
			});
			zip.readEntry();
		});
	});
}
