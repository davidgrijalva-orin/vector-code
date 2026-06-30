/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVectorUpdateFeed, resolveVectorUpdate, selectLatestDownload } from '../services/update-feed/server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webviewPreloadRelativePath = path.join('vs', 'workbench', 'contrib', 'webview', 'browser', 'pre', 'index.html');
const minWindowsSetupSize = 100 * 1024 * 1024;
const minWindowsArchiveSize = 150 * 1024 * 1024;

function usage() {
	console.log([
		'Usage: npm run vector-build-smoke -- [options]',
		'',
		'Runs source and packaged release smoke checks for VectorCode desktop builds.',
		'',
		'Options:',
		'  --platform <platform>             Target platform; currently supports win32-x64 artifact checks',
		'  --version <version>               Release version, for example 1.122.5-win2',
		'  --package-version <version>       Expected packaged app package.json version; defaults to --version',
		'  --commit <sha>                    Built commit; defaults to git HEAD',
		'  --quality <quality>               Release quality; defaults to stable',
		'  --app-dir <path>                  Packaged app directory, for example ../VSCode-win32-x64',
		'  --artifact-dir <path>             Directory containing renamed release artifacts',
		'  --user-setup <name>               Windows user setup artifact name',
		'  --system-setup <name>             Windows system setup artifact name',
		'  --archive <name>                  Windows zip archive artifact name',
		'  --manifest <path>                 Update feed manifest; defaults to services/update-feed/manifest.example.json',
		'  --release-base-url <url>          Base URL used for synthetic manifest verification',
		'  --source-only                     Only run source checks',
		'  --help                            Show this help'
	].join('\n'));
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--') {
			continue;
		}
		if (!arg.startsWith('--')) {
			throw new Error(`Unexpected argument: ${arg}`);
		}

		const name = arg.slice(2);
		if (name === 'help' || name === 'source-only') {
			args[name] = true;
			continue;
		}

		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			throw new Error(`Missing value for ${arg}`);
		}

		args[name] = next;
		i++;
	}

	return args;
}

function resolveRepoPath(value) {
	return path.resolve(repoRoot, value);
}

function relativeToRepo(value) {
	return path.relative(repoRoot, value).replaceAll(path.sep, '/');
}

