/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IIterativePager } from '../../../../../base/common/paging.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { localize2 } from '../../../../../nls.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { GalleryMcpServerStatus, IGalleryMcpServer, IMcpGalleryService, TransportType } from '../../../../../platform/mcp/common/mcpManagement.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IViewContainerModel, IViewDescriptorService, ViewContainerLocation } from '../../../../common/views.js';
import { IJSONEditingService } from '../../../../services/configuration/common/jsonEditing.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IVectorCodeWorkbenchService } from '../../../vectorCode/common/vectorCode.js';
import { McpMarketplaceView, MCP_MARKETPLACE_VIEW_ID } from '../../browser/mcpMarketplace.contribution.js';

suite('MCP marketplace view', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const server: IGalleryMcpServer = { name: 'io.example/test', displayName: 'Example', description: '<script>display as text</script>', version: '1', isLatest: true, status: GalleryMcpServerStatus.Active, publisher: 'example', configuration: { remotes: [{ type: TransportType.STREAMABLE_HTTP, url: 'https://example.test/mcp' }] } };
	let root: HTMLElement;
	let active: URI;
	let dirty: boolean;
	let trusted: boolean;
	let text: string;
	let requests: DeferredPromise<IIterativePager<IGalleryMcpServer>>[];
	let confirmation: DeferredPromise<{ confirmed: boolean }>;
	let writes: number;
	let errors: string[];

	function button(label: string): HTMLButtonElement {
		const result = [...root.querySelectorAll('button')].find(button => button.textContent === label);
		if (!result) { throw new Error('Missing button ' + label); }
		return result;
	}
	async function results(index: number, items = [server]) {
		await requests[index].complete({ firstPage: { items, hasMore: false }, getNextPage: async () => ({ items: [], hasMore: false }) });
		await timeout(0);
	}

	setup(async () => {
		active = URI.file('/project'); dirty = false; trusted = true; text = '{}'; writes = 0; requests = []; errors = [];
		confirmation = new DeferredPromise();
		const instantiation = workbenchInstantiationService({}, store);
		instantiation.stub(IVectorCodeWorkbenchService, { onDidChangeActiveProject: store.add(new Emitter<URI | undefined>()).event, getActiveProjectUri: () => active });
		instantiation.stub(IMcpGalleryService, { query: () => { const request = new DeferredPromise<IIterativePager<IGalleryMcpServer>>(); requests.push(request); return request.p; } });
		instantiation.stub(IFileService, { exists: async () => true });
		instantiation.stub(ITextFileService, { isDirty: () => dirty, read: (async () => ({ value: text })) as unknown as ITextFileService['read'] });
		instantiation.stub(IJSONEditingService, { write: async () => { writes++; } });
		instantiation.stub(IEditorService, { openEditor: async () => undefined });
		instantiation.stub(INotificationService, { error: (message: string) => errors.push(message) });
		instantiation.stub(IDialogService, { confirm: () => confirmation.p });
		instantiation.stub(IQuickInputService, { pick: (async (items: unknown[]) => items[0]) as IQuickInputService['pick'] });
		instantiation.stub(IWorkspaceTrustManagementService, { isWorkspaceTrusted: () => trusted });
		const container = { id: 'workbench.view.extensions', title: localize2('extensionsTest', 'Extensions'), ctorDescriptor: new SyncDescriptor(McpMarketplaceView) };
		const descriptor = { id: MCP_MARKETPLACE_VIEW_ID, name: localize2('mcpTest', 'MCP Marketplace'), ctorDescriptor: new SyncDescriptor(McpMarketplaceView) };
		instantiation.stub(IViewDescriptorService, {
			getViewLocationById: () => ViewContainerLocation.Sidebar, onDidChangeLocation: Event.None,
			getViewDescriptorById: () => descriptor, getViewContainerByViewId: () => container,
			getViewContainerModel: () => ({ onDidChangeContainerInfo: Event.None } as IViewContainerModel), getDefaultContainerById: () => container
		});
		const view = store.add(instantiation.createInstance(McpMarketplaceView, { id: descriptor.id, title: 'MCP Marketplace' }));
		view.setVisible(true); view.render(); root = view.element; await timeout(0);
	});

	test('ignores old searches and renders publisher text without HTML', async () => {
		button('Search').click(); await timeout(0);
		await results(1); await results(0, [{ ...server, displayName: 'Old result' }]);
		strictEqual(root.textContent!.includes('Old result'), false);
		strictEqual(root.querySelectorAll('script').length, 0);
		strictEqual(root.textContent!.includes(server.description), true);
	});

	test('installs only after confirmation into the captured project', async () => {
		await results(0); button('Details & Install').click(); await timeout(0);
		strictEqual(writes, 0); await confirmation.complete({ confirmed: true }); await timeout(0);
		strictEqual(writes, 1); strictEqual(errors.length, 0);
	});

	test('does not install after a project switch while reviewing', async () => {
		await results(0); button('Details & Install').click(); await timeout(0);
		active = URI.file('/other'); await confirmation.complete({ confirmed: true }); await timeout(0);
		strictEqual(writes, 0); strictEqual(errors.length, 1);
	});

	test('does not overwrite edits made while reviewing an installation', async () => {
		await results(0); button('Details & Install').click(); await timeout(0);
		text = '{"servers":{"new":{}}}'; await confirmation.complete({ confirmed: true }); await timeout(0);
		strictEqual(writes, 0); strictEqual(errors.length, 1);
	});

	test('blocks installation in an untrusted workspace', async () => {
		await results(0); button('Details & Install').click(); await timeout(0);
		trusted = false; await confirmation.complete({ confirmed: true }); await timeout(0);
		strictEqual(writes, 0); strictEqual(errors.length, 1);
	});

	test('leaves dirty configuration untouched', async () => {
		await results(0); dirty = true; button('Details & Install').click(); await timeout(0);
		strictEqual(writes, 0); strictEqual(errors.length, 1);
	});
});
