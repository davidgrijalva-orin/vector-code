/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EditorInputCapabilities } from '../../../../common/editor.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { VectorGraphTicketInput, VectorGraphTicketSerializer, renderVectorGraphMarkdown } from '../../browser/vectorGraphTicketEditor.js';

import { MarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';

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
		strictEqual(rendered.element.querySelector('img[src^="https:"]'), null);
		strictEqual(rendered.element.querySelector('a[data-href^="command:"]'), null);
	});

});
