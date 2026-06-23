/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			throw new Error(`Unexpected argument: ${arg}`);
		}

		const name = arg.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			args[name] = true;
		} else {
			args[name] = next;
			i++;
		}
	}
	return args;
}

function usage() {
	console.log([
		'Usage: npm run vector-release-update -- --artifact <path> [options]',
		'',
		'Prepares services/update-feed/manifest.example.json for a VectorCode desktop update release.',
		'',
		'Options:',
		'  --artifact <path>         Signed/notarized release artifact to publish',
		'  --version <version>       Product version; defaults to package.json version',
		'  --commit <commit>         Built app commit; defaults to git HEAD',
		'  --quality <quality>       Release quality; defaults to product.json quality or stable',
		'  --platform <platform>     Asset platform; defaults to darwin-arm64',
		'  --asset-name <name>       Published asset name; defaults to Vector-Code-<version>-arm64.<ext> on macOS',
		'  --url <url>               Exact asset URL; overrides --release-base-url',
		'  --release-base-url <url>  Base release URL; defaults to https://vectorcode.app/releases',
		'  --manifest <path>         Manifest path; defaults to services/update-feed/manifest.example.json',
		'  --copy-to-public          Copy artifact to services/update-feed/public/releases/<version>/<asset-name>',
		'  --public-root <path>      Public release root; defaults to services/update-feed/public/releases',
		'  --timestamp <ms>          Release timestamp; defaults to now',
		'  --previous-commit <sha>   Commit to verify as update-eligible; defaults to previous latest manifest release',
		'  --dry-run                 Print output without writing files',
		'  --allow-dirty             Permit manifest prep from a dirty worktree',
		'  --help                    Show this help'
	].join('\n'));
}

