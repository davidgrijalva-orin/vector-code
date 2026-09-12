/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { FileService } from '../../../files/common/fileService.js';
import { DiskFileSystemProvider } from '../../../files/node/diskFileSystemProvider.js';
import { NullLogService } from '../../../log/common/log.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { UriIdentityService } from '../../../uriIdentity/common/uriIdentityService.js';
import { IProductService } from '../../../product/common/productService.js';
import { INativeEnvironmentService } from '../../../environment/common/environment.js';
import { ExtensionSignatureVerificationCode, IGalleryExtension, IExtensionGalleryService, InstallOperation } from '../../common/extensionManagement.js';
import { OPEN_VSX_GALLERY_URL } from '../../common/openVsx.js';
import { ExtensionsDownloader } from '../../node/extensionDownloader.js';
import { ExtensionSignatureVerificationService } from '../../node/extensionSignatureVerificationService.js';
import { rejects, strictEqual } from 'assert';
import { generateKeyPairSync, sign } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { zip } from '../../../../base/node/zip.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TargetPlatform } from '../../../extensions/common/extensions.js';
import { IRequestService } from '../../../request/common/request.js';
import { verifyOpenVsxSignature } from '../../node/openVsxSignatureVerifier.js';

suite('Open VSX package verification', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const keys = generateKeyPairSync('ed25519');
	let directory: string;
	let packagePath: string;
	let signaturePath: string;
	let keyUrl: string;
	let key: string;
	let urls: string[];
	const request = {
		request: async ({ url, followRedirects }: { url: string; followRedirects?: number }) => {
			strictEqual(followRedirects, 0);
			urls.push(url);
			const body = url.includes('/public-key/') ? key : JSON.stringify({ namespace: 'publisher', name: 'extension', version: '1.0.0', files: { publicKey: keyUrl } });
			return { res: { statusCode: 200, headers: {} }, stream: bufferToStream(VSBuffer.fromString(body)) };
		}
	} as unknown as IRequestService;
	setup(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'openvsx-verifier-'));
		packagePath = join(directory, 'extension.vsix'); signaturePath = join(directory, 'extension.sigzip');
		keyUrl = 'https://open-vsx.org/api/-/public-key/test-key';
		key = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(); urls = [];
		await zip(packagePath, [{ path: 'extension/package.json', contents: Buffer.from('{"name":"extension","version":"1.0.0"}') }]);
		const bytes = await fs.readFile(packagePath);
		await zip(signaturePath, [{ path: '.signature.sig', contents: sign(null, bytes, keys.privateKey) }]);
	});
	teardown(async () => { await fs.rm(directory, { recursive: true, force: true }); });

	test('downloads and verifies Open VSX archives containing only the Ed25519 signature', async () => {
		const log = store.add(new NullLogService());
		const files = store.add(new FileService(log));
		const disk = store.add(new DiskFileSystemProvider(log));
		store.add(files.registerProvider('file', disk));
		const identity = store.add(new UriIdentityService(files));
		const product = { extensionsGallery: { serviceUrl: OPEN_VSX_GALLERY_URL } } as IProductService;
		const verifier = new ExtensionSignatureVerificationService(log, NullTelemetryService, product, request);
		const gallery = {
			download: async (_extension: IGalleryExtension, location: URI) => { await fs.mkdir(join(directory, 'cache'), { recursive: true }); await fs.copyFile(packagePath, location.fsPath); },
			downloadSignatureArchive: async (_extension: IGalleryExtension, location: URI) => { await fs.copyFile(signaturePath, location.fsPath); }
		} as unknown as IExtensionGalleryService;
		const downloader = store.add(new ExtensionsDownloader({ extensionsDownloadLocation: URI.file(join(directory, 'cache')) } as INativeEnvironmentService, files, gallery, verifier, NullTelemetryService, identity, log, product));
		const extension = { identifier: { id: 'publisher.extension' }, version: '1.0.0', isSigned: true, properties: { targetPlatform: TargetPlatform.UNIVERSAL } } as IGalleryExtension;
		const result = await downloader.download(extension, InstallOperation.Install, true);
		strictEqual(result.verificationStatus, ExtensionSignatureVerificationCode.Success);
	});
	test('verifies the registry signature over the entire downloaded package', async () => {
		strictEqual(await verifyOpenVsxSignature('publisher.extension', '1.0.0', packagePath, signaturePath, request), true);
		strictEqual(urls[0], 'https://open-vsx.org/api/publisher/extension/1.0.0');
		await fs.appendFile(packagePath, 'tampered');
		strictEqual(await verifyOpenVsxSignature('publisher.extension', '1.0.0', packagePath, signaturePath, request), false);
	});

	test('uses the package platform when resolving its registry signing key', async () => {
		strictEqual(await verifyOpenVsxSignature('publisher.extension', '1.0.0', packagePath, signaturePath, request, TargetPlatform.DARWIN_ARM64), true);
		strictEqual(urls[0], 'https://open-vsx.org/api/publisher/extension/darwin-arm64/1.0.0');
	});

	test('rejects a valid signature from a different key', async () => {
		key = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
		strictEqual(await verifyOpenVsxSignature('publisher.extension', '1.0.0', packagePath, signaturePath, request), false);
	});

	test('rejects untrusted key locations before fetching them', async () => {
		for (const url of ['https://evil.test/api/-/public-key/test-key', 'http://open-vsx.org/api/-/public-key/test-key', 'https://open-vsx.org/api/other', 'https://user@open-vsx.org/api/-/public-key/test-key']) {
			keyUrl = url; urls = [];
			await rejects(verifyOpenVsxSignature('publisher.extension', '1.0.0', packagePath, signaturePath, request), /invalid signing key URL/);
			strictEqual(urls.length, 1);
		}
	});

	test('fails closed for missing signatures and mismatched registry versions', async () => {
		await zip(signaturePath, [{ path: '.signature.p7s', contents: Buffer.alloc(0) }]);
		await rejects(verifyOpenVsxSignature('publisher.extension', '1.0.0', packagePath, signaturePath, request), /missing/);
		await rejects(verifyOpenVsxSignature('publisher.extension', '2.0.0', packagePath, signaturePath, request), /signing key for this extension version/);
	});

	test('rejects oversized decompressed signature entries', async () => {
		await zip(signaturePath, [{ path: '.signature.sig', contents: Buffer.alloc(1024 * 1024) }]);
		await rejects(verifyOpenVsxSignature('publisher.extension', '1.0.0', packagePath, signaturePath, request), /signature size/);
	});
});
