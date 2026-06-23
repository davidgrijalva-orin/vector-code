/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RichMarkdownEditorProvider } from './richMarkdownEditor';

const markdownDefaultOpenModeSetting = 'defaultOpenMode';
const editorAssociationsSetting = 'editorAssociations';
const markdownPatterns = ['*.md', '*.markdown'];
const sourceEditorAssociation = 'default';
const readonlyPreviewAssociation = 'vscode.markdown.preview.editor';

type MarkdownDefaultOpenMode = 'rich' | 'markdown';

export function registerMarkdownDefaultOpenMode(): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];

	void applyMarkdownDefaultOpenMode();
	disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration(`markdown.${markdownDefaultOpenModeSetting}`)) {
			void applyMarkdownDefaultOpenMode();
		}
	}));

	return vscode.Disposable.from(...disposables);
}

async function applyMarkdownDefaultOpenMode(): Promise<void> {
	const mode = vscode.workspace.getConfiguration('markdown').get<MarkdownDefaultOpenMode>(markdownDefaultOpenModeSetting, 'markdown');
	const workbenchConfiguration = vscode.workspace.getConfiguration('workbench');
	const currentAssociations = workbenchConfiguration.get<Record<string, string>>(editorAssociationsSetting, {});
	const nextAssociations = { ...currentAssociations };
	let changed = false;

	for (const pattern of markdownPatterns) {
		const current = nextAssociations[pattern];
		const next = mode === 'markdown' ? sourceEditorAssociation : RichMarkdownEditorProvider.viewType;
		if (current !== next && isManagedMarkdownAssociation(current)) {
			nextAssociations[pattern] = next;
			changed = true;
		}
	}

	if (changed) {
		await workbenchConfiguration.update(editorAssociationsSetting, nextAssociations, vscode.ConfigurationTarget.Global);
	}
}

function isManagedMarkdownAssociation(association: string | undefined): boolean {
	return !association
		|| association === sourceEditorAssociation
		|| association === readonlyPreviewAssociation
		|| association === RichMarkdownEditorProvider.viewType;
}