function readTextJson(relativePath) {
	return JSON.parse(execFileSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(path.join(repoRoot, relativePath))})))`], { encoding: 'utf8' }));
}

function git(args) {
	return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function hasDirtyWorktree() {
	return git(['status', '--porcelain']).length > 0;
}

function resolvePath(value) {
	return path.resolve(repoRoot, value);
}

function defaultAssetName(version, platform, artifactPath) {
	const ext = path.extname(artifactPath) || '.dmg';
	if (platform === 'darwin-arm64') {
		return `Vector-Code-${version}-arm64${ext}`;
	}
	if (platform === 'darwin-universal') {
		return `Vector-Code-${version}-universal${ext}`;
	}
	if (platform === 'darwin') {
		return `Vector-Code-${version}-x64${ext}`;
	}
	return path.basename(artifactPath);
}

function trimTrailingSlash(value) {
	return value.replace(/\/+$/, '');
}

async function sha256(filePath) {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256');
		const stream = createReadStream(filePath);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('error', reject);
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

function latestCompatibleRelease(feed, platform, quality) {
	return feed.releases
		.filter(release => release.quality === quality && (release.assets[platform] || ((platform === 'darwin' || platform === 'darwin-arm64') && release.assets['darwin-universal'])))
		.sort((a, b) => b.timestamp - a.timestamp || b.version.localeCompare(a.version))[0];
}

function upsertRelease(feed, release) {
	const releases = feed.releases.filter(existing => !(existing.version === release.version && existing.quality === release.quality));
	return {
		schemaVersion: 1,
		releases: [
			release,
			...releases
		].sort((a, b) => b.timestamp - a.timestamp || b.version.localeCompare(a.version))
	};
}

async function verifyManifest(manifest, platform, quality, commit, previousCommit, expectedUrl) {
	const moduleUrl = pathToFileURL(path.join(repoRoot, 'services/update-feed/server.mjs')).href;
	const { parseVectorUpdateFeed, resolveVectorUpdate } = await import(moduleUrl);
	const feed = parseVectorUpdateFeed(manifest);
	const currentResult = resolveVectorUpdate(feed, { platform, quality, commit });
	if (currentResult.statusCode !== 204) {
		throw new Error(`Expected new commit ${commit} to resolve to 204, got ${currentResult.statusCode}`);
	}

	if (previousCommit && previousCommit !== commit) {
		const previousResult = resolveVectorUpdate(feed, { platform, quality, commit: previousCommit });
		if (previousResult.statusCode !== 200) {
			throw new Error(`Expected previous commit ${previousCommit} to resolve to 200, got ${previousResult.statusCode}`);
		}
		if (previousResult.body.url !== expectedUrl) {
			throw new Error(`Expected update URL ${expectedUrl}, got ${previousResult.body.url}`);
		}
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}

	const artifactArg = args.artifact;
	if (typeof artifactArg !== 'string') {
		throw new Error('Missing required --artifact <path>');
	}

	const packageJson = readTextJson('package.json');
	const productJson = readTextJson('product.json');
	const artifactPath = resolvePath(artifactArg);
	if (!existsSync(artifactPath)) {
		throw new Error(`Artifact does not exist: ${artifactPath}`);
	}

	const version = typeof args.version === 'string' ? args.version : packageJson.version;
	const commit = typeof args.commit === 'string' ? args.commit : git(['rev-parse', 'HEAD']);
	const quality = typeof args.quality === 'string' ? args.quality : (productJson.quality || 'stable');
	const platform = typeof args.platform === 'string' ? args.platform : 'darwin-arm64';
	const manifestPath = resolvePath(typeof args.manifest === 'string' ? args.manifest : 'services/update-feed/manifest.example.json');
	const releaseBaseUrl = typeof args['release-base-url'] === 'string' ? args['release-base-url'] : 'https://vectorcode.app/releases';
	const assetName = typeof args['asset-name'] === 'string' ? args['asset-name'] : defaultAssetName(version, platform, artifactPath);
	const assetUrl = typeof args.url === 'string' ? args.url : `${trimTrailingSlash(releaseBaseUrl)}/${version}/${assetName}`;
	const publicRoot = resolvePath(typeof args['public-root'] === 'string' ? args['public-root'] : 'services/update-feed/public/releases');
	const timestamp = typeof args.timestamp === 'string' ? Number.parseInt(args.timestamp, 10) : Date.now();
	const dryRun = args['dry-run'] === true;
	const allowDirty = args['allow-dirty'] === true;

	if (!Number.isFinite(timestamp)) {
		throw new Error(`Invalid --timestamp: ${args.timestamp}`);
	}

	if (!dryRun && !allowDirty && hasDirtyWorktree()) {
		throw new Error('Worktree has uncommitted changes. Commit the release contents first, or rerun with --allow-dirty for an intentional manifest-only prep.');
	}

	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const previousLatest = latestCompatibleRelease(manifest, platform, quality);
	const previousCommit = typeof args['previous-commit'] === 'string' ? args['previous-commit'] : previousLatest?.commit;
	if (previousLatest && previousLatest.version === version && previousLatest.commit !== commit) {
		console.warn(`warning: release version ${version} matches the previous latest ${quality} release; pass --version to make the UI show a new product version.`);
	}

	const artifactStats = await stat(artifactPath);
	const asset = {
		url: assetUrl,
		sha256hash: await sha256(artifactPath),
		size: artifactStats.size
	};
	const existingSameVersion = manifest.releases.find(release => release.version === version && release.quality === quality);
	const release = {
		version,
		commit,
		quality,
		timestamp,
		assets: {
			...(existingSameVersion?.assets ?? {}),
			[platform]: asset
		}
	};
	const nextManifest = upsertRelease(manifest, release);

	const verifiedPreviousCommit = Boolean(previousCommit && previousCommit !== commit);
	await verifyManifest(nextManifest, platform, quality, commit, previousCommit, assetUrl);

	if (dryRun) {
		console.log(JSON.stringify(nextManifest, null, 2));
	} else {
		await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
		if (args['copy-to-public'] === true) {
			const destination = path.join(publicRoot, version, assetName);
			await mkdir(path.dirname(destination), { recursive: true });
			await copyFile(artifactPath, destination);
			console.log(`Copied artifact: ${path.relative(repoRoot, destination)}`);
		}
		console.log(`Updated manifest: ${path.relative(repoRoot, manifestPath)}`);
	}

	console.log([
		'Release update prepared:',
		`  version: ${version}`,
		`  commit: ${commit}`,
		`  quality: ${quality}`,
		`  platform: ${platform}`,
		`  url: ${assetUrl}`,
		`  sha256hash: ${asset.sha256hash}`,
		`  size: ${asset.size}`,
		verifiedPreviousCommit ? `  verified previous commit update response: ${previousCommit} -> 200` : '  verified previous commit update response: skipped',
		`  verified current commit update response: ${commit} -> 204`
	].join('\n'));
}

main().catch(error => {
	console.error(error.message || error);
	process.exit(1);
});