function git(args) {
	return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function check(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function pass(passes, message) {
	passes.push(message);
}

function getCspContent(html, label) {
	const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)]
		.map(match => match[0])
		.filter(tag => /\bhttp-equiv=(["'])Content-Security-Policy\1/i.test(tag));
	check(metaTags.length === 1, `${label}: expected exactly one Content-Security-Policy meta tag, found ${metaTags.length}`);

	const content = metaTags[0].match(/\bcontent=(["'])([\s\S]*?)\1/i);
	check(Boolean(content), `${label}: CSP meta tag must have a content attribute`);
	return content[2];
}

function getInlineModuleScript(html, label) {
	const scripts = [...html.matchAll(/<script\b(?=[^>]*\btype=(["'])module\1)[^>]*>([\s\S]*?)<\/script>/gi)];
	check(scripts.length === 1, `${label}: expected exactly one inline module script, found ${scripts.length}`);
	return scripts[0][2];
}

function verifyWebviewPreloadCsp(filePath, label, passes) {
	check(existsSync(filePath), `${label}: missing webview preload HTML at ${relativeToRepo(filePath)}`);
	const html = readFileSync(filePath, 'utf8');
	const csp = getCspContent(html, label);
	const script = getInlineModuleScript(html, label);
	const hash = createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64');

	check(csp.includes('script-src'), `${label}: CSP must define script-src`);
	check(csp.includes(`'sha256-${hash}'`), `${label}: script-src hash is stale; expected sha256-${hash}`);
	check(csp.includes("'self'"), `${label}: script-src must keep 'self' for packaged preload resources`);
	pass(passes, `${label}: webview preload CSP hash matches inline module script`);
}

function requireFile(filePath, label, minBytes, passes) {
	check(existsSync(filePath), `${label}: missing file ${filePath}`);
	const stat = statSync(filePath);
	check(stat.isFile(), `${label}: expected a file, got ${filePath}`);
	check(stat.size >= minBytes, `${label}: expected ${filePath} to be at least ${minBytes} bytes, got ${stat.size}`);
	pass(passes, `${label}: ${path.basename(filePath)} exists (${stat.size} bytes)`);
	return stat;
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

function getReleaseAsset(release, platform) {
	return release.assets[platform]
		?? (platform === 'darwin' || platform === 'darwin-arm64' ? release.assets['darwin-universal'] : undefined);
}

function latestCompatibleRelease(feed, platform, quality) {
	return feed.releases
		.filter(release => release.quality === quality && getReleaseAsset(release, platform))
		.sort((a, b) => b.timestamp - a.timestamp || b.version.localeCompare(a.version))[0];
}

function upsertRelease(feed, release) {
	return {
		schemaVersion: 1,
		releases: [
			release,
			...feed.releases.filter(existing => !(existing.version === release.version && existing.quality === release.quality))
		].sort((a, b) => b.timestamp - a.timestamp || b.version.localeCompare(a.version))
	};
}

function expectedWindowsNames(version) {
	const prefix = `Vector-Code-${version}-win32-x64`;
	return {
		userSetup: `${prefix}-user-setup.exe`,
		systemSetup: `${prefix}-system-setup.exe`,
		archive: `${prefix}.zip`
	};
}

function verifyWindowsAppBundle(args, passes) {
	const appDir = resolveRepoPath(args['app-dir']);
	check(existsSync(appDir), `Windows app bundle does not exist: ${appDir}`);

	const product = readJson(path.join(appDir, 'resources', 'app', 'product.json'));
	const packageJson = readJson(path.join(appDir, 'resources', 'app', 'package.json'));
	const expectedPackageVersion = args['package-version'] ?? args.version;

	check(product.nameShort === 'Vector Code', `Windows app bundle: expected product.nameShort "Vector Code", got ${product.nameShort}`);
	check(product.applicationName === 'vector-code', `Windows app bundle: expected applicationName "vector-code", got ${product.applicationName}`);
	check(product.quality === args.quality, `Windows app bundle: expected quality ${args.quality}, got ${product.quality}`);
	check(typeof product.updateUrl === 'string' && product.updateUrl.startsWith('https://'), 'Windows app bundle: product.updateUrl must be an https URL');
	if (expectedPackageVersion) {
		check(packageJson.version === expectedPackageVersion, `Windows app bundle: expected package version ${expectedPackageVersion}, got ${packageJson.version}`);
	}
	pass(passes, 'Windows app bundle: product and package metadata are consistent');

	requireFile(path.join(appDir, 'Vector Code.exe'), 'Windows app bundle', minWindowsSetupSize, passes);
	requireFile(path.join(appDir, 'bin', 'vector-code'), 'Windows app bundle', 1, passes);
	requireFile(path.join(appDir, 'tools', 'inno_updater.exe'), 'Windows app bundle', 100 * 1024, passes);
	requireFile(path.join(appDir, 'appx', 'code_x64.appx'), 'Windows app bundle', 1, passes);
	requireFile(path.join(appDir, 'appx', 'code_explorer_command_x64.dll'), 'Windows app bundle', 10 * 1024, passes);
	check(!existsSync(path.join(appDir, 'appx', 'manifest')), 'Windows app bundle: raw appx manifest folder must be packed and removed before installer build');
	pass(passes, 'Windows app bundle: appx context-menu payload is packed');

	for (const extensionName of ['markdown-language-features', 'markdown-math', 'mermaid-markdown-features', 'ms-vscode.js-debug']) {
		const extensionPath = path.join(appDir, 'resources', 'app', 'extensions', extensionName);
		check(existsSync(extensionPath), `Windows app bundle: missing built-in extension ${extensionName}`);
	}
	pass(passes, 'Windows app bundle: Markdown and JavaScript debug built-in extensions are packaged');

	verifyWebviewPreloadCsp(path.join(appDir, 'resources', 'app', 'out', webviewPreloadRelativePath), 'packaged webview preload', passes);
}

async function verifyWindowsArtifacts(args, passes) {
	const artifactDir = resolveRepoPath(args['artifact-dir']);
	check(existsSync(artifactDir), `Windows artifact directory does not exist: ${artifactDir}`);
	const expectedNames = expectedWindowsNames(args.version);
	const userSetupName = args['user-setup'] ?? expectedNames.userSetup;
	const systemSetupName = args['system-setup'] ?? expectedNames.systemSetup;
	const archiveName = args.archive ?? expectedNames.archive;

	check(userSetupName === expectedNames.userSetup, `Windows artifacts: user setup name must be ${expectedNames.userSetup}, got ${userSetupName}`);
	check(systemSetupName === expectedNames.systemSetup, `Windows artifacts: system setup name must be ${expectedNames.systemSetup}, got ${systemSetupName}`);
	check(archiveName === expectedNames.archive, `Windows artifacts: archive name must be ${expectedNames.archive}, got ${archiveName}`);

	const artifactSpecs = [
		{ platform: 'win32-x64-user', name: userSetupName, minBytes: minWindowsSetupSize },
		{ platform: 'win32-x64', name: systemSetupName, minBytes: minWindowsSetupSize },
		{ platform: 'win32-x64-archive', name: archiveName, minBytes: minWindowsArchiveSize }
	];

	const assets = {};
	for (const spec of artifactSpecs) {
		const artifactPath = path.join(artifactDir, spec.name);
		const stat = requireFile(artifactPath, `Windows artifact ${spec.platform}`, spec.minBytes, passes);
		assets[spec.platform] = {
			path: artifactPath,
			name: spec.name,
			url: `${args['release-base-url'].replace(/\/+$/, '')}/${spec.name}`,
			sha256hash: await sha256(artifactPath),
			size: stat.size
		};
	}

	const sumsPath = path.join(artifactDir, 'SHA256SUMS.txt');
	if (existsSync(sumsPath)) {
		const sums = readFileSync(sumsPath, 'utf8');
		for (const asset of Object.values(assets)) {
			check(sums.includes(`${asset.sha256hash}  ${asset.name}`), `Windows artifacts: SHA256SUMS.txt is missing ${asset.name}`);
		}
		pass(passes, 'Windows artifacts: SHA256SUMS.txt matches all release assets');
	}

	return assets;
}

async function verifySyntheticUpdateFeed(args, assets, passes) {
	const manifestPath = resolveRepoPath(args.manifest ?? 'services/update-feed/manifest.example.json');
	const manifest = parseVectorUpdateFeed(JSON.parse(await readFile(manifestPath, 'utf8')));
	const release = {
		version: args.version,
		commit: args.commit,
		quality: args.quality,
		timestamp: Date.now(),
		assets: Object.fromEntries(Object.entries(assets).map(([platform, asset]) => [
			platform,
			{
				url: asset.url,
				sha256hash: asset.sha256hash,
				size: asset.size
			}
		]))
	};
	const nextFeed = upsertRelease(manifest, release);
	parseVectorUpdateFeed(nextFeed);

	for (const [platform, asset] of Object.entries(assets)) {
		const current = resolveVectorUpdate(nextFeed, { platform, quality: args.quality, commit: args.commit });
		check(current.statusCode === 204, `Update feed ${platform}: expected current commit ${args.commit} to return 204, got ${current.statusCode}`);

		const latest = selectLatestDownload(nextFeed, platform, args.quality);
		check(latest?.release.commit === args.commit, `Update feed ${platform}: new release must be selected as latest`);
		check(latest?.asset.url === asset.url, `Update feed ${platform}: selected URL mismatch`);

		const previous = latestCompatibleRelease(manifest, platform, args.quality);
		if (previous && previous.commit !== args.commit) {
			const update = resolveVectorUpdate(nextFeed, { platform, quality: args.quality, commit: previous.commit });
			check(update.statusCode === 200, `Update feed ${platform}: expected previous commit ${previous.commit} to return 200, got ${update.statusCode}`);
			check(update.body.url === asset.url, `Update feed ${platform}: expected update URL ${asset.url}, got ${update.body.url}`);
			check(update.body.sha256hash === asset.sha256hash, `Update feed ${platform}: expected update sha256hash ${asset.sha256hash}, got ${update.body.sha256hash}`);
		}
	}

	pass(passes, 'Update feed: synthetic Windows release resolves current commits to 204 and older commits to update payloads');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}

	const passes = [];
	verifyWebviewPreloadCsp(path.join(repoRoot, 'src', webviewPreloadRelativePath), 'source webview preload', passes);

	if (args['source-only']) {
		console.log(`Vector build smoke passed (${passes.length} checks)`);
		for (const item of passes) {
			console.log(`  ok - ${item}`);
		}
		return;
	}

	args.platform ??= 'win32-x64';
	args.quality ??= 'stable';
	args.commit ??= git(['rev-parse', 'HEAD']);

	if (args.platform !== 'win32-x64') {
		throw new Error(`Unsupported platform for artifact checks: ${args.platform}`);
	}
	if (!args.version) {
		throw new Error('Missing required --version for artifact checks');
	}
	if (!args['release-base-url']) {
		throw new Error('Missing required --release-base-url for update-feed verification');
	}

	if (args['app-dir']) {
		verifyWindowsAppBundle(args, passes);
	}
	if (!args['artifact-dir']) {
		throw new Error('Missing required --artifact-dir for artifact checks');
	}

	const assets = await verifyWindowsArtifacts(args, passes);
	await verifySyntheticUpdateFeed(args, assets, passes);

	console.log(`Vector build smoke passed (${passes.length} checks)`);
	for (const item of passes) {
		console.log(`  ok - ${item}`);
	}
}

main().catch(error => {
	console.error(error?.stack || error?.message || error);
	process.exit(1);
});
