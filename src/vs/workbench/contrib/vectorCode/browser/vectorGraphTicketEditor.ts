/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { VectorGraphTicketDetails } from './vectorGraphTicketDetails.js';
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

export class VectorGraphTicketInput extends EditorInput {
	static readonly ID = 'workbench.input.vectorGraphTicket';
	constructor(readonly workspace: string, readonly identifier: string, readonly project = '') { super(); }
	override get typeId(): string { return VectorGraphTicketInput.ID; }
	override get resource(): URI { return URI.from({ scheme: 'vectorgraph-ticket', authority: this.workspace, path: '/' + this.identifier, query: this.project }); }
	override get capabilities(): EditorInputCapabilities { return super.capabilities | EditorInputCapabilities.Readonly; }
	override getName(): string { return localize('ticketTab', '{0} · Ticket', this.identifier); }
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof VectorGraphTicketInput && other.workspace === this.workspace && other.identifier === this.identifier && other.project === this.project;
	}
}

export class VectorGraphTicketSerializer implements IEditorSerializer {
	canSerialize(input: EditorInput): boolean { return input instanceof VectorGraphTicketInput; }
	serialize(input: EditorInput): string | undefined {
		return input instanceof VectorGraphTicketInput ? JSON.stringify({ workspace: input.workspace, identifier: input.identifier, ...(input.project ? { project: input.project } : {}) }) : undefined;
	}
	deserialize(_instantiation: IInstantiationService, value: string): EditorInput | undefined {
		try {
			const data = JSON.parse(value);
			if (typeof data.workspace === 'string' && /^[a-f0-9-]{36}$/i.test(data.workspace) && typeof data.identifier === 'string' && /^[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*$/.test(data.identifier)) {
				return new VectorGraphTicketInput(data.workspace, data.identifier, typeof data.project === 'string' ? data.project : '');
			}
		} catch { /* Ignore invalid restored editor state. */ }
		return undefined;
	}
}

export class VectorGraphTicketEditor extends EditorPane {
	static readonly ID = 'workbench.editor.vectorGraphTicket';
	private root!: HTMLElement;
	private details!: VectorGraphTicketDetails;
	constructor(group: IEditorGroup, @ITelemetryService telemetry: ITelemetryService, @IThemeService theme: IThemeService, @IStorageService storage: IStorageService, @IInstantiationService private readonly instantiation: IInstantiationService) {
		super(VectorGraphTicketEditor.ID, group, telemetry, theme, storage);
	}
	protected override createEditor(parent: HTMLElement): void {
		this.root = append(parent, $('.vector-graph-ticket-editor')); this.root.tabIndex = 0;
		this.root.setAttribute('aria-label', localize('ticketDetails', 'Ticket details'));
		this.details = this._register(this.instantiation.createInstance(VectorGraphTicketDetails, this.root));
	}
	override async setInput(input: VectorGraphTicketInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!token.isCancellationRequested && this.input === input && !this._store.isDisposed) { await this.details.show({ workspace: input.workspace, identifier: input.identifier, project: input.project }); }
	}
	override clearInput(): void { if (this.details) { void this.details.show(undefined); } super.clearInput(); }
	override layout(dimension: Dimension): void { this.root.style.width = dimension.width + 'px'; this.root.style.height = dimension.height + 'px'; }
	override focus(): void { this.root.focus(); }
}
export { renderVectorGraphMarkdown } from './vectorGraphMarkdown.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(VectorGraphTicketEditor, VectorGraphTicketEditor.ID, localize('ticketEditor', 'VectorGraph Ticket')),
	[new SyncDescriptor(VectorGraphTicketInput)]
);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(VectorGraphTicketInput.ID, VectorGraphTicketSerializer);
