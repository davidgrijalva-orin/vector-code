/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { sign, type SignOptions } from '@electron/osx-sign';
import { spawn } from '@malept/cross-spawn-promise';

const root = path.dirname(path.dirname(import.meta.dirname));
const baseDir = path.dirname(import.meta.dirname);
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));

function getElectronVersion(): string {
	const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
	const target = /^target="(.*)"$/m.exec(npmrc)![1];
	return target;
}

function getEntitlementsForFile(filePath: string): string {
	if (filePath.includes(' Helper (GPU).app')) {
		return path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-gpu-entitlements.plist');
	} else if (filePath.includes(' Helper (Renderer).app')) {
		return path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-renderer-entitlements.plist');
	} else if (filePath.includes(' Helper (Plugin).app')) {
		return path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-plugin-entitlements.plist');
	} else if (filePath.includes(' Helper.app')) {
		return path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-entitlements.plist');
	}
	return path.join(baseDir, 'azure-pipelines', 'darwin', 'app-entitlements.plist');
}

function isMachO(filePath: string): boolean {
	const buffer = Buffer.alloc(4);
	let file: number | undefined;

	try {
		file = fs.openSync(filePath, 'r');
		if (fs.readSync(file, buffer, 0, buffer.length, 0) !== buffer.length) {
			return false;
		}
	} catch {
		return false;
	} finally {
		if (file !== undefined) {
			fs.closeSync(file);
		}
	}

	const magic = buffer.readUInt32BE(0);
	return magic === 0xfeedface
		|| magic === 0xcefaedfe
		|| magic === 0xfeedfacf
		|| magic === 0xcffaedfe
		|| magic === 0xcafebabe
		|| magic === 0xbebafeca
		|| magic === 0xcafebabf
		|| magic === 0xbfbafeca;
}

function collectMachOBinaries(rootPath: string): string[] {
	if (!fs.existsSync(rootPath)) {
		return [];
	}

	const binaries: string[] = [];
	for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
		const entryPath = path.join(rootPath, entry.name);
		if (entry.isDirectory()) {
			binaries.push(...collectMachOBinaries(entryPath));
		} else if (entry.isFile() && isMachO(entryPath)) {
			binaries.push(entryPath);
		}
	}
	return binaries;
}

function getAdditionalMachOBinaries(appPath: string): string[] {
	const roots = [
		path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Libraries'),
		path.join(appPath, 'Contents', 'Resources', 'app', 'node_modules'),
		path.join(appPath, 'Contents', 'Resources', 'app', 'extensions'),
	];

	return [...new Set(roots.flatMap(collectMachOBinaries))];
}

function runCodesign(args: string[]): string {
	const result = spawnSync('codesign', args, { encoding: 'utf8' });
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

	if (result.status !== 0) {
		throw new Error(`codesign ${args.join(' ')} failed:\n${output}`);
	}

	return output;
}

function getTeamIdentifier(filePath: string): string {
	const details = runCodesign(['-dvvv', filePath]);
	const match = /^TeamIdentifier=(.+)$/m.exec(details);
	if (!match) {
		throw new Error(`Missing TeamIdentifier in code signature: ${filePath}`);
	}
	return match[1];
}

function assertTeamIdentifier(filePath: string, expectedTeamIdentifier: string): void {
	const teamIdentifier = getTeamIdentifier(filePath);
	if (teamIdentifier !== expectedTeamIdentifier) {
		throw new Error(`Unexpected TeamIdentifier for ${filePath}: expected ${expectedTeamIdentifier}, got ${teamIdentifier}`);
	}
}

function assertEntitlements(filePath: string, requiredEntitlements: string[]): void {
	const entitlements = runCodesign(['-d', '--xml', '--entitlements', '-', filePath]);
	for (const entitlement of requiredEntitlements) {
		if (!entitlements.includes(`<key>${entitlement}</key>`)) {
			throw new Error(`Missing entitlement ${entitlement}: ${filePath}`);
		}
	}
}

