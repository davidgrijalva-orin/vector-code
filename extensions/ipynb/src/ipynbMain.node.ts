/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as main from './ipynbMain';
import { NotebookSerializer } from './notebookSerializer.node';
import { activate as activatePythonNotebookRuntime } from './pythonNotebookRuntime.node';

export function activate(context: vscode.ExtensionContext) {
	const api = main.activate(context, new NotebookSerializer(context));
	activatePythonNotebookRuntime(context);
	return api;
}

export function deactivate() {
	return main.deactivate();
}
