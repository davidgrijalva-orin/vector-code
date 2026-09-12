/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, addDisposableListener, EventType, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { vectorGraphDocumentResource } from './vectorGraphDocumentFileSystem.js';
import { IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { renderVectorGraphMarkdown } from './vectorGraphMarkdown.js';
import { renderVectorGraphCanvas } from './vectorGraphCanvas.js';
import { hasKey } from '../../../../base/common/types.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext, IUntypedEditorInput, EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

export class VectorGraphArtifactInput extends EditorInput {
	static readonly ID = 'workbench.input.vectorGraphArtifact';
	constructor(readonly workspace: string, readonly identifier: string, readonly title: string, readonly kind: 'document' | 'canvas' = 'document') { super(); }
	override get typeId(): string { return VectorGraphArtifactInput.ID; }
	override get resource(): URI { return URI.from({ scheme: 'vectorgraph-artifact', authority: this.workspace, path: '/' + this.identifier, query: this.kind }); }
	override get capabilities(): EditorInputCapabilities { return super.capabilities | EditorInputCapabilities.Readonly; }
	override getName(): string { return this.title; }
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof VectorGraphArtifactInput && other.workspace === this.workspace && other.identifier === this.identifier && other.kind === this.kind;
	}
}

export class VectorGraphArtifactSerializer implements IEditorSerializer {
	canSerialize(input: EditorInput): boolean { return input instanceof VectorGraphArtifactInput; }
	serialize(input: EditorInput): string | undefined {
		return input instanceof VectorGraphArtifactInput ? JSON.stringify({ workspace: input.workspace, identifier: input.identifier, title: input.title, kind: input.kind }) : undefined;
	}
	deserialize(_instantiation: IInstantiationService, value: string): EditorInput | undefined {
		try {
			const data = JSON.parse(value);
			if (typeof data.workspace === 'string' && /^[a-f0-9-]{36}$/i.test(data.workspace) && typeof data.identifier === 'string' && /^[a-f0-9-]{36}$/i.test(data.identifier) && typeof data.title === 'string' && ['document', 'canvas'].includes(data.kind)) {
				return new VectorGraphArtifactInput(data.workspace, data.identifier, data.title, data.kind);
			}
		} catch { /* Ignore invalid restored editor state. */ }
		return undefined;
	}
}

export class VectorGraphArtifactEditor extends EditorPane {
	static readonly ID = 'workbench.editor.vectorGraphArtifact';
	private root!: HTMLElement;
	private readonly content = this._register(new DisposableStore());
	private generation = 0;
	constructor(group: IEditorGroup, @ITelemetryService telemetry: ITelemetryService, @IThemeService theme: IThemeService, @IStorageService storage: IStorageService, @IEditorService private readonly editors: IEditorService, @IVectorGraphService private readonly graph: IVectorGraphService, @IMarkdownRendererService private readonly markdown: IMarkdownRendererService, @IOpenerService private readonly opener: IOpenerService) {
		super(VectorGraphArtifactEditor.ID, group, telemetry, theme, storage);
	}
	protected override createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.vector-graph-artifact-editor')); this.root.tabIndex = 0;
		this.root.setAttribute('aria-label', localize('artifactPreview', 'Document or canvas preview'));

	}
	override async setInput(input: VectorGraphArtifactInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		const generation = ++this.generation; this.content.clear(); clearNode(this.root);
		const actions = append(this.root, $('.vector-graph-ticket-editor__toolbar'));
		if (input.kind === 'document') {
			const edit = append(actions, $<HTMLButtonElement>('button', { type: 'button' })); edit.textContent = localize('artifactEditSource', 'Edit source');
			this.content.add(addDisposableListener(edit, EventType.CLICK, () => { void this.editors.openEditor({ resource: vectorGraphDocumentResource(input.workspace, input.identifier), label: input.title, options: { pinned: true } }); }));
		}
		const heading = append(this.root, $('h1')); heading.textContent = input.title;
		const status = append(this.root, $('p')); status.textContent = localize('artifactLoading', 'Loading…');
		try {
			const value = input.kind === 'canvas' ? await this.graph.getCanvas(input.workspace, input.identifier) : await this.graph.getDocument(input.workspace, input.identifier);
			if (token.isCancellationRequested || generation !== this.generation || this.input !== input || this._store.isDisposed) { return; }
			heading.textContent = value.title; status.remove();
			if (hasKey(value, { scene: true })) { renderVectorGraphCanvas(this.root, value); }
			else { const rendered = this.content.add(renderVectorGraphMarkdown(this.markdown, this.opener, value.body)); this.root.appendChild(rendered.element); }
		} catch (error) { if (generation === this.generation && !this._store.isDisposed) { status.textContent = toErrorMessage(error); } }
	}
	override clearInput(): void { this.generation++; this.content.clear(); if (this.root) { clearNode(this.root); } super.clearInput(); }

	override layout(dimension: Dimension): void { this.root.style.width = dimension.width + 'px'; this.root.style.height = dimension.height + 'px'; }
	override focus(): void { this.root.focus(); }
}


Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(VectorGraphArtifactEditor, VectorGraphArtifactEditor.ID, localize('artifactEditor', 'VectorGraph Preview')),
	[new SyncDescriptor(VectorGraphArtifactInput)]
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(VectorGraphArtifactInput.ID, VectorGraphArtifactSerializer);
