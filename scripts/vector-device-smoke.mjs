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
		'Launches a packaged Vector Code build on the current device and verifies the complete desktop golden path:',
		'project open, edit/save, terminal execution, Markdown preview, restart, and state restoration.',
		'',
		'Options:',
		'  --app-dir <path>             Packaged app directory, for example ../VSCode-win32-x64',
		'  --executable <path>          Executable override; defaults from packaged product.json',
		'  --expected-version <value>   Require packaged product/package metadata to match this version',
		'  --expected-commit <sha>      Require packaged product metadata to match this source commit',
		'  --workspace-dir <path>       Workspace directory; defaults to .tmp/vector-device-smoke/workspace',
		'  --user-data-dir <path>       User data directory; defaults to .tmp/vector-device-smoke/user-data',
		'  --extensions-dir <path>      Extensions directory; defaults to .tmp/vector-device-smoke/extensions',
		'  --report-dir <path>          Screenshot/log/report directory; defaults to .build/logs/vector-device-smoke',
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
	if (!isInsideRepo(dir) && !keepData) {
		throw new Error(`Refusing to manage directory outside the repo: ${dir}`);
	}
	if (!keepData) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
	}
	mkdirSync(dir, { recursive: true });
}

function errorMessage(error) {
	return String(error?.stack || error?.message || error);
}

function primaryModifier() {
	return process.platform === 'darwin' ? 'Meta' : 'Control';
}

function isKnownBenignConsoleDiagnostic(message) {
	return /\[DEP0040\] DeprecationWarning: The `punycode` module is deprecated\./.test(message);
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

async function runStep(report, name, action) {
	const step = {
		name,
		status: 'running',
		startedAt: new Date().toISOString()
	};
	report.steps.push(step);
	const startedAt = Date.now();
	try {
		const details = await action();
		step.status = 'passed';
		if (details !== undefined) {
			step.details = details;
		}
		return details;
	} catch (error) {
		step.status = 'failed';
		step.error = errorMessage(error);
		throw new Error(`[${name}] ${errorMessage(error)}`);
	} finally {
		step.finishedAt = new Date().toISOString();
		step.durationMs = Date.now() - startedAt;
	}
}

async function findWorkbenchPage(app, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const page = app.windows().find(candidate => candidate.url().includes('/workbench/workbench.html'));
		if (page) {
			await page.locator('[role="application"]').waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) });
			return page;
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	throw new Error('Packaged app did not open a workbench window.');
}

async function launchPackagedApp(options) {
	const args = [
		...(options.workspaceDir ? [options.workspaceDir] : []),
		'--skip-release-notes',
		'--skip-welcome',
		'--disable-telemetry',
		'--disable-experiments',
		'--no-cached-data',
		'--disable-updates',
		'--disable-workspace-trust',
		'--enable-smoke-test-driver',
		'--disable-gpu',
		`--user-data-dir=${options.userDataDir}`,
		`--extensions-dir=${options.extensionsDir}`,
		`--logsPath=${path.join(options.reportDir, 'logs', options.launchLabel)}`,
		`--crash-reporter-directory=${path.join(options.reportDir, 'crashes', options.launchLabel)}`
	];
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;

	const app = await playwright._electron.launch({
		executablePath: options.executablePath,
		args,
		env,
		timeout: options.timeoutMs
	});
	const page = await findWorkbenchPage(app, options.timeoutMs);
	page.on('console', message => {
		if (message.type() === 'error') {
			const diagnostic = { launch: options.launchLabel, message: message.text() };
			if (isKnownBenignConsoleDiagnostic(diagnostic.message)) {
				options.report.ignoredDiagnostics.push(diagnostic);
			} else {
				options.report.consoleErrors.push(diagnostic);
			}
		}
	});
	page.on('pageerror', error => {
		options.report.pageErrors.push({ launch: options.launchLabel, message: errorMessage(error) });
	});
	await page.waitForLoadState('domcontentloaded', { timeout: options.timeoutMs }).catch(() => undefined);
	await page.waitForTimeout(1500);
	return { app, page };
}

async function closePackagedApp(app) {
	await app.close().catch(async () => {
		const process = app.process();
		if (process && !process.killed) {
			process.kill();
		}
	});
}

