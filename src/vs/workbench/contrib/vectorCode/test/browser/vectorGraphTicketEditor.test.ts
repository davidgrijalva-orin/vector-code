/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EditorInputCapabilities } from '../../../../common/editor.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { VectorGraphTicketEditor, VectorGraphTicketInput, VectorGraphTicketSerializer, renderVectorGraphMarkdown } from '../../browser/vectorGraphTicketEditor.js';

import { MarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IVectorGraphService } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { TestThemeService } from '../../../../../platform/theme/test/common/testThemeService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { TestEditorGroupView } from '../../../../test/browser/workbenchTestServices.js';

suite('VectorGraph ticket editor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const workspace = 'bf275fab-fe03-44c3-b993-ced522c45a07';
	test('reuses a ticket tab only within the same workspace and stays read-only', () => {
		const input = store.add(new VectorGraphTicketInput(workspace, 'VC-52'));
		strictEqual(input.matches(store.add(new VectorGraphTicketInput(workspace, 'VC-52'))), true);
		strictEqual(input.matches(store.add(new VectorGraphTicketInput('658d2b51-5118-46d4-8b60-bf1954501284', 'VC-52'))), false);
		strictEqual(input.matches(store.add(new VectorGraphTicketInput(workspace, 'VC-20'))), false);
		strictEqual(Boolean(input.capabilities & EditorInputCapabilities.Readonly), true);
		strictEqual(input.isDirty(), false);
	});
	test('restores identity without persisting ticket bodies or authentication state', () => {
		const serializer = new VectorGraphTicketSerializer();
		const input = store.add(new VectorGraphTicketInput(workspace, 'VC-52'));
		const state = serializer.serialize(input)!;
		strictEqual(state, JSON.stringify({ workspace, identifier: 'VC-52' }));
		const restored = store.add(serializer.deserialize({} as IInstantiationService, state)!);
		strictEqual(restored.matches(input), true);
		for (const value of ['null', '{', '{}', JSON.stringify({ workspace, identifier: '../secret' })]) {
			strictEqual(serializer.deserialize({} as IInstantiationService, value), undefined);
		}
	});
	test('renders formatted descriptions without executable HTML or remote images', () => {
		const opener = { open: async () => true } as unknown as IOpenerService;
		const rendered = store.add(renderVectorGraphMarkdown(new MarkdownRendererService(opener), opener,
			'## Acceptance criteria\n\n**Keep project flow**\n\n<script>alert(1)</script>\n\n![tracking](https://example.invalid/tracker.png)\n\n[Run](command:workbench.action.closeWindow)'));
		strictEqual(rendered.element.querySelector('h2')?.textContent, 'Acceptance criteria');
		strictEqual(rendered.element.querySelector('strong')?.textContent, 'Keep project flow');
		strictEqual(rendered.element.querySelector('script'), null);
		strictEqual(rendered.element.querySelector('img'), null);
		strictEqual(rendered.element.querySelector('a[data-href^="command:"]'), null);
	});
	test('refresh remains active after the setInput token is cancelled', async () => {
		let request = 0;
		const graph = {
			getTicket: async () => ({
				identifier: 'VC-52', title: `Ticket request ${++request}`, status: 'In Progress', category: 'started', priority: 'high', project: '', description: '', comments: []
			})
		} as unknown as IVectorGraphService;
		const opener = { open: async () => true } as unknown as IOpenerService;
		const editor = store.add(new VectorGraphTicketEditor(
			new TestEditorGroupView(1), NullTelemetryService, new TestThemeService(), store.add(new TestStorageService()),
			graph, new MarkdownRendererService(opener), opener));
		const container = document.createElement('div');
		editor.create(container);
		const input = store.add(new VectorGraphTicketInput(workspace, 'VC-52'));
		const setInputCancellation = store.add(new CancellationTokenSource());
		await editor.setInput(input, undefined, Object.create(null), setInputCancellation.token);
		strictEqual(container.querySelector('h1')?.textContent, 'Ticket request 1');

		setInputCancellation.cancel();
		container.querySelector<HTMLButtonElement>('button')!.click();
		await Promise.resolve();
		strictEqual(request, 2);
		strictEqual(container.querySelector('h1')?.textContent, 'Ticket request 2');
	});

});
