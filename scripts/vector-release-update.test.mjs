/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function prepare(args) {
	const dir = mkdtempSync(join(tmpdir(), 'vector-release-test-'));
	try {
		const artifact = join(dir, 'app.zip');
		const manifest = join(dir, 'manifest.json');
		writeFileSync(artifact, 'test artifact');
		writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, releases: [{
			version: '1.0.0', commit: 'old', quality: 'stable', timestamp: 100,
			assets: { 'darwin-arm64': { url: 'https://example.com/old.zip' } }
		}] }));
		return spawnSync(process.execPath, ['scripts/vector-release-update.mjs', '--artifact', artifact, '--manifest', manifest, '--dry-run', ...args], { encoding: 'utf8' });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('preserves release history and verifies the normal upgrade', () => {
	const result = prepare(['--version', '1.0.1', '--commit', 'new', '--timestamp', '200']);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /"commit": "old"/);
	assert.match(result.stdout, /old -> 200/);
	assert.match(result.stdout, /new -> 204/);
});

test('adding an asset retains the original timestamp', () => {
	const result = prepare(['--version', '1.0.0', '--commit', 'old', '--platform', 'darwin-universal']);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /"timestamp": 100/);
});

for (const [name, args, message] of [
	['version reuse', ['--version', '1.0.0', '--commit', 'new'], /already belongs/],
	['commit reuse', ['--version', '1.0.1', '--commit', 'old'], /preserve its identity/],
	['redating', ['--version', '1.0.0', '--commit', 'old', '--timestamp', '200'], /immutable/],
	['backdating', ['--version', '1.0.1', '--commit', 'new', '--timestamp', '99'], /strictly newer/],
	['tied timestamp', ['--version', '1.0.1', '--commit', 'new', '--timestamp', '100'], /strictly newer/]
]) {
	test(`rejects ${name}`, () => {
		const result = prepare(args);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, message);
	});
}