async function captureScreenshot(page, reportDir, name) {
	const screenshotPath = path.join(reportDir, name);
	await page.screenshot({ path: screenshotPath, fullPage: true });
	return path.relative(repoRoot, screenshotPath).replaceAll(path.sep, '/');
}

async function openProjectFile(page, fileName, timeoutMs) {
	await page.keyboard.press(`${primaryModifier()}+P`);
	const quickInput = page.locator('.quick-input-widget input').first();
	await quickInput.waitFor({ state: 'visible', timeout: timeoutMs });
	await quickInput.fill(fileName);
	await page.waitForTimeout(300);
	await page.keyboard.press('Enter');
	const activeTab = page.locator('.tab.active').filter({ hasText: fileName }).first();
	await activeTab.waitFor({ state: 'visible', timeout: timeoutMs });
}

async function replaceActiveEditorContent(page, content, timeoutMs) {
	const editor = page.locator('.part.editor .monaco-editor .view-lines').last();
	await editor.waitFor({ state: 'visible', timeout: timeoutMs });
	await editor.click();
	await page.keyboard.press(`${primaryModifier()}+A`);
	await page.keyboard.press('Backspace');
	await page.keyboard.insertText(content);
	await page.keyboard.press(`${primaryModifier()}+S`);
}

async function waitForFileContent(filePath, expected, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	let lastContent = '';
	while (Date.now() < deadline) {
		lastContent = await readFile(filePath, 'utf8').catch(() => '');
		if (lastContent === expected) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	throw new Error(`Saved file did not reach expected content. Last content: ${JSON.stringify(lastContent)}`);
}

async function verifyActiveProject(page, workspaceDir, timeoutMs) {
	await page.keyboard.press(`${primaryModifier()}+Shift+E`);
	const projectName = path.basename(workspaceDir);
	const activeProject = page.locator('.vector-code-project-switcher__project--active').filter({ hasText: projectName }).first();
	await activeProject.waitFor({ state: 'visible', timeout: timeoutMs });
	return { name: projectName, path: workspaceDir };
}

async function ensureTerminalVisible(page, timeoutMs) {
	const visibleTab = page.locator('.vector-terminal-tab:visible').first();
	if (!await visibleTab.isVisible().catch(() => false)) {
		await page.getByRole('button', { name: 'Terminal', exact: true }).click();
	}
	await page.locator('.vector-terminal-tab:visible').first().waitFor({ state: 'visible', timeout: timeoutMs });
	const screen = page.locator('#terminal .terminal-wrapper:visible .xterm-screen').last();
	await screen.waitFor({ state: 'visible', timeout: timeoutMs });
	await screen.click({ position: { x: 8, y: 8 } });
	await page.locator('#terminal .terminal.xterm.focus').waitFor({ state: 'attached', timeout: timeoutMs });
}

async function runTerminalProbe(page, marker, fileText, timeoutMs) {
	await ensureTerminalVisible(page, timeoutMs);
	const markerParts = marker.split('_');
	const failureMarkerParts = marker.replace('EXIT=0', 'EXIT=1').split('_');
	const probe = `const f=require("fs");const ok=f.readFileSync("golden-path.txt","utf8").includes(${JSON.stringify(fileText)});console.log((ok?${JSON.stringify(markerParts)}:${JSON.stringify(failureMarkerParts)}).join("_"));process.exitCode=ok?0:1`;
	const encodedProbe = Buffer.from(probe, 'utf8').toString('base64');
	const command = `node -e "eval(Buffer.from('${encodedProbe}','base64').toString())"`;
	await page.keyboard.insertText(command);
	await page.keyboard.press('Enter');
	const terminalSelector = '#terminal .terminal-wrapper';
	await page.waitForFunction(() => typeof window.driver?.getTerminalBuffer === 'function', undefined, { timeout: timeoutMs });
	const deadline = Date.now() + timeoutMs;
	let buffer = [];
	while (Date.now() < deadline) {
		buffer = await page.evaluate(async selector => window.driver.getTerminalBuffer(selector), terminalSelector);
		const matchingLine = buffer.find(line => line.includes(marker));
		if (matchingLine) {
			return {
				marker,
				matchingLine,
				terminalTabCount: await page.locator('.vector-terminal-tab').count(),
				bufferTail: buffer.slice(-8)
			};
		}
		await page.waitForTimeout(250);
	}
	throw new Error(`Terminal did not emit ${marker}. Buffer tail:\n${buffer.slice(-12).join('\n')}`);
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
				frameResults.push({ url: frame.url(), error: errorMessage(error) });
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
	resetDirectory(reportDir, args['keep-data'] === true);

	const heading = 'Vector Device Markdown Smoke';
	const strongText = 'bold';
	const initialFileContent = 'VectorCode packaged golden path: before save.\n';
	const savedFileText = 'saved by packaged smoke';
	const savedFileContent = `VectorCode packaged golden path: ${savedFileText}.\n`;
	const goldenPathFile = path.join(workspaceDir, 'golden-path.txt');
	const markdownPath = path.join(workspaceDir, 'preview.md');
	writeFileSync(goldenPathFile, initialFileContent, 'utf8');
	writeFileSync(markdownPath, `# ${heading}\n\nRendered **${strongText}** text.\n`, 'utf8');
	mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
	writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
		'files.hotExit': 'onExitAndWindowClose',
		'security.workspace.trust.enabled': false,
		'telemetry.telemetryLevel': 'off',
		'terminal.integrated.enablePersistentSessions': true,
		'update.mode': 'none',
		'window.restoreWindows': 'all',
		'workbench.startupEditor': 'none'
	}, null, '\t'), 'utf8');

	const report = {
		schemaVersion: 1,
		status: 'running',
		startedAt: new Date().toISOString(),
		platform: process.platform,
		arch: process.arch,
		appDir,
		workspaceDir,
		steps: [],
		consoleErrors: [],
		ignoredDiagnostics: [],
		pageErrors: []
	};
	const reportPath = path.join(reportDir, 'golden-path-report.json');
	let app;
	let page;
	let resolvedApp;

	try {
		await runStep(report, 'verify packaged artifact identity', async () => {
			resolvedApp = await resolveApp(appDir, args.executable);
			const productVersion = resolvedApp.product?.version;
			const packageVersion = resolvedApp.packageJson?.version;
			const version = productVersion ?? packageVersion;
			const commit = resolvedApp.product?.commit;
			if (productVersion && packageVersion && productVersion !== packageVersion) {
				throw new Error(`Product version ${productVersion} does not match package version ${packageVersion}.`);
			}
			if (args['expected-version'] && (productVersion !== args['expected-version'] || packageVersion !== args['expected-version'])) {
				throw new Error(`Expected product/package version ${args['expected-version']}, got product ${productVersion ?? 'missing'} and package ${packageVersion ?? 'missing'}.`);
			}
			if (args['expected-commit'] && commit !== args['expected-commit']) {
				throw new Error(`Expected commit ${args['expected-commit']}, got ${commit ?? 'missing'}.`);
			}
			report.artifact = {
				executablePath: resolvedApp.executablePath,
				productName: resolvedApp.product?.nameLong ?? resolvedApp.product?.nameShort,
				version,
				packageVersion,
				commit,
				quality: resolvedApp.product?.quality
			};
			return report.artifact;
		});

		await runStep(report, 'launch clean packaged workbench', async () => {
			const launched = await launchPackagedApp({
				executablePath: resolvedApp.executablePath,
				workspaceDir,
				userDataDir,
				extensionsDir,
				reportDir,
				launchLabel: 'initial',
				timeoutMs,
				report
			});
			app = launched.app;
			page = launched.page;
			return { title: await page.title(), url: page.url() };
		});

		await runStep(report, 'select active project from a clean profile', async () => verifyActiveProject(page, workspaceDir, timeoutMs));

		await runStep(report, 'edit and save a project file', async () => {
			await openProjectFile(page, path.basename(goldenPathFile), timeoutMs);
			await replaceActiveEditorContent(page, savedFileContent, timeoutMs);
			await waitForFileContent(goldenPathFile, savedFileContent, timeoutMs);
			return {
				file: path.basename(goldenPathFile),
				bytes: Buffer.byteLength(savedFileContent)
			};
		});

		await runStep(report, 'run a project terminal command and observe exit result', async () => {
			const details = await runTerminalProbe(page, 'VECTOR_GOLDEN_PATH_EXIT=0', savedFileText, timeoutMs);
			details.screenshot = await captureScreenshot(page, reportDir, '01-terminal-command.png');
			return details;
		});

		await runStep(report, 'render Markdown in the packaged webview', async () => {
			await openProjectFile(page, path.basename(markdownPath), timeoutMs);
			const previewKeybinding = `${primaryModifier()}+Shift+V`;
			await page.keyboard.press(previewKeybinding);
			try {
				await findMarkdownPreview(page, heading, strongText, 10000);
			} catch {
				await page.keyboard.press('F1');
				const commandInput = page.locator('.quick-input-widget input').first();
				await commandInput.waitFor({ state: 'visible', timeout: timeoutMs });
				await commandInput.fill('Markdown: Open Preview');
				await page.keyboard.press('Enter');
				await findMarkdownPreview(page, heading, strongText, timeoutMs);
			}
			return {
				screenshot: await captureScreenshot(page, reportDir, '02-markdown-preview.png')
			};
		});

		await runStep(report, 'restart the packaged app with the same profile', async () => {
			await closePackagedApp(app);
			app = undefined;
			page = undefined;
			await new Promise(resolve => setTimeout(resolve, 1000));
			const relaunched = await launchPackagedApp({
				executablePath: resolvedApp.executablePath,
				workspaceDir: undefined,
				userDataDir,
				extensionsDir,
				reportDir,
				launchLabel: 'restored',
				timeoutMs,
				report
			});
			app = relaunched.app;
			page = relaunched.page;
			return { title: await page.title(), url: page.url() };
		});

		await runStep(report, 'restore the active project and editor state', async () => {
			const project = await verifyActiveProject(page, workspaceDir, timeoutMs);
			await page.locator('.tab').filter({ hasText: path.basename(markdownPath) }).first().waitFor({ state: 'visible', timeout: timeoutMs });
			await waitForFileContent(goldenPathFile, savedFileContent, timeoutMs);
			return {
				...project,
				restoredEditor: path.basename(markdownPath),
				savedFile: path.basename(goldenPathFile)
			};
		});

		await runStep(report, 'restore a functional project terminal', async () => {
			const details = await runTerminalProbe(page, 'VECTOR_RESTORED_TERMINAL_EXIT=0', savedFileText, timeoutMs);
			details.screenshot = await captureScreenshot(page, reportDir, '03-restored-workbench.png');
			return details;
		});

		await runStep(report, 'verify renderer diagnostics', async () => {
			if (report.pageErrors.length > 0) {
				throw new Error(`Renderer page errors:\n${report.pageErrors.map(item => item.message).join('\n')}`);
			}
			if (report.consoleErrors.length > 0) {
				throw new Error(`Renderer console errors:\n${report.consoleErrors.map(item => item.message).join('\n')}`);
			}
			return {
				consoleErrors: 0,
				pageErrors: 0,
				ignoredDiagnostics: report.ignoredDiagnostics.length
			};
		});

		report.status = 'passed';
		console.log('Vector packaged golden-path smoke passed');
		console.log(`  executable: ${report.artifact.executablePath}`);
		console.log(`  version: ${report.artifact.version ?? 'unknown'}`);
		console.log(`  commit: ${report.artifact.commit ?? 'unknown'}`);
		for (const step of report.steps) {
			console.log(`  ok - ${step.name} (${step.durationMs}ms)`);
		}
		console.log(`  report: ${path.relative(repoRoot, reportPath).replaceAll(path.sep, '/')}`);
	} catch (error) {
		report.status = 'failed';
		report.error = errorMessage(error);
		if (page) {
			await page.screenshot({ path: path.join(reportDir, 'failure.png'), fullPage: true }).catch(() => undefined);
			const visibleText = await page.locator('body').innerText().catch(() => '');
			writeFileSync(path.join(reportDir, 'failure-ui.txt'), visibleText.slice(0, 100_000), 'utf8');
		}
		throw error;
	} finally {
		if (app) {
			await closePackagedApp(app);
		}
		report.finishedAt = new Date().toISOString();
		writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
	}
}

main().catch(error => {
	console.error(errorMessage(error));
	process.exit(1);
});
