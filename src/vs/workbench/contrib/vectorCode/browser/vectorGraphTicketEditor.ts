/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, Dimension, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext, IUntypedEditorInput, EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';

export class VectorGraphTicketInput extends EditorInput {
	static readonly ID = 'workbench.input.vectorGraphTicket';
	constructor(readonly workspace: string, readonly identifier: string) { super(); }
	override get typeId(): string { return VectorGraphTicketInput.ID; }
	override get resource(): URI { return URI.from({ scheme: 'vectorgraph-ticket', authority: this.workspace, path: '/' + this.identifier }); }
	override get capabilities(): EditorInputCapabilities { return super.capabilities | EditorInputCapabilities.Readonly; }
	override getName(): string { return localize('ticketTab', '{0} · Ticket', this.identifier); }
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof VectorGraphTicketInput && other.workspace === this.workspace && other.identifier === this.identifier;
	}
}

export class VectorGraphTicketSerializer implements IEditorSerializer {
	canSerialize(input: EditorInput): boolean { return input instanceof VectorGraphTicketInput; }
	serialize(input: EditorInput): string | undefined {
		return input instanceof VectorGraphTicketInput ? JSON.stringify({ workspace: input.workspace, identifier: input.identifier }) : undefined;
	}
	deserialize(_instantiation: IInstantiationService, value: string): EditorInput | undefined {
		try {
			const data = JSON.parse(value);
			if (typeof data.workspace === 'string' && /^[a-f0-9-]{36}$/i.test(data.workspace) && typeof data.identifier === 'string' && /^[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*$/.test(data.identifier)) {
				return new VectorGraphTicketInput(data.workspace, data.identifier);
			}
		} catch { /* Ignore invalid restored editor state. */ }
		return undefined;
	}
}

export class VectorGraphTicketEditor extends EditorPane {
	static readonly ID = 'workbench.editor.vectorGraphTicket';
	private root!: HTMLElement;
	private generation = 0;
	private readonly content = this._register(new DisposableStore());
	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetry: ITelemetryService,
		@IThemeService theme: IThemeService,
		@IStorageService storage: IStorageService,
		@IVectorGraphService private readonly graph: IVectorGraphService,
		@IMarkdownRendererService private readonly markdown: IMarkdownRendererService,
		@IOpenerService private readonly opener: IOpenerService,
	) { super(VectorGraphTicketEditor.ID, group, telemetry, theme, storage); }
	protected override createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.vector-graph-ticket-editor'));
		this.root.tabIndex = 0;
		this.root.setAttribute('aria-label', localize('ticketDetails', 'Ticket details'));
	}
	override async setInput(input: VectorGraphTicketInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested || this.input !== input || this._store.isDisposed) { return; }
		await this.load(input, token);
	}
	private async load(input: VectorGraphTicketInput, token: CancellationToken): Promise<void> {
		const generation = ++this.generation;
		this.content.clear();
		clearNode(this.root);
		const status = append(this.root, $('p'));
		status.setAttribute('role', 'status');
		status.textContent = localize('ticketLoading', 'Loading {0}…', input.identifier);
		try {
			const ticket = await this.graph.getTicket(input.workspace, input.identifier);
			if (generation !== this.generation || token.isCancellationRequested || this.input !== input || this._store.isDisposed) { return; }
			clearNode(this.root);
			const article = append(this.root, $('article.vector-graph-ticket-editor__article'));
			const toolbar = append(article, $('.vector-graph-ticket-editor__toolbar'));
			append(toolbar, $('span')).textContent = ticket.identifier;
			this.action(toolbar, localize('ticketRefresh', 'Refresh'), () => { void this.load(input, token); });
			append(article, $('h1')).textContent = ticket.title;
			const metadata = append(article, $('.vector-graph-ticket-editor__metadata'));
			for (const value of [ticket.status, ticket.priority, ticket.project].filter(Boolean)) { append(metadata, $('span')).textContent = value!; }
			append(article, $('h2')).textContent = localize('ticketDescription', 'Description');
			this.renderMarkdown(article, ticket.description || localize('ticketNoDescription', 'No description provided.'));
			append(article, $('h2')).textContent = localize('ticketActivity', 'Activity');
			if (!ticket.comments.length) { append(article, $('p')).textContent = localize('ticketNoActivity', 'No comments yet.'); }
			for (const comment of ticket.comments) {
				const section = append(article, $('section.vector-graph-ticket-editor__comment'));
				append(section, $('h3')).textContent = comment.author;
				this.renderMarkdown(section, comment.body);
			}
		} catch (error) {
			if (generation !== this.generation || token.isCancellationRequested || this.input !== input || this._store.isDisposed) { return; }
			status.textContent = toErrorMessage(error);
			this.action(this.root, localize('ticketRetry', 'Retry'), () => { void this.load(input, token); });
		}
	}
	private action(parent: HTMLElement, label: string, run: () => void): void {
		const button = append(parent, $<HTMLButtonElement>('button'));
		button.type = 'button'; button.textContent = label;
		this.content.add(addDisposableListener(button, EventType.CLICK, run));
	}
	private renderMarkdown(parent: HTMLElement, value: string): void {
		const rendered = this.content.add(renderVectorGraphMarkdown(this.markdown, this.opener, value));
		append(parent, rendered.element);
	}
	override clearInput(): void { this.generation++; this.content.clear(); if (this.root) { clearNode(this.root); } super.clearInput(); }
	override layout(dimension: Dimension): void { this.root.style.width = dimension.width + 'px'; this.root.style.height = dimension.height + 'px'; }
	override focus(): void { this.root.focus(); }
	override dispose(): void { this.generation++; super.dispose(); }
}

export function renderVectorGraphMarkdown(markdown: IMarkdownRendererService, opener: IOpenerService, value: string) {
	return markdown.render(new MarkdownString(value, { isTrusted: false, supportHtml: false }), {
		// Replace image tokens before HTML creation: removing DOM images later can already start a request.
		markedExtensions: [{
			walkTokens: token => {
				if (token.type === 'image') { Object.assign(token, { type: 'text', text: localize('ticketImageOmitted', '[Image omitted]'), tokens: undefined }); }
			}
		}],
		sanitizerConfig: { remoteImageIsAllowed: () => false },
		actionHandler: link => {
			if (/^https?:\/\//i.test(link)) { return opener.open(link, { allowCommands: false, allowContributedOpeners: false, fromUserGesture: true }); }
			return Promise.resolve(false);
		}
	});
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(VectorGraphTicketEditor, VectorGraphTicketEditor.ID, localize('ticketEditor', 'VectorGraph Ticket')),
	[new SyncDescriptor(VectorGraphTicketInput)]
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(VectorGraphTicketInput.ID, VectorGraphTicketSerializer);
