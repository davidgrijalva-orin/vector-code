/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProviderId } from '../../../../../../editor/common/languages.js';
import { EditDeltaInfo, EditSuggestionId } from '../../../../../../editor/common/textModelEditSource.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';

export const IAiEditTelemetryService = createDecorator<IAiEditTelemetryService>('aiEditTelemetryService');

export interface IAiEditTelemetryService {
	readonly _serviceBrand: undefined;

	createSuggestionId(data: Omit<IEditTelemetryCodeSuggestedData, 'suggestionId'>): EditSuggestionId;

	handleCodeAccepted(data: IEditTelemetryCodeAcceptedData): void;

	handleCodeRejected(data: IEditTelemetryCodeRejectedData): void;
}

export interface IEditTelemetryBaseData {
	suggestionId: EditSuggestionId | undefined;

	feature:
	/** Inline code completion suggestions */
	| 'inlineSuggestion'
	| undefined;

	presentation:
	/** Code displayed in a suggested edit block. */
	| 'codeBlock'
	/** Code already applied to the editor and highlighted with diff-style formatting. */
	| 'highlightedEdit'
	/** Code suggested inline as completion text. Only possible when feature is `inlineSuggestion`. */
	| 'inlineCompletion'
	/** Code shown as next edit suggestion. Only possible when feature is `nextEditSuggestion`. */
	| 'nextEditSuggestion';

	source: ProviderId | undefined;

	languageId: string | undefined;

	editDeltaInfo: EditDeltaInfo | undefined;

	modeId:
	/** User asking questions without requesting code changes */
	| 'ask'
	/** User requesting direct code edits or modifications */
	| 'edit'
	/** Custom mode defined by extensions or user settings */
	| 'custom'
	/** Applying a previously suggested code block */
	| 'applyCodeBlock'
	| undefined;
	applyCodeBlockSuggestionId: EditSuggestionId | undefined; // Is set if modeId is applyCodeBlock

	modelId: string | undefined; // e.g. 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'

	/** Source-controlled id for edit attribution. */
	sourceRequestId: string | undefined;
}

export interface IEditTelemetryCodeSuggestedData extends IEditTelemetryBaseData {
}

export interface IEditTelemetryCodeAcceptedData extends IEditTelemetryBaseData {
	acceptanceMethod:
	/** Insert code at the current cursor position in the active editor. Only possible when presentation is `codeBlock`. */
	| 'insertAtCursor'
	/** Create a new file and insert the code there. Only possible when presentation is `codeBlock`. */
	| 'insertInNewFile'
	/** User manually copied the code. Only possible when presentation is `codeBlock`. */
	| 'copyManual'
	/** User clicked a copy button to copy the code. Only possible when presentation is `codeBlock`. */
	| 'copyButton'
	/** User accepted the suggestion by clicking 'keep' (when presentation is `highlightedEdit`) or pressing Tab (when feature is `inlineSuggestion`) */
	| 'accept';
}

export interface IEditTelemetryCodeRejectedData extends IEditTelemetryBaseData {
	rejectionMethod:
	/** User explicitly rejected/undid the suggestion (when presentation is `highlightedEdit`) or pressed Escape (when feature is `inlineSuggestion`) */
	| 'reject';
}
