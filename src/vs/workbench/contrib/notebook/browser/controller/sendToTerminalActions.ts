/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { EndOfLinePreference } from '../../../../../editor/common/model.js';
import { localize2 } from '../../../../../nls.js';
import { MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { NOTEBOOK_CELL_TYPE, NOTEBOOK_EDITOR_FOCUSED } from '../../common/notebookContextKeys.js';
import { CellOverflowToolbarGroups, findTargetCellEditor, INotebookCellActionContext, NotebookCellAction } from './coreActions.js';

function getSelectedCellEditorText(context: INotebookCellActionContext): string | undefined {
	const editor = findTargetCellEditor(context, context.cell);
	const selection = editor?.getSelection();
	if (!editor?.hasModel() || !selection || selection.isEmpty()) {
		return undefined;
	}

	const endOfLinePreference = isWindows ? EndOfLinePreference.LF : EndOfLinePreference.CRLF;
	return editor.getModel().getValueInRange(selection, endOfLinePreference);
}

registerAction2(class SendNotebookCellToTerminalAction extends NotebookCellAction {
	constructor() {
		super({
			id: 'notebook.cell.sendToTerminal',
			title: localize2('notebookActions.sendCellToTerminal', 'Send Cell to Terminal'),
			icon: Codicon.terminal,
			menu: [
				{
					id: MenuId.EditorContext,
					group: 'navigation',
					order: 3,
					when: ContextKeyExpr.and(
						EditorContextKeys.inCompositeEditor,
						NOTEBOOK_EDITOR_FOCUSED,
						NOTEBOOK_CELL_TYPE.isEqualTo('code'),
						TerminalContextKeys.processSupported
					)
				},
				{
					id: MenuId.NotebookCellTitle,
					group: CellOverflowToolbarGroups.Edit,
					order: 12,
					when: ContextKeyExpr.and(
						NOTEBOOK_EDITOR_FOCUSED,
						NOTEBOOK_CELL_TYPE.isEqualTo('code'),
						TerminalContextKeys.processSupported
					)
				}
			]
		});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext): Promise<void> {
		const text = (getSelectedCellEditorText(context) ?? context.cell.getText()).replace(/(?:\r\n|\r|\n)+$/, '');
		if (!text) {
			return;
		}

		const terminalService = accessor.get(ITerminalService);
		const instance = await terminalService.getActiveOrCreateInstance({ acceptsInput: true });
		await instance.sendText(text, false, true);
		await terminalService.revealActiveTerminal(true);
	}
});
