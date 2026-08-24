/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const REQUEST_TIMEOUT_MS = 30_000;
const codexCommand = process.env.VECTOR_CODE_CODEX_COMMAND || 'codex';
const launch = resolveCodexLaunch(codexCommand);
const child = spawn(launch.command, launch.args, {
	cwd: process.cwd(),
	env: process.env,
	stdio: ['pipe', 'pipe', 'pipe'],
	windowsHide: true,
	shell: launch.shell,
});
const pending = new Map();
let stderr = '';

child.stderr.on('data', data => {
	stderr = `${stderr}${data.toString()}`.slice(-8_000);
});
child.on('error', error => {
	rejectAll(error);
});
child.on('exit', code => {
	const error = new Error(stderr.trim() || `Codex App Server exited with code ${code}.`);
	rejectAll(error);
});

const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
output.on('line', line => {
	if (!line.trim()) {
		return;
	}
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	if ((typeof message.id !== 'number' && typeof message.id !== 'string') || message.method !== undefined) {
		return;
	}
	if (message.error !== undefined) {
		settle(message.id, request => request.reject(new Error(message.error?.message || JSON.stringify(message.error))));
	} else {
		settle(message.id, request => request.resolve(message.result));
	}
});

function request(method, params) {
	const id = `vector-code-smoke-${randomUUID()}`;
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			settle(id, pendingRequest => pendingRequest.reject(new Error(`Timed out waiting for ${method}.`)));
		}, REQUEST_TIMEOUT_MS);
		pending.set(id, { resolve, reject, timeout });
		child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
	});
}

function settle(id, action) {
	const request = pending.get(id);
	if (!request) {
		return false;
	}
	pending.delete(id);
	clearTimeout(request.timeout);
	action(request);
	return true;
}

function rejectAll(error) {
	for (const id of [...pending.keys()]) {
		settle(id, request => request.reject(error));
	}
}

function notify(method, params) {
	child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
}

function record(value) {
	return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveCodexLaunch(command) {
	if (process.platform === 'win32') {
		let wrapper = command;
		if (!/[\\/]/.test(wrapper)) {
			try {
				wrapper = execFileSync('where.exe', [wrapper.endsWith('.cmd') ? wrapper : `${wrapper}.cmd`], { encoding: 'utf8', windowsHide: true })
					.split(/\r?\n/)
					.map(value => value.trim())
					.find(Boolean) || wrapper;
			} catch {
				// Let spawn report the normal command-not-found error below.
			}
		}
		if (/\.cmd$/i.test(wrapper)) {
			const entryPoint = join(dirname(wrapper), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
			if (existsSync(entryPoint)) {
				return { command: process.execPath, args: [entryPoint, 'app-server'], shell: false };
			}
		}
	}
	return { command, args: ['app-server'], shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command) };
}

try {
	const initialized = record(await request('initialize', {
		clientInfo: { name: 'vector-code-smoke', title: 'Vector Code Smoke', version: '1.0.0' },
		capabilities: { experimentalApi: true },
	}));
	notify('initialized');
	const [accountResponse, modelResponse, threadResponse, installedPluginResponse, pluginListResponse, pluginSearchResponse] = await Promise.all([
		request('account/read', {}),
		request('model/list', { limit: 100, includeHidden: false }),
		request('thread/list', { cwd: process.cwd(), limit: 1, archived: false }),
		request('plugin/installed', { cwds: [process.cwd()] }),
		request('plugin/list', { cwds: [process.cwd()], forceRefetch: false }),
		request('plugin/search', { searchTerm: 'github', cwds: [process.cwd()], limit: 5 }),
	]);
	const accountResult = record(accountResponse);
	const account = record(accountResult.account);
	const models = Array.isArray(record(modelResponse).data) ? record(modelResponse).data : [];
	const threads = Array.isArray(record(threadResponse).data) ? record(threadResponse).data : [];
	const pluginMarketplaces = Array.isArray(record(installedPluginResponse).marketplaces) ? record(installedPluginResponse).marketplaces : [];
	const availablePluginMarketplaces = Array.isArray(record(pluginListResponse).marketplaces) ? record(pluginListResponse).marketplaces : [];
	const pluginSearchResults = Array.isArray(record(pluginSearchResponse).data) ? record(pluginSearchResponse).data : [];
	const installedPluginCount = pluginMarketplaces.reduce((count, marketplace) => {
		const plugins = Array.isArray(record(marketplace).plugins) ? record(marketplace).plugins : [];
		return count + plugins.filter(plugin => record(plugin).installed === true).length;
	}, 0);
	const availablePluginCount = availablePluginMarketplaces.reduce((count, marketplace) => {
		const plugins = Array.isArray(record(marketplace).plugins) ? record(marketplace).plugins : [];
		return count + plugins.length;
	}, 0);
	if (!initialized.userAgent || !models.length || !Array.isArray(record(installedPluginResponse).marketplaceLoadErrors) || !Array.isArray(record(pluginListResponse).marketplaceLoadErrors) || !Array.isArray(record(pluginSearchResponse).data)) {
		throw new Error('Codex App Server returned an incomplete initialization, model, or plugin response.');
	}
	console.log(JSON.stringify({
		ok: true,
		userAgent: initialized.userAgent,
		platform: initialized.platformOs,
		accountType: account.type || null,
		requiresOpenaiAuth: accountResult.requiresOpenaiAuth === true,
		modelCount: models.length,
		threadCount: threads.length,
		installedPluginCount,
		availablePluginCount,
		pluginSearchResultCount: pluginSearchResults.length,
		concurrentCorrelatedRequestCount: 6,
	}, null, 2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	output.close();
	child.stdin.end();
	setTimeout(() => child.kill(), 250).unref();
}
