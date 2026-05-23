/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const controllerId = 'vector-python-notebook';
const notebookType = 'jupyter-notebook';

export const pythonBootstrap = String.raw`
import ast
import base64
import contextlib
import io
import json
import sys
import traceback

namespace = {"__name__": "__main__"}

def encode_display(value):
	if value is None:
		return []

	for method_name, mime in (("_repr_html_", "text/html"), ("_repr_markdown_", "text/markdown")):
		method = getattr(value, method_name, None)
		if callable(method):
			try:
				data = method()
				if data:
					return [{"mime": mime, "data": data}]
			except Exception:
				pass

	return [{"mime": "text/plain", "data": repr(value)}]

def collect_matplotlib_figures():
	try:
		import matplotlib.pyplot as plt
	except Exception:
		return []

	displays = []
	for number in plt.get_fignums():
		figure = plt.figure(number)
		buffer = io.BytesIO()
		figure.savefig(buffer, format="png", bbox_inches="tight")
		displays.append({"mime": "image/png", "data": base64.b64encode(buffer.getvalue()).decode("ascii")})
		plt.close(figure)
	return displays

def execute_cell(code):
	stdout = io.StringIO()
	stderr = io.StringIO()
	displays = []
	success = True
	error = None

	try:
		tree = ast.parse(code, mode="exec")
		last_expression = tree.body[-1] if tree.body and isinstance(tree.body[-1], ast.Expr) else None
		body = tree.body[:-1] if last_expression else tree.body

		with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
			if body:
				module = ast.Module(body=body, type_ignores=[])
				ast.fix_missing_locations(module)
				exec(compile(module, "<vector-notebook-cell>", "exec"), namespace, namespace)

			if last_expression:
				expression = ast.Expression(last_expression.value)
				ast.fix_missing_locations(expression)
				displays.extend(encode_display(eval(compile(expression, "<vector-notebook-cell>", "eval"), namespace, namespace)))

			displays.extend(collect_matplotlib_figures())
	except Exception:
		success = False
		error = traceback.format_exc()

	return {
		"success": success,
		"stdout": stdout.getvalue(),
		"stderr": stderr.getvalue(),
		"displays": displays,
		"error": error
	}

for raw_line in sys.stdin:
	try:
		request = json.loads(raw_line)
		response = execute_cell(request.get("code", ""))
		response["id"] = request.get("id")
	except Exception:
		response = {
			"id": None,
			"success": False,
			"stdout": "",
			"stderr": "",
			"displays": [],
			"error": traceback.format_exc()
		}

	print(json.dumps(response, ensure_ascii=False), flush=True)
`;

type PythonCandidate = {
	command: string;
};

type PythonDisplay = {
	mime: string;
	data: string;
};

type PythonRunResult = {
	id: number | null;
	success: boolean;
	stdout: string;
	stderr: string;
	displays: PythonDisplay[];
	error: string | null;
};

type PendingCellRun = {
	resolve: (result: PythonRunResult) => void;
	reject: (error: Error) => void;
};

export function activate(context: vscode.ExtensionContext): void {
	const sessions = new Map<string, PythonNotebookSession>();
	const controller = vscode.notebooks.createNotebookController(controllerId, notebookType, vscode.l10n.t('Vector Code Python'));
	controller.description = vscode.l10n.t('Project Python');
	controller.detail = vscode.l10n.t('Runs notebook cells in the project Python environment.');
	controller.supportedLanguages = ['python'];
	controller.supportsExecutionOrder = true;

	const getSession = (notebook: vscode.NotebookDocument): PythonNotebookSession => {
		const key = notebook.uri.toString();
		let session = sessions.get(key);
		if (!session) {
			session = new PythonNotebookSession(notebook.uri);
			sessions.set(key, session);
		}

		return session;
	};

	controller.executeHandler = async (cells, notebook) => {
		const session = getSession(notebook);
		for (const cell of cells) {
			await runCell(controller, session, cell);
		}
	};

	controller.interruptHandler = async notebook => {
		sessions.get(notebook.uri.toString())?.dispose();
		sessions.delete(notebook.uri.toString());
	};

	const preferController = (document: vscode.NotebookDocument) => {
		if (document.notebookType === notebookType) {
			controller.updateNotebookAffinity(document, vscode.NotebookControllerAffinity.Preferred);
		}
	};

	context.subscriptions.push(
		controller,
		vscode.workspace.onDidOpenNotebookDocument(preferController),
		vscode.workspace.onDidCloseNotebookDocument(document => {
			const key = document.uri.toString();
			sessions.get(key)?.dispose();
			sessions.delete(key);
		}),
		{ dispose: () => sessions.forEach(session => session.dispose()) }
	);

	for (const document of vscode.workspace.notebookDocuments) {
		preferController(document);
	}
}

