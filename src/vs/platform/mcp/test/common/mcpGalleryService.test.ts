/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IFileService } from '../../../files/common/files.js';
import { NullLogService } from '../../../log/common/log.js';
import { IRequestService } from '../../../request/common/request.js';
import { IMcpGalleryManifestService, McpGalleryManifestStatus, McpGalleryResourceType } from '../../common/mcpGalleryManifest.js';
import { McpGalleryService } from '../../common/mcpGalleryService.js';

suite('MCP registry gallery', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const server = { server: { name: 'io.example/test', description: 'Example MCP server', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://example.test/mcp' }] }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } } };
	const manifest: IMcpGalleryManifestService = {
		_serviceBrand: undefined, onDidChangeMcpGalleryManifest: Event.None, onDidChangeMcpGalleryManifestStatus: Event.None,
		mcpGalleryManifestStatus: McpGalleryManifestStatus.Available,
		getMcpGalleryManifest: async () => ({ url: 'https://registry.modelcontextprotocol.io', version: 'v0.1', resources: [{ id: 'https://registry.modelcontextprotocol.io/v0.1/servers', type: McpGalleryResourceType.McpServersQueryService }] })
	};
	function gallery(request: IRequestService['request']): McpGalleryService {
		return store.add(new McpGalleryService({ request } as IRequestService, {} as IFileService, store.add(new NullLogService()), manifest));
	}
	function response(value: unknown, statusCode = 200) { return { res: { statusCode, headers: {} }, stream: bufferToStream(VSBuffer.fromString(JSON.stringify(value))) }; }

	test('reads official registry envelopes and retains encoded search and cursor on later pages', async () => {
		const urls: string[] = [];
		const service = gallery(async options => { urls.push(options.url!); return response({ servers: [server], metadata: { count: 1, nextCursor: urls.length === 1 ? 'cursor&+?' : undefined } }); });
		const pager = await service.query({ text: 'example & tools' });
		strictEqual(pager.firstPage.items[0].name, 'io.example/test');
		strictEqual(pager.firstPage.hasMore, true);
		const page = await pager.getNextPage(CancellationToken.None);
		strictEqual(page.hasMore, false);
		strictEqual(new URL(urls[1]).searchParams.get('search'), 'example & tools');
		strictEqual(new URL(urls[1]).searchParams.get('cursor'), 'cursor&+?');
	});

	test('does not turn network failures or invalid responses into empty results', async () => {
		await rejects(gallery(async () => { throw new Error('offline'); }).query(), /offline/);
		await rejects(gallery(async () => response({}, 503)).query(), /503/);
		await rejects(gallery(async () => response({ wrong: [] })).query(), /serialize/);
	});

	test('a valid empty page remains empty', async () => {
		const pager = await gallery(async () => response({ servers: [], metadata: { count: 0 } })).query();
		deepStrictEqual(pager.firstPage, { items: [], hasMore: false });
	});
});
