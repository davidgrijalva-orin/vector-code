/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { execFile, spawn } from 'child_process';
import * as vscode from 'vscode';
import { pythonBootstrap } from '../pythonNotebookRuntime.node';

type PythonRunResult = {
	id: number;
	success: boolean;
	stdout: string;
	stderr: string;
	displays: { mime: string; data: string }[];
	error: string | null;
};

function canRunPython(command: string): Promise<boolean> {
	return new Promise(resolve => {
		execFile(command, ['--version'], { timeout: 5000 }, error => resolve(!error));
	});
}

function runPythonBootstrap(command: string, cells: string[]): Promise<PythonRunResult[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, ['-u', '-c', pythonBootstrap], { stdio: 'pipe' });
		const responses: PythonRunResult[] = [];
		let stdout = '';
		let stderr = '';

		child.stdout.on('data', chunk => {
			stdout += String(chunk);
			let newline = stdout.indexOf('\n');
			while (newline >= 0) {
				const line = stdout.slice(0, newline);
				stdout = stdout.slice(newline + 1);
				if (line.trim()) {
					responses.push(JSON.parse(line) as PythonRunResult);
				}
				newline = stdout.indexOf('\n');
			}
		});

		child.stderr.on('data', chunk => stderr += String(chunk));
		child.on('error', reject);
		child.on('exit', code => {
			if (code && code !== 0) {
				reject(new Error(stderr || `Python exited with code ${code}`));
				return;
			}

			resolve(responses);
		});

		cells.forEach((code, index) => child.stdin.write(`${JSON.stringify({ id: index + 1, code })}\n`));
		child.stdin.end();
	});
}

suite('Vector Code Python notebook runtime', () => {
	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	});

	test('opens ipynb files with notebook editor and registers Vector Code Python controller', async () => {
		await vscode.commands.executeCommand('ipynb.newUntitledIpynb');

		const editor = vscode.window.activeNotebookEditor;
		assert.ok(editor);
		assert.strictEqual(editor.notebook.notebookType, 'jupyter-notebook');

		const selected = await vscode.commands.executeCommand('notebook.selectKernel', {
			extension: 'vscode.ipynb',
			id: 'vector-python-notebook'
		});
		assert.ok(selected);
	});

	test('keeps Python state across cells', async function () {
		if (!await canRunPython('python3')) {
			this.skip();
		}

		const responses = await runPythonBootstrap('python3', ['shared_value = 5', 'shared_value + 2']);
		assert.deepStrictEqual(responses.map(response => ({
			id: response.id,
			success: response.success,
			output: response.displays[0]?.data
		})), [
			{ id: 1, success: true, output: undefined },
			{ id: 2, success: true, output: '7' }
		]);
	});
});