function validateSignedApp(appPath: string, additionalBinaries: string[]): void {
	const teamIdentifier = getTeamIdentifier(appPath);
	const helperBaseName = `${product.nameShort} Helper`;
	const helperEntitlements = new Map<string, string[]>([
		[`${helperBaseName}.app`, ['com.apple.security.cs.allow-jit']],
		[`${helperBaseName} (Renderer).app`, ['com.apple.security.cs.allow-jit']],
		[`${helperBaseName} (GPU).app`, ['com.apple.security.cs.allow-jit']],
		[`${helperBaseName} (Plugin).app`, [
			'com.apple.security.cs.allow-jit',
			'com.apple.security.cs.allow-unsigned-executable-memory',
			'com.apple.security.cs.disable-library-validation'
		]],
	]);

	for (const [helperName, entitlements] of helperEntitlements) {
		const helperPath = path.join(appPath, 'Contents', 'Frameworks', helperName);
		assertEntitlements(helperPath, entitlements);
		assertTeamIdentifier(helperPath, teamIdentifier);
	}

	for (const binary of additionalBinaries) {
		assertTeamIdentifier(binary, teamIdentifier);
	}
}

async function retrySignOnKeychainError<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;

			// Check if this is the specific keychain error we want to retry
			const errorMessage = error instanceof Error ? error.message : String(error);
			const isKeychainError = errorMessage.includes('The specified item could not be found in the keychain.');

			if (!isKeychainError || attempt === maxRetries) {
				throw error;
			}

			console.log(`Signing attempt ${attempt} failed with keychain error, retrying...`);
			console.log(`Error: ${errorMessage}`);

			const delay = 1000 * Math.pow(2, attempt - 1);
			console.log(`Waiting ${Math.round(delay)}ms before retry ${attempt}/${maxRetries}...`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

async function main(buildDir?: string): Promise<void> {
	const tempDir = process.env['AGENT_TEMPDIRECTORY'];
	const arch = process.env['VSCODE_ARCH'];
	const identity = process.env['CODESIGN_IDENTITY'];

	if (!buildDir) {
		throw new Error('$AGENT_BUILDDIRECTORY not set');
	}

	if (!tempDir) {
		throw new Error('$AGENT_TEMPDIRECTORY not set');
	}

	const appRoot = path.join(buildDir, `VSCode-darwin-${arch}`);
	const appName = product.nameLong + '.app';
	const appPath = path.join(appRoot, appName);
	const infoPlistPath = path.resolve(appRoot, appName, 'Contents', 'Info.plist');

	const appOpts: SignOptions = {
		app: appPath,
		platform: 'darwin',
		binaries: getAdditionalMachOBinaries(appPath),
		optionsForFile: (filePath) => ({
			entitlements: getEntitlementsForFile(filePath),
			hardenedRuntime: true,
		}),
		preAutoEntitlements: false,
		preEmbedProvisioningProfile: false,
		keychain: path.join(tempDir, 'buildagent.keychain'),
		version: getElectronVersion(),
		identity,
	};

	// Only overwrite plist entries for x64 and arm64 builds,
	// universal will get its copy from the x64 build.
	if (arch !== 'universal') {
		await spawn('plutil', [
			'-insert',
			'NSAppleEventsUsageDescription',
			'-string',
			'An application in Visual Studio Code wants to use AppleScript.',
			`${infoPlistPath}`
		]);
		await spawn('plutil', [
			'-replace',
			'NSMicrophoneUsageDescription',
			'-string',
			'An application in Visual Studio Code wants to use the Microphone.',
			`${infoPlistPath}`
		]);
		await spawn('plutil', [
			'-replace',
			'NSCameraUsageDescription',
			'-string',
			'An application in Visual Studio Code wants to use the Camera.',
			`${infoPlistPath}`
		]);
		await spawn('plutil', [
			'-replace',
			'NSAudioCaptureUsageDescription',
			'-string',
			'An application in Visual Studio Code wants to use Audio Capture.',
			`${infoPlistPath}`
		]);
		await spawn('plutil', [
			'-insert',
			'NSLocalNetworkUsageDescription',
			'-string',
			'The app uses your local network for DNS resolution and to connect to locally running services.',
			`${infoPlistPath}`
		]);
	}

	await retrySignOnKeychainError(() => sign(appOpts));
	validateSignedApp(appPath, appOpts.binaries ?? []);
}

if (import.meta.main) {
	main(process.argv[2]).catch(async err => {
		console.error(err);
		const tempDir = process.env['AGENT_TEMPDIRECTORY'];
		if (tempDir) {
			const keychain = path.join(tempDir, 'buildagent.keychain');
			const identities = await spawn('security', ['find-identity', '-p', 'codesigning', '-v', keychain]);
			console.error(`Available identities:\n${identities}`);
			const dump = await spawn('security', ['dump-keychain', keychain]);
			console.error(`Keychain dump:\n${dump}`);
		}
		process.exit(1);
	});
}
