/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual, throws } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { GalleryMcpServerStatus, IGalleryMcpServer, RegistryType, TransportType } from '../../../../../platform/mcp/common/mcpManagement.js';
import { mcpInstallEdits, mcpInstallOptions, readMcpConfiguration } from '../../common/mcpMarketplaceConfiguration.js';

suite('MCP marketplace configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const server: IGalleryMcpServer = {
		name: 'io.example/test', displayName: 'Test', description: 'Test server', version: '1.2.3', isLatest: true,
		status: GalleryMcpServerStatus.Active, publisher: 'example',
		configuration: { packages: [{ registryType: RegistryType.NODE, identifier: '@example/test', version: '1.2.3', transport: { type: TransportType.STDIO } }] }
	};

	test('preserves JSONC and unrelated configuration with targeted edits', () => {
		const text = '{ // keep comment\n "servers": {"existing": {"command":"test"}}, "inputs": [], "custom": true, }';
		const edits = mcpInstallEdits(server, RegistryType.NODE, text);
		deepStrictEqual(edits, [{ path: ['servers', 'io.example/test'], value: { type: 'stdio', command: 'npx', args: ['@example/test@1.2.3'] } }]);
		strictEqual(Object.keys(readMcpConfiguration(text).servers!).length, 1);
	});

	test('never overwrites an existing server or malformed configuration', () => {
		throws(() => mcpInstallEdits(server, RegistryType.NODE, '{"servers":{"io.example/test":{}}}'), /already configured/);
		for (const text of ['[]', 'null', '{', '{"servers":[]}', '{"inputs":{}}', '{"servers":null}']) {
			throws(() => readMcpConfiguration(text), /Fix the errors/);
		}
	});

	test('namespaces secret prompts and keeps existing inputs', () => {
		const withSecret: IGalleryMcpServer = { ...server, configuration: { remotes: [{ type: TransportType.STREAMABLE_HTTP, url: 'https://example.test/mcp', headers: [{ name: 'Authorization', value: 'Bearer {token}', variables: { token: { isSecret: true, description: 'API token' } } }] }] } };
		const edits = mcpInstallEdits(withSecret, RegistryType.REMOTE, '{"inputs":[{"id":"other","type":"promptString"}]}');
		deepStrictEqual(edits[0].value, { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${input:io.example%2Ftest:token}' } });
		const inputs = edits[1].value as { id: string; password?: boolean }[];
		strictEqual(inputs[0].id, 'other'); strictEqual(inputs[1].password, true);
		strictEqual(inputs[1].id, 'io.example%2Ftest:token');
		throws(() => mcpInstallEdits(withSecret, RegistryType.REMOTE, '{"inputs":[{"id":"io.example%2Ftest:token"}]}'), /Conflicting/);
	});

	test('required secret fields become prompts even without descriptions', () => {
		const withSecret: IGalleryMcpServer = { ...server, configuration: { remotes: [{ type: TransportType.STREAMABLE_HTTP, url: 'https://example.test/mcp', headers: [{ name: 'X-Key', isRequired: true, isSecret: true }] }] } };
		const edits = mcpInstallEdits(withSecret, RegistryType.REMOTE, '{}');
		strictEqual((edits[1].value as { password: boolean }[])[0].password, true);
	});

	test('only offers supported transports and package managers', () => {
		const unsupported: IGalleryMcpServer = { ...server, configuration: { remotes: [{ type: TransportType.SSE, url: 'https://example.test/sse' }, { type: TransportType.STREAMABLE_HTTP, url: 'http://example.test/mcp' }], packages: [{ registryType: RegistryType.NODE, identifier: 'test', transport: { type: TransportType.STREAMABLE_HTTP, url: 'https://example.test/mcp' } }] } };
		deepStrictEqual(mcpInstallOptions(unsupported), []);
		throws(() => mcpInstallEdits(unsupported, RegistryType.REMOTE, '{}'), /not supported/);
	});

	test('chooses a supported remote rather than a preceding SSE entry', () => {
		const mixed: IGalleryMcpServer = { ...server, configuration: { remotes: [{ type: TransportType.SSE, url: 'https://example.test/sse' }, { type: TransportType.STREAMABLE_HTTP, url: 'https://example.test/mcp' }] } };
		deepStrictEqual(mcpInstallEdits(mixed, RegistryType.REMOTE, '{}')[0].value, { type: 'http', url: 'https://example.test/mcp' });
	});

	test('keeps package execution as argv, not a shell command', () => {
		const configured: IGalleryMcpServer = { ...server, configuration: { packages: [{ ...server.configuration.packages![0], packageArguments: [{ type: 'positional', value: 'folder with spaces; $(command)' }] }] } };
		deepStrictEqual(mcpInstallEdits(configured, RegistryType.NODE, '{}')[0].value, { type: 'stdio', command: 'npx', args: ['@example/test@1.2.3', 'folder with spaces; $(command)'] });
	});
});
