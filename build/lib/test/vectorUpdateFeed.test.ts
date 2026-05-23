/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { parseVectorUpdateFeed, resolveVectorUpdate, type IVectorUpdateFeed } from '../vectorUpdateFeed.ts';

const feed: IVectorUpdateFeed = {
	schemaVersion: 1,
	releases: [
		{
			version: '0.1.0',
			commit: 'old-release',
			quality: 'stable',
			timestamp: 100,
			assets: {
				'darwin-arm64': { url: 'https://releases.vectorcode.com/0.1.0/darwin-arm64.zip', sha256hash: 'old-hash' }
			}
		},
		{
			version: '0.1.1',
			commit: 'new-release',
			quality: 'stable',
			timestamp: 200,
			assets: {
				'darwin-arm64': { url: 'https://releases.vectorcode.com/0.1.1/darwin-arm64.zip', sha256hash: 'new-hash' },
				'linux-arm64': { url: 'https://releases.vectorcode.com/0.1.1/linux-arm64.tar.gz' }
			}
		},
		{
			version: '0.2.0-preview',
			commit: 'preview-release',
			quality: 'insider',
			timestamp: 300,
			assets: {
				'darwin-arm64': { url: 'https://releases.vectorcode.com/0.2.0-preview/darwin-arm64.zip' }
			}
		}
	]
};

suite('vectorUpdateFeed', () => {
	test('returns the latest release for an older commit', () => {
		const result = resolveVectorUpdate(feed, { platform: 'darwin-arm64', quality: 'stable', commit: 'old-release' });

		assert.strictEqual(result.statusCode, 200);
		if (result.statusCode === 200) {
			assert.deepStrictEqual(result.body, {
				version: 'new-release',
				productVersion: '0.1.1',
				timestamp: 200,
				url: 'https://releases.vectorcode.com/0.1.1/darwin-arm64.zip',
				sha256hash: 'new-hash'
			});
		}
	});

	test('returns 204 for the latest commit', () => {
		assert.deepStrictEqual(resolveVectorUpdate(feed, { platform: 'darwin-arm64', quality: 'stable', commit: 'new-release' }), { statusCode: 204 });
	});

	test('keeps release channels separate', () => {
		const result = resolveVectorUpdate(feed, { platform: 'darwin-arm64', quality: 'insider', commit: 'new-release' });

		assert.strictEqual(result.statusCode, 200);
		if (result.statusCode === 200) {
			assert.strictEqual(result.body.version, 'preview-release');
			assert.strictEqual(result.body.productVersion, '0.2.0-preview');
		}
	});

	test('falls back to universal macOS assets', () => {
		const universalFeed: IVectorUpdateFeed = {
			schemaVersion: 1,
			releases: [{
				version: '0.1.2',
				commit: 'universal-release',
				quality: 'stable',
				timestamp: 400,
				assets: {
					'darwin-universal': { url: 'https://releases.vectorcode.com/0.1.2/darwin-universal.zip' }
				}
			}]
		};

		const result = resolveVectorUpdate(universalFeed, { platform: 'darwin-arm64', quality: 'stable', commit: 'older' });

		assert.strictEqual(result.statusCode, 200);
		if (result.statusCode === 200) {
			assert.strictEqual(result.body.url, 'https://releases.vectorcode.com/0.1.2/darwin-universal.zip');
		}
	});

	test('validates manifest shape', () => {
		assert.throws(() => parseVectorUpdateFeed({ schemaVersion: 1, releases: [{ version: '0.1.0' }] }), /assets must be an object/);
	});
});