async function runCell(controller: vscode.NotebookController, session: PythonNotebookSession, cell: vscode.NotebookCell): Promise<void> {
	const task = controller.createNotebookCellExecution(cell);
	task.executionOrder = session.nextExecutionOrder();
	task.start(Date.now());
	await task.clearOutput();

	const cancellation = task.token.onCancellationRequested(() => session.dispose());
	try {
		const result = await session.run(cell.document.getText());
		await task.replaceOutput(createOutputs(result));
		task.end(result.success, Date.now());
	} catch (error) {
		await task.replaceOutput([
			new vscode.NotebookCellOutput([
				vscode.NotebookCellOutputItem.stderr(error instanceof Error ? error.message : String(error))
			])
		]);
		task.end(false, Date.now());
	} finally {
		cancellation.dispose();
	}
}

function createOutputs(result: PythonRunResult): vscode.NotebookCellOutput[] {
	const outputs: vscode.NotebookCellOutput[] = [];
	if (result.stdout) {
		outputs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stdout(result.stdout)]));
	}

	if (result.stderr) {
		outputs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(result.stderr)]));
	}

	for (const display of result.displays) {
		if (display.mime === 'image/png') {
			outputs.push(new vscode.NotebookCellOutput([
				new vscode.NotebookCellOutputItem(Buffer.from(display.data, 'base64'), display.mime)
			]));
			continue;
		}

		outputs.push(new vscode.NotebookCellOutput([
			vscode.NotebookCellOutputItem.text(display.data, display.mime)
		]));
	}

	if (!result.success && result.error) {
		outputs.push(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(result.error)]));
	}

	return outputs;
}

class PythonNotebookSession {
	private process: ChildProcessWithoutNullStreams | undefined;
	private stdout = '';
	private nextRequestId = 1;
	private executionOrder = 1;
	private candidate: PythonCandidate | undefined;
	private hasShownMissingPythonPrompt = false;
	private readonly pending = new Map<number, PendingCellRun>();
	private queue: Promise<PythonRunResult> = Promise.resolve({
		id: null,
		success: true,
		stdout: '',
		stderr: '',
		displays: [],
		error: null
	});

	constructor(private readonly notebookUri: vscode.Uri) { }

	nextExecutionOrder(): number {
		return this.executionOrder++;
	}

	run(code: string): Promise<PythonRunResult> {
		const next = this.queue.then(() => this.runImmediately(code));
		this.queue = next.catch(() => ({
			id: null,
			success: false,
			stdout: '',
			stderr: '',
			displays: [],
			error: null
		}));
		return next;
	}

	dispose(): void {
		for (const pending of this.pending.values()) {
			pending.reject(new Error(vscode.l10n.t('Notebook execution was interrupted.')));
		}

		this.pending.clear();
		this.process?.kill();
		this.process = undefined;
		this.stdout = '';
	}

	private async runImmediately(code: string): Promise<PythonRunResult> {
		this.candidate = this.candidate ?? await resolvePythonCandidate(this.notebookUri);
		if (!this.candidate) {
			this.showMissingPythonPrompt();
			return {
				id: null,
				success: false,
				stdout: '',
				stderr: '',
				displays: [],
				error: missingPythonMessage()
			};
		}

		const process = this.ensureProcess(this.candidate);
		const id = this.nextRequestId++;
		const payload = JSON.stringify({ id, code });

		return new Promise<PythonRunResult>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			process.stdin.write(`${payload}\n`, error => {
				if (error) {
					this.pending.delete(id);
					reject(error);
				}
			});
		});
	}

	private showMissingPythonPrompt(): void {
		if (this.hasShownMissingPythonPrompt) {
			return;
		}

		this.hasShownMissingPythonPrompt = true;
		void showMissingPythonSetupPrompt(this.notebookUri);
	}

	private ensureProcess(candidate: PythonCandidate): ChildProcessWithoutNullStreams {
		if (this.process && !this.process.killed) {
			return this.process;
		}

		const cwd = getWorkingDirectory(this.notebookUri);
		const child = spawn(candidate.command, ['-u', '-c', pythonBootstrap], {
			cwd,
			env: {
				...process.env,
				PYTHONIOENCODING: 'utf-8'
			}
		});

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', chunk => this.handleStdout(String(chunk)));
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', chunk => this.rejectAll(new Error(String(chunk))));
		child.on('error', error => this.rejectAll(error));
		child.on('exit', () => {
			this.process = undefined;
			this.rejectAll(new Error(vscode.l10n.t('Python notebook runtime stopped.')));
		});

		this.process = child;
		return child;
	}

	private handleStdout(chunk: string): void {
		this.stdout += chunk;
		let newline = this.stdout.indexOf('\n');
		while (newline >= 0) {
			const line = this.stdout.slice(0, newline);
			this.stdout = this.stdout.slice(newline + 1);
			this.handleResponseLine(line);
			newline = this.stdout.indexOf('\n');
		}
	}

	private handleResponseLine(line: string): void {
		if (!line.trim()) {
			return;
		}

		let response: PythonRunResult;
		try {
			response = JSON.parse(line) as PythonRunResult;
		} catch (error) {
			this.rejectAll(error instanceof Error ? error : new Error(String(error)));
			return;
		}

		if (typeof response.id !== 'number') {
			this.rejectAll(new Error(response.error ?? vscode.l10n.t('Python notebook runtime returned an invalid response.')));
			return;
		}

		const pending = this.pending.get(response.id);
		if (!pending) {
			return;
		}

		this.pending.delete(response.id);
		pending.resolve(response);
	}

	private rejectAll(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}

		this.pending.clear();
	}
}

