/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface IVectorUpdateAsset {
	readonly url: string;
	readonly sha256hash?: string;
	readonly size?: number;
}

export interface IVectorUpdateRelease {
	readonly version: string;
	readonly commit: string;
	readonly quality: string;
	readonly timestamp: number;
	readonly assets: Record<string, IVectorUpdateAsset>;
}

export interface IVectorUpdateFeed {
	readonly schemaVersion: 1;
	readonly releases: readonly IVectorUpdateRelease[];
}

export interface IVectorUpdateRequest {
	readonly platform: string;
	readonly quality: string;
	readonly commit: string;
}

export interface IVectorUpdateResponseBody {
	readonly version: string;
	readonly productVersion: string;
	readonly timestamp: number;
	readonly url: string;
	readonly sha256hash?: string;
}

export type VectorUpdateResponse =
	| { readonly statusCode: 200; readonly body: IVectorUpdateResponseBody }
	| { readonly statusCode: 204 };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Invalid update feed: ${name} must be a non-empty string`);
	}

	return value;
}

function assertNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`Invalid update feed: ${name} must be a finite number`);
	}

	return value;
}

function parseAsset(value: unknown, name: string): IVectorUpdateAsset {
	if (!isRecord(value)) {
		throw new Error(`Invalid update feed: ${name} must be an object`);
	}

	const asset: IVectorUpdateAsset = {
		url: assertString(value.url, `${name}.url`)
	};

	if (typeof value.sha256hash !== 'undefined') {
		return {
			...asset,
			sha256hash: assertString(value.sha256hash, `${name}.sha256hash`),
			...(typeof value.size === 'undefined' ? {} : { size: assertNumber(value.size, `${name}.size`) })
		};
	}

	return {
		...asset,
		...(typeof value.size === 'undefined' ? {} : { size: assertNumber(value.size, `${name}.size`) })
	};
}

function parseRelease(value: unknown, index: number): IVectorUpdateRelease {
	if (!isRecord(value)) {
		throw new Error(`Invalid update feed: releases[${index}] must be an object`);
	}

	const assetsValue = value.assets;
	if (!isRecord(assetsValue)) {
		throw new Error(`Invalid update feed: releases[${index}].assets must be an object`);
	}

	const assets: Record<string, IVectorUpdateAsset> = {};
	for (const [platform, assetValue] of Object.entries(assetsValue)) {
		assets[assertString(platform, `releases[${index}].assets key`)] = parseAsset(assetValue, `releases[${index}].assets.${platform}`);
	}

	if (Object.keys(assets).length === 0) {
		throw new Error(`Invalid update feed: releases[${index}].assets must contain at least one platform`);
	}

	return {
		version: assertString(value.version, `releases[${index}].version`),
		commit: assertString(value.commit, `releases[${index}].commit`),
		quality: assertString(value.quality, `releases[${index}].quality`),
		timestamp: assertNumber(value.timestamp, `releases[${index}].timestamp`),
		assets
	};
}

export function parseVectorUpdateFeed(value: unknown): IVectorUpdateFeed {
	if (!isRecord(value)) {
		throw new Error('Invalid update feed: root must be an object');
	}

	if (value.schemaVersion !== 1) {
		throw new Error('Invalid update feed: schemaVersion must be 1');
	}

	if (!Array.isArray(value.releases)) {
		throw new Error('Invalid update feed: releases must be an array');
	}

	return {
		schemaVersion: 1,
		releases: value.releases.map((release, index) => parseRelease(release, index))
	};
}

function getReleaseAsset(release: IVectorUpdateRelease, platform: string): IVectorUpdateAsset | undefined {
	return release.assets[platform]
		?? (platform === 'darwin' || platform === 'darwin-arm64' ? release.assets['darwin-universal'] : undefined);
}

function selectLatestRelease(feed: IVectorUpdateFeed, platform: string, quality: string): IVectorUpdateRelease | undefined {
	return feed.releases
		.filter(release => release.quality === quality && getReleaseAsset(release, platform))
		.sort((a, b) => b.timestamp - a.timestamp || b.version.localeCompare(a.version))[0];
}

export function resolveVectorUpdate(feed: IVectorUpdateFeed, request: IVectorUpdateRequest): VectorUpdateResponse {
	const latest = selectLatestRelease(feed, request.platform, request.quality);
	if (!latest || latest.commit === request.commit || latest.version === request.commit) {
		return { statusCode: 204 };
	}

	const asset = getReleaseAsset(latest, request.platform);
	if (!asset) {
		return { statusCode: 204 };
	}

	return {
		statusCode: 200,
		body: {
			version: latest.commit,
			productVersion: latest.version,
			timestamp: latest.timestamp,
			url: asset.url,
			...(asset.sha256hash ? { sha256hash: asset.sha256hash } : {})
		}
	};
}

function parseArgs(argv: readonly string[]): Record<string, string | true> {
	const result: Record<string, string | true> = {};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) {
			throw new Error(`Unexpected argument: ${arg}`);
		}

		const name = arg.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith('--')) {
			result[name] = true;
		} else {
			result[name] = next;
			i++;
		}
	}

	return result;
}

function readRequiredArg(args: Record<string, string | true>, name: string): string {
	const value = args[name];
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Missing required argument --${name}`);
	}

	return value;
}

function printUsage(): void {
	console.log([
		'Usage: node build/lib/vectorUpdateFeed.ts --manifest <path> --platform <platform> --quality <quality> --commit <commit>',
		'',
		'Prints the JSON body expected by /api/update/:platform/:quality/:commit, or "204" when no update is available.'
	].join('\n'));
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printUsage();
		return;
	}

	const manifestPath = path.resolve(readRequiredArg(args, 'manifest'));
	const platform = readRequiredArg(args, 'platform');
	const quality = readRequiredArg(args, 'quality');
	const commit = readRequiredArg(args, 'commit');
	const feed = parseVectorUpdateFeed(JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')));
	const result = resolveVectorUpdate(feed, { platform, quality, commit });

	if (result.statusCode === 204) {
		console.log('204');
	} else {
		console.log(JSON.stringify(result.body, null, '\t'));
	}
}

const currentModulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentModulePath) {
	main().catch(error => {
		console.error(error);
		process.exit(1);
	});
}
