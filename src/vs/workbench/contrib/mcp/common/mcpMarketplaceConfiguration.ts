/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse, ParseError } from '../../../../base/common/json.js';
import { McpConfigurationConverter } from '../../../../platform/mcp/common/mcpConfigurationConverter.js';
import { IGalleryMcpServer, RegistryType, TransportType } from '../../../../platform/mcp/common/mcpManagement.js';
import { IJSONValue } from '../../../services/configuration/common/jsonEditing.js';

export function readMcpConfiguration(text: string): { servers?: Record<string, unknown>; inputs?: unknown[] } {
	const errors: ParseError[] = [];
	const value = parse(text, errors, { allowTrailingComma: true });
	if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)
		|| (value.servers !== undefined && (!value.servers || typeof value.servers !== 'object' || Array.isArray(value.servers)))
		|| (value.inputs !== undefined && !Array.isArray(value.inputs))) {
		throw new Error('Fix the errors in .vscode/mcp.json before installing a server.');
	}
	return value;
}

export function mcpInstallOptions(server: IGalleryMcpServer): RegistryType[] {
	const options = new Set<RegistryType>();
	if (server.configuration.remotes?.some(remote => remote.type === TransportType.STREAMABLE_HTTP && /^https:\/\//i.test(remote.url))) {
		options.add(RegistryType.REMOTE);
	}
	for (const pkg of server.configuration.packages ?? []) {
		if (pkg.transport.type === TransportType.STDIO && [RegistryType.NODE, RegistryType.PYTHON, RegistryType.DOCKER, RegistryType.NUGET].includes(pkg.registryType)) {
			options.add(pkg.registryType);
		}
	}
	return [...options];
}

export function mcpInstallEdits(server: IGalleryMcpServer, type: RegistryType, text: string): IJSONValue[] {
	const existing = readMcpConfiguration(text);
	if (Object.hasOwn(existing.servers ?? {}, server.name)) {
		throw new Error('This server is already configured. Open its configuration to change it.');
	}
	if (!mcpInstallOptions(server).includes(type)) {
		throw new Error('This package or transport is not supported.');
	}
	const configuration = {
		packages: server.configuration.packages?.filter(pkg => pkg.transport.type === TransportType.STDIO),
		remotes: server.configuration.remotes?.filter(remote => remote.type === TransportType.STREAMABLE_HTTP && /^https:\/\//i.test(remote.url))
	};
	const { mcpServerConfiguration: converted, notices } = new McpConfigurationConverter().getMcpServerConfigurationFromManifest(configuration, type);
	if (notices.length) { throw new Error(notices.join('\n')); }
	// Namespace inputs so servers cannot accidentally share credentials or overwrite prompts.
	const prefix = encodeURIComponent(server.name) + ':';
	const seen = new Set<string>();
	const inputs = (converted.inputs ?? []).map(input => {
		const id = prefix + input.id;
		if (seen.has(id) || existing.inputs?.some(item => !!item && typeof item === 'object' && (item as { id?: unknown }).id === id)) {
			throw new Error('Conflicting MCP input IDs. Review the server manifest before configuring it.');
		}
		seen.add(id);
		return { ...input, id };
	});
	const config = JSON.parse(JSON.stringify(converted.config).replace(/\$\{input:([^}]+)\}/g, (_match, id: string) => '${input:' + prefix + id + '}'));
	const edits: IJSONValue[] = [{ path: ['servers', server.name], value: config }];
	if (inputs.length) { edits.push({ path: ['inputs'], value: [...(existing.inputs ?? []), ...inputs] }); }
	return edits;
}