async function resolvePythonCandidate(resource: vscode.Uri): Promise<PythonCandidate | undefined> {
	for (const candidate of getPythonCandidates(resource)) {
		if (await canRunPython(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

function getPythonCandidates(resource: vscode.Uri): PythonCandidate[] {
	const candidates: PythonCandidate[] = [];
	const configured = vscode.workspace.getConfiguration('vectorcode.notebook', resource).get<string>('pythonPath', '').trim();
	if (configured) {
		candidates.push({ command: expandHome(configured) });
	}

	for (const base of getProjectRoots(resource)) {
		for (const relativePath of getVirtualEnvironmentPythonPaths()) {
			const command = path.join(base, relativePath);
			if (fs.existsSync(command)) {
				candidates.push({ command });
			}
		}
	}

	candidates.push(
		{ command: 'python3' },
		{ command: 'python' }
	);

	const seen = new Set<string>();
	return candidates.filter(candidate => {
		if (seen.has(candidate.command)) {
			return false;
		}

		seen.add(candidate.command);
		return true;
	});
}

function getVirtualEnvironmentPythonPaths(): string[] {
	if (process.platform === 'win32') {
		return [
			path.join('.venv', 'Scripts', 'python.exe'),
			path.join('venv', 'Scripts', 'python.exe'),
			path.join('env', 'Scripts', 'python.exe')
		];
	}

	return [
		path.join('.venv', 'bin', 'python'),
		path.join('venv', 'bin', 'python'),
		path.join('env', 'bin', 'python')
	];
}

function getProjectRoots(resource: vscode.Uri): string[] {
	const roots: string[] = [];
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
	if (workspaceFolder?.uri.scheme === 'file') {
		roots.push(workspaceFolder.uri.fsPath);
	}

	if (resource.scheme === 'file') {
		roots.push(path.dirname(resource.fsPath));
	}

	return roots;
}

function getWorkingDirectory(resource: vscode.Uri): string | undefined {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
	if (workspaceFolder?.uri.scheme === 'file') {
		return workspaceFolder.uri.fsPath;
	}

	if (resource.scheme === 'file') {
		return path.dirname(resource.fsPath);
	}

	return undefined;
}

function expandHome(value: string): string {
	if (value === '~') {
		return process.env.HOME ?? value;
	}

	if (value.startsWith(`~${path.sep}`)) {
		return path.join(process.env.HOME ?? '~', value.slice(2));
	}

	return value;
}

async function showMissingPythonSetupPrompt(resource: vscode.Uri): Promise<void> {
	const selectPython = vscode.l10n.t('Select Python');
	const openSettings = vscode.l10n.t('Open Settings');
	const openTerminal = vscode.l10n.t('Open Terminal');
	const result = await vscode.window.showWarningMessage(
		vscode.l10n.t('Vector Code could not find a Python runtime for this notebook. Choose a Python executable, set vectorcode.notebook.pythonPath, or create a project virtual environment.'),
		selectPython,
		openSettings,
		openTerminal
	);

	if (result === selectPython) {
		await selectPythonExecutable(resource);
	} else if (result === openSettings) {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'vectorcode.notebook.pythonPath');
	} else if (result === openTerminal) {
		openPythonSetupTerminal(resource);
	}
}

async function selectPythonExecutable(resource: vscode.Uri): Promise<void> {
	const selection = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		openLabel: vscode.l10n.t('Use Python'),
		title: vscode.l10n.t('Select Python Executable')
	});

	const pythonPath = selection?.[0]?.fsPath;
	if (!pythonPath) {
		return;
	}

	const configurationTarget = vscode.workspace.getWorkspaceFolder(resource)
		? vscode.ConfigurationTarget.WorkspaceFolder
		: vscode.workspace.workspaceFolders?.length
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;

	try {
		await vscode.workspace.getConfiguration('vectorcode.notebook', resource).update('pythonPath', pythonPath, configurationTarget);
	} catch (error) {
		await vscode.window.showErrorMessage(
			error instanceof Error
				? vscode.l10n.t('Vector Code could not save the Python runtime setting: {0}', error.message)
				: vscode.l10n.t('Vector Code could not save the Python runtime setting.')
		);
	}
}

function openPythonSetupTerminal(resource: vscode.Uri): void {
	const terminal = vscode.window.createTerminal({
		name: vscode.l10n.t('Notebook Setup'),
		cwd: getWorkingDirectory(resource)
	});
	terminal.show();
	terminal.sendText('python3 -m venv .venv', false);
}

function canRunPython(candidate: PythonCandidate): Promise<boolean> {
	return new Promise(resolve => {
		execFile(candidate.command, ['-c', 'import sys; print(sys.executable)'], { timeout: 5000 }, error => {
			resolve(!error);
		});
	});
}

function missingPythonMessage(): string {
	return vscode.l10n.t(
		'Vector Code could not find a Python runtime for this project. Create a .venv in the project or set "vectorcode.notebook.pythonPath" to a Python executable.'
	);
}
