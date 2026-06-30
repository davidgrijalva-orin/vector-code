/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwright = require('playwright');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
	console.log([
		'Usage: node scripts/vector-device-smoke.mjs --app-dir <path> [options]',
		'',
		'Launches a packaged Vector Code build on the current device and verifies Markdown preview renders in the Electron UI.',
		'',
		'Options:',
		'  --app-dir <path>             Packaged app directory, for example ../VSCode-win32-x64',
		'  --executable <path>          Executable override; defaults from packaged product.json',
		'  --workspace-dir <path>       Workspace directory; defaults to .tmp/vector-device-smoke/workspace',
		'  --user-data-dir <path>       User data directory; defaults to .tmp/vector-device-smoke/user-data',
		'  --extensions-dir <path>      Extensions directory; defaults to .tmp/vector-device-smoke/extensions',
		'  --report-dir <path>          Screenshot/log directory; defaults to .build/logs/vector-device-smoke',
		'  --timeout-ms <number>        Overall UI wait timeout; defaults to 60000',
		'  --keep-data                  Do not delete test data directories before running',
		'  --help                       Show this help'
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
		if (name === 'help' || name === 'keep-data') {
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

function isInsideRepo(value) {
	const relative = path.relative(repoRoot, value);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resetDirectory(dir, keepData) {
	if (!isInsideRepo(dir)) {
		throw new Error(`Refusing to manage directory outside the repo: ${dir}`);
	}
	if (!keepData) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
	}
	mkdirSync(dir, { recursive: true });
}

async function readJson(filePath) {
	return JSON.parse(await readFile(filePath, 'utf8'));
}

async function resolveApp(appDir, executableOverride) {
	if (executableOverride) {
		const executablePath = resolveRepoPath(executableOverride);
		if (!existsSync(executablePath)) {
			throw new Error(`Executable does not exist: ${executablePath}`);
		}
		return { executablePath, product: undefined, packageJson: undefined };
	}

	const macProductPath = path.join(appDir, 'Contents', 'Resources', 'app', 'product.json');
	const macPackagePath = path.join(appDir, 'Contents', 'Resources', 'app', 'package.json');
	const desktopProductPath = path.join(appDir, 'resources', 'app', 'product.json');
	const desktopPackagePath = path.join(appDir, 'resources', 'app', 'package.json');

	if (existsSync(macProductPath)) {
		const product = await readJson(macProductPath);
		const packageJson = await readJson(macPackagePath);
		const executablePath = path.join(appDir, 'Contents', 'MacOS', product.nameShort);
		const legacyExecutablePath = path.join(appDir, 'Contents', 'MacOS', 'Electron');
		if (existsSync(executablePath)) {
			return { executablePath, product, packageJson };
		}
		if (existsSync(legacyExecutablePath)) {
			return { executablePath: legacyExecutablePath, product, packageJson };
		}
		throw new Error(`Could not find macOS app executable in ${path.join(appDir, 'Contents', 'MacOS')}`);
	}

	if (existsSync(desktopProductPath)) {
		const product = await readJson(desktopProductPath);
		const packageJson = await readJson(desktopPackagePath);
		const executableName = process.platform === 'win32' ? `${product.nameShort}.exe` : product.applicationName;
		const executablePath = path.join(appDir, executableName);
		if (!existsSync(executablePath)) {
			throw new Error(`Could not find packaged app executable: ${executablePath}`);
		}
		return { executablePath, product, packageJson };
	}

	throw new Error(`Could not find packaged product.json under ${appDir}`);
}

async function findMarkdownPreview(page, expectedHeading, expectedStrong, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let lastFrameReport = '';

	while (Date.now() < deadline) {
		const frameResults = [];
		for (const frame of page.frames()) {
			if (frame === page.mainFrame()) {
				continue;
			}

			try {
				const result = await frame.evaluate(() => {
					const documents = [document];
					for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
						try {
							if (iframe.contentDocument) {
								documents.push(iframe.contentDocument);
							}
						} catch {
							// Cross-origin frames are not the Markdown document we need to inspect.
						}
					}

					return documents.map(doc => ({
						url: doc.location.href,
						readyState: doc.readyState,
						text: doc.body?.innerText ?? '',
						heading: doc.querySelector('h1')?.textContent?.trim() ?? '',
						strong: doc.querySelector('strong')?.textContent?.trim() ?? '',
						iframeCount: doc.querySelectorAll('iframe').length
					}));
				});
				frameResults.push(...result);
				const match = result.find(doc => doc.heading === expectedHeading && doc.strong === expectedStrong && doc.text.includes('Rendered bold text.'));
				if (match) {
					return match;
				}
			} catch (error) {
				frameResults.push({ url: frame.url(), error: String(error?.message ?? error) });
			}
		}

		lastFrameReport = JSON.stringify(frameResults.map(frame => ({
			url: frame.url,
			readyState: frame.readyState,
			heading: frame.heading,
			strong: frame.strong,
			text: typeof frame.text === 'string' ? frame.text.slice(0, 160) : undefined,
			error: frame.error
		})), null, 2);
		await page.waitForTimeout(500);
	}

	throw new Error(`Markdown preview did not render expected content. Last subframe report:\n${lastFrameReport}`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}
	if (!args['app-dir']) {
		throw new Error('Missing required --app-dir <path>');
	}

	const appDir = resolveRepoPath(args['app-dir']);
	const workspaceDir = resolveRepoPath(args['workspace-dir'] ?? '.tmp/vector-device-smoke/workspace');
	const userDataDir = resolveRepoPath(args['user-data-dir'] ?? '.tmp/vector-device-smoke/user-data');
	const extensionsDir = resolveRepoPath(args['extensions-dir'] ?? '.tmp/vector-device-smoke/extensions');
	const reportDir = resolveRepoPath(args['report-dir'] ?? '.build/logs/vector-device-smoke');
	const timeoutMs = Number.parseInt(args['timeout-ms'] ?? '60000', 10);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error(`Invalid --timeout-ms: ${args['timeout-ms']}`);
	}

	resetDirectory(workspaceDir, args['keep-data'] === true);
	resetDirectory(userDataDir, args['keep-data'] === true);
	resetDirectory(extensionsDir, args['keep-data'] === true);
	resetDirectory(reportDir, true);

	const heading = 'Vector Device Markdown Smoke';
	const strongText = 'bold';
	const markdownPath = path.join(workspaceDir, 'preview.md');
	writeFileSync(markdownPath, `# ${heading}\n\nRendered **${strongText}** text.\n`, 'utf8');
	mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
	writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
		'workbench.startupEditor': 'none',
		'security.workspace.trust.enabled': false,
		'telemetry.telemetryLevel': 'off',
		'update.mode': 'none'
	}, null, '\t'), 'utf8');

	const { executablePath, product, packageJson } = await resolveApp(appDir, args.executable);
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;

	const consoleErrors = [];
	let app;
	let page;
	try {
		app = await playwright._electron.launch({
			executablePath,
			args: [
				markdownPath,
				'--new-window',
				'--skip-release-notes',
				'--skip-welcome',
				'--disable-telemetry',
				'--disable-experiments',
				'--no-cached-data',
				'--disable-updates',
				'--disable-workspace-trust',
				'--disable-gpu',
				`--user-data-dir=${userDataDir}`,
				`--extensions-dir=${extensionsDir}`,
				`--logsPath=${path.join(reportDir, 'logs')}`,
				`--crash-reporter-directory=${path.join(reportDir, 'crashes')}`
			],
			env,
			timeout: timeoutMs
		});

		page = app.windows()[0] ?? await app.waitForEvent('window', { timeout: timeoutMs });
		page.on('console', message => {
			if (message.type() === 'error') {
				consoleErrors.push(message.text());
			}
		});
		page.on('pageerror', error => consoleErrors.push(String(error)));
		await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
		await page.waitForTimeout(2000);

		const previewKeybinding = process.platform === 'darwin' ? 'Meta+Shift+V' : 'Control+Shift+V';
		await page.keyboard.press(previewKeybinding);

		try {
			await findMarkdownPreview(page, heading, strongText, 10000);
		} catch {
			await page.keyboard.press('F1');
			await page.keyboard.type('Markdown: Open Preview', { delay: 5 });
			await page.keyboard.press('Enter');
			await findMarkdownPreview(page, heading, strongText, timeoutMs);
		}

		if (consoleErrors.some(error => /content security policy|refused to execute|webview/i.test(error))) {
			throw new Error(`Device smoke saw webview/CSP console errors:\n${consoleErrors.join('\n')}`);
		}

		if (page) {
			await page.screenshot({ path: path.join(reportDir, 'markdown-preview.png'), fullPage: true }).catch(() => undefined);
		}

		console.log('Vector device smoke passed');
		console.log(`  executable: ${executablePath}`);
		if (product) {
			console.log(`  product: ${product.nameLong ?? product.nameShort ?? 'unknown'}`);
		}
		if (packageJson) {
			console.log(`  version: ${packageJson.version}`);
		}
		console.log(`  markdown preview screenshot: ${path.relative(repoRoot, path.join(reportDir, 'markdown-preview.png')).replaceAll(path.sep, '/')}`);
	} catch (error) {
		if (page) {
			await page.screenshot({ path: path.join(reportDir, 'failure.png'), fullPage: true }).catch(() => undefined);
		}
		throw error;
	} finally {
		if (app) {
			await app.close().catch(async () => {
				const process = app.process();
				if (process && !process.killed) {
					process.kill();
				}
			});
		}
	}
}

main().catch(error => {
	console.error(error?.stack || error?.message || error);
	process.exit(1);
});
