/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

interface RichMarkdownMessage {
	readonly type: 'edit';
	readonly text: string;
}

export class RichMarkdownEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'vectorcode.markdown.richEditor';

	public resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): void {
		webviewPanel.webview.options = {
			enableScripts: true,
		};

		let webviewText = document.getText();
		webviewPanel.webview.html = this.#getHtml(webviewPanel.webview, webviewText);

		const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.uri.toString() !== document.uri.toString()) {
				return;
			}

			const nextText = document.getText();
			if (nextText === webviewText) {
				return;
			}

			webviewText = nextText;
			void webviewPanel.webview.postMessage({ type: 'update', text: nextText });
		});

		const messageSubscription = webviewPanel.webview.onDidReceiveMessage(async (message: RichMarkdownMessage) => {
			if (message.type !== 'edit' || typeof message.text !== 'string') {
				return;
			}

			if (message.text === document.getText()) {
				webviewText = message.text;
				return;
			}

			webviewText = message.text;
			await this.#replaceDocument(document, message.text);
		});

		webviewPanel.onDidDispose(() => {
			changeSubscription.dispose();
			messageSubscription.dispose();
		});
	}

	async #replaceDocument(document: vscode.TextDocument, text: string): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
		edit.replace(document.uri, fullRange, text);
		await vscode.workspace.applyEdit(edit);
	}

	#getHtml(webview: vscode.Webview, text: string): string {
		const nonce = getNonce();

		const strings = {
			paragraph: vscode.l10n.t('Paragraph'),
			heading: vscode.l10n.t('Heading'),
			bold: vscode.l10n.t('Bold'),
			italic: vscode.l10n.t('Italic'),
			code: vscode.l10n.t('Code'),
			link: vscode.l10n.t('Link'),
			list: vscode.l10n.t('List'),
			rawMarkdown: vscode.l10n.t('Raw Markdown'),
			codeBlock: vscode.l10n.t('Code Block'),
			emptyDocument: vscode.l10n.t('Start writing Markdown...'),
			linkUrlPrompt: vscode.l10n.t('Link URL'),
		};

		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: http: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>${escapeHtml(vscode.l10n.t('Rich Markdown'))}</title>
	<style>
		:root {
			color-scheme: light dark;
		}

		body {
			margin: 0;
			padding: 0;
			color: var(--vectorcode-editor-foreground);
			background: var(--vectorcode-editor-background);
			font-family: var(--vectorcode-font-family);
			font-size: var(--vectorcode-font-size);
		}

		.toolbar {
			position: sticky;
			top: 0;
			z-index: 1;
			display: flex;
			gap: 4px;
			align-items: center;
			height: 34px;
			padding: 0 12px;
			border-bottom: 1px solid var(--vectorcode-editorGroup-border);
			background: var(--vectorcode-editor-background);
		}

		.toolbar button,
		.toolbar select {
			height: 24px;
			border: 1px solid transparent;
			border-radius: 4px;
			color: var(--vectorcode-button-secondaryForeground);
			background: transparent;
			font: inherit;
		}

		.toolbar button {
			width: 30px;
			padding: 0;
			font-weight: 600;
		}

		.toolbar select {
			min-width: 104px;
			padding: 0 7px;
		}

		.toolbar button:hover,
		.toolbar select:hover,
		.toolbar button:focus,
		.toolbar select:focus {
			border-color: var(--vectorcode-focusBorder);
			background: var(--vectorcode-toolbar-hoverBackground);
			outline: none;
		}

		.editor {
			box-sizing: border-box;
			width: min(880px, calc(100vw - 48px));
			min-height: calc(100vh - 34px);
			margin: 0 auto;
			padding: 28px 0 64px;
			line-height: 1.58;
		}

		.editor:empty::before {
			content: attr(data-placeholder);
			color: var(--vectorcode-descriptionForeground);
		}

		.md-block {
			position: relative;
			margin: 0 0 14px;
			border-radius: 5px;
			outline: none;
		}

		.md-block:focus {
			box-shadow: 0 0 0 1px var(--vectorcode-focusBorder);
		}

		h1.md-block,
		h2.md-block,
		h3.md-block,
		h4.md-block,
		h5.md-block,
		h6.md-block {
			margin-top: 18px;
			margin-bottom: 10px;
			line-height: 1.22;
			font-weight: 600;
		}

		h1.md-block {
			font-size: 2em;
			padding-bottom: 0.2em;
			border-bottom: 1px solid var(--vectorcode-editorGroup-border);
		}

		h2.md-block {
			font-size: 1.55em;
		}

		h3.md-block {
			font-size: 1.28em;
		}

		p.md-block {
			min-height: 1.58em;
		}

		blockquote.md-block {
			margin-left: 0;
			padding-left: 14px;
			border-left: 3px solid var(--vectorcode-textBlockQuote-border);
			color: var(--vectorcode-textBlockQuote-foreground);
		}

		ul.md-block,
		ol.md-block {
			padding-left: 26px;
		}

		li {
			margin: 4px 0;
		}

		pre.md-block {
			overflow: auto;
			padding: 11px 13px;
			border: 1px solid var(--vectorcode-textCodeBlock-background);
			background: var(--vectorcode-textCodeBlock-background);
			font-family: var(--vectorcode-editor-font-family);
			font-size: var(--vectorcode-editor-font-size);
			line-height: 1.45;
			white-space: pre-wrap;
		}

		pre[data-md-type="raw"]::before,
		pre[data-md-type="code"]::before {
			display: block;
			margin-bottom: 8px;
			color: var(--vectorcode-descriptionForeground);
			font-family: var(--vectorcode-font-family);
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: 0;
		}

		pre[data-md-type="raw"]::before {
			content: attr(data-label);
		}

		pre[data-md-type="code"]::before {
			content: attr(data-label);
		}

		a {
			color: var(--vectorcode-textLink-foreground);
			text-decoration: underline;
		}

		code {
			padding: 0 0.25em;
			border-radius: 3px;
			background: var(--vectorcode-textCodeBlock-background);
			font-family: var(--vectorcode-editor-font-family);
		}
	</style>
</head>
<body>
	<div class="toolbar" role="toolbar" aria-label="${escapeHtml(vscode.l10n.t('Markdown Formatting'))}">
		<select id="blockFormat" title="${escapeHtml(strings.paragraph)}" aria-label="${escapeHtml(strings.paragraph)}">
			<option value="paragraph">${escapeHtml(strings.paragraph)}</option>
			<option value="heading:1">${escapeHtml(strings.heading)} 1</option>
			<option value="heading:2">${escapeHtml(strings.heading)} 2</option>
			<option value="heading:3">${escapeHtml(strings.heading)} 3</option>
		</select>
		<button type="button" data-command="bold" title="${escapeHtml(strings.bold)}" aria-label="${escapeHtml(strings.bold)}">B</button>
		<button type="button" data-command="italic" title="${escapeHtml(strings.italic)}" aria-label="${escapeHtml(strings.italic)}"><em>I</em></button>
		<button type="button" data-command="code" title="${escapeHtml(strings.code)}" aria-label="${escapeHtml(strings.code)}">&lt;/&gt;</button>
		<button type="button" data-command="link" title="${escapeHtml(strings.link)}" aria-label="${escapeHtml(strings.link)}">[]</button>
		<button type="button" data-command="list" title="${escapeHtml(strings.list)}" aria-label="${escapeHtml(strings.list)}">-</button>
	</div>
	<main id="editor" class="editor" data-placeholder="${escapeHtml(strings.emptyDocument)}" spellcheck="true"></main>
	<script nonce="${nonce}">
		(() => {
			const vscode = acquireVsCodeApi();
			const editor = document.getElementById('editor');
			const blockFormat = document.getElementById('blockFormat');
			const initialText = ${toScriptLiteral(text)};
			const strings = ${toScriptLiteral(strings)};
			let markdownText = initialText;
			let applyingExternalUpdate = false;
			let pendingEdit;

			function escapeHtml(value) {
				return value.replace(/[&<>"']/g, character => {
					switch (character) {
						case '&': return '&amp;';
						case '<': return '&lt;';
						case '>': return '&gt;';
						case '"': return '&quot;';
						case "'": return '&#39;';
						default: return character;
					}
				});
			}

			function escapeAttribute(value) {
				return escapeHtml(value).replace(/\x60/g, '&#96;');
			}

			function sourceAttributes(block) {
				return ' data-original-raw="' + encodeURIComponent(block.raw || '') + '" data-prefix="' + encodeURIComponent(block.prefix || '') + '"';
			}

			function renderInline(markdown) {
				let html = escapeHtml(markdown);
				html = html.replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, (_match, alt, src) => '<img alt="' + escapeAttribute(alt) + '" src="' + escapeAttribute(src) + '">');
				html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (_match, label, href) => '<a href="' + escapeAttribute(href) + '" data-md-href="' + escapeAttribute(href) + '">' + label + '</a>');
				html = html.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
				html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
				html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
				return html;
			}

			function isRawBlock(text) {
				return /^\\s*</.test(text)
					|| /^\\s*\\|.*\\|\\s*$/m.test(text)
					|| /^\\[[^\\]]+\\]:\\s+\\S+/m.test(text)
					|| /^\\[\\^[^\\]]+\\]:/m.test(text)
					|| /^\\s*:::/m.test(text)
					|| /^\\s*\\$\\$/m.test(text);
			}

			function parseMarkdown(text) {
				const lines = text.replace(/\\r\\n/g, '\\n').split('\\n');
				const blocks = [];
				let trailing = '';
				let index = 0;

				while (index < lines.length) {
					const blankStart = index;
					while (index < lines.length && lines[index].trim() === '') {
						index++;
					}
					if (index >= lines.length) {
						trailing = '\\n'.repeat(index - blankStart);
						break;
					}

					const blankCount = index - blankStart;
					const prefix = blocks.length === 0 ? '\\n'.repeat(blankCount) : '\\n'.repeat(blankCount + 1);
					const blockStart = index;
					const line = lines[index];
					const fenceMatch = line.match(/^\\s*(\\x60{3,}|~~~+)\\s*([^\\x60]*)$/);
					if (fenceMatch) {
						const fence = fenceMatch[1];
						const language = fenceMatch[2].trim();
						const code = [];
						index++;
						while (index < lines.length && !lines[index].startsWith(fence)) {
							code.push(lines[index]);
							index++;
						}
						if (index < lines.length) {
							index++;
						}
						blocks.push({ type: 'code', fence, language, text: code.join('\\n'), raw: lines.slice(blockStart, index).join('\\n'), prefix });
						continue;
					}

					const headingMatch = line.match(/^(#{1,6})\\s+(.+)$/);
					if (headingMatch) {
						index++;
						blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2], raw: lines.slice(blockStart, index).join('\\n'), prefix });
						continue;
					}

					const unorderedLines = [];
					while (index < lines.length && /^\\s*[-*+]\\s+/.test(lines[index])) {
						unorderedLines.push(lines[index].replace(/^\\s*[-*+]\\s+/, ''));
						index++;
					}
					if (unorderedLines.length) {
						blocks.push({ type: 'ul', items: unorderedLines, raw: lines.slice(blockStart, index).join('\\n'), prefix });
						continue;
					}

					const orderedLines = [];
					while (index < lines.length && /^\\s*\\d+[.)]\\s+/.test(lines[index])) {
						orderedLines.push(lines[index].replace(/^\\s*\\d+[.)]\\s+/, ''));
						index++;
					}
					if (orderedLines.length) {
						blocks.push({ type: 'ol', items: orderedLines, raw: lines.slice(blockStart, index).join('\\n'), prefix });
						continue;
					}

					const quoteLines = [];
					while (index < lines.length && /^\\s*>\\s?/.test(lines[index])) {
						quoteLines.push(lines[index].replace(/^\\s*>\\s?/, ''));
						index++;
					}
					if (quoteLines.length) {
						blocks.push({ type: 'blockquote', text: quoteLines.join('\\n'), raw: lines.slice(blockStart, index).join('\\n'), prefix });
						continue;
					}

					if (/^\\s*(-{3,}|\\*{3,}|_{3,})\\s*$/.test(line)) {
						index++;
						blocks.push({ type: 'hr', raw: lines.slice(blockStart, index).join('\\n'), prefix });
						continue;
					}

					const paragraphLines = [];
					while (index < lines.length && lines[index].trim() !== '') {
						paragraphLines.push(lines[index]);
						index++;
					}
					const paragraph = paragraphLines.join('\\n');
					const raw = lines.slice(blockStart, index).join('\\n');
					blocks.push(isRawBlock(paragraph) ? { type: 'raw', text: paragraph, raw, prefix } : { type: 'paragraph', text: paragraph, raw, prefix });
				}

				return { blocks, trailing };
			}

			function renderBlocks(parsedDocument) {
				const blocks = parsedDocument.blocks;
				editor.dataset.trailing = encodeURIComponent(parsedDocument.trailing || '');
				editor.innerHTML = blocks.map(block => {
					switch (block.type) {
						case 'heading':
							return '<h' + block.level + ' class="md-block" data-md-type="heading" data-level="' + block.level + '"' + sourceAttributes(block) + ' contenteditable="true">' + renderInline(block.text) + '</h' + block.level + '>';
						case 'paragraph':
							return '<p class="md-block" data-md-type="paragraph"' + sourceAttributes(block) + ' contenteditable="true">' + renderInline(block.text) + '</p>';
						case 'blockquote':
							return '<blockquote class="md-block" data-md-type="blockquote"' + sourceAttributes(block) + ' contenteditable="true">' + renderInline(block.text).replace(/\\n/g, '<br>') + '</blockquote>';
						case 'ul':
							return '<ul class="md-block" data-md-type="ul"' + sourceAttributes(block) + '>' + block.items.map(item => '<li contenteditable="true">' + renderInline(item) + '</li>').join('') + '</ul>';
						case 'ol':
							return '<ol class="md-block" data-md-type="ol"' + sourceAttributes(block) + '>' + block.items.map(item => '<li contenteditable="true">' + renderInline(item) + '</li>').join('') + '</ol>';
						case 'code':
							return '<pre class="md-block" data-md-type="code" data-label="' + escapeAttribute(strings.codeBlock) + '" data-fence="' + escapeAttribute(block.fence) + '" data-language="' + escapeAttribute(block.language) + '"' + sourceAttributes(block) + ' contenteditable="true">' + escapeHtml(block.text) + '</pre>';
						case 'raw':
							return '<pre class="md-block" data-md-type="raw" data-label="' + escapeAttribute(strings.rawMarkdown) + '"' + sourceAttributes(block) + ' contenteditable="true">' + escapeHtml(block.text) + '</pre>';
						case 'hr':
							return '<hr class="md-block" data-md-type="hr"' + sourceAttributes(block) + '>';
						default:
							return '';
					}
				}).join('');
			}

			function inlineToMarkdown(node) {
				let markdown = '';
				for (const child of node.childNodes) {
					if (child.nodeType === Node.TEXT_NODE) {
						markdown += child.textContent ?? '';
						continue;
					}
					if (child.nodeType !== Node.ELEMENT_NODE) {
						continue;
					}

					const element = child;
					const tagName = element.tagName;
					if (tagName === 'STRONG' || tagName === 'B') {
						markdown += '**' + inlineToMarkdown(element) + '**';
					} else if (tagName === 'EM' || tagName === 'I') {
						markdown += '*' + inlineToMarkdown(element) + '*';
					} else if (tagName === 'CODE') {
						markdown += String.fromCharCode(96) + element.textContent + String.fromCharCode(96);
					} else if (tagName === 'A') {
						const href = element.getAttribute('data-md-href') || element.getAttribute('href') || '';
						markdown += '[' + inlineToMarkdown(element) + '](' + href + ')';
					} else if (tagName === 'IMG') {
						markdown += '![' + (element.getAttribute('alt') || '') + '](' + (element.getAttribute('src') || '') + ')';
					} else if (tagName === 'BR') {
						markdown += '\\n';
					} else {
						markdown += inlineToMarkdown(element);
					}
				}
				return markdown.replace(/\\u00a0/g, ' ');
			}

			function serializeMarkdown() {
				const parts = [];
				let blockIndex = 0;
				for (const block of editor.querySelectorAll('.md-block')) {
					const type = block.getAttribute('data-md-type');
					const prefixAttribute = block.getAttribute('data-prefix');
					const prefix = prefixAttribute !== null ? decodeURIComponent(prefixAttribute) : (blockIndex === 0 ? '' : '\\n\\n');
					const originalRaw = block.getAttribute('data-original-raw');
					if (block.getAttribute('data-dirty') !== 'true' && originalRaw !== null) {
						parts.push(prefix + decodeURIComponent(originalRaw));
						blockIndex++;
						continue;
					}
					let serialized = '';
					switch (type) {
						case 'heading': {
							const level = Number(block.getAttribute('data-level') || '1');
							serialized = '#'.repeat(level) + ' ' + inlineToMarkdown(block).trim();
							break;
						}
						case 'paragraph':
							serialized = inlineToMarkdown(block).trim();
							break;
						case 'blockquote':
							serialized = inlineToMarkdown(block).split('\\n').map(line => '> ' + line).join('\\n');
							break;
						case 'ul':
							serialized = Array.from(block.querySelectorAll('li')).map(item => '- ' + inlineToMarkdown(item).trim()).join('\\n');
							break;
						case 'ol':
							serialized = Array.from(block.querySelectorAll('li')).map((item, index) => (index + 1) + '. ' + inlineToMarkdown(item).trim()).join('\\n');
							break;
						case 'code': {
							const fence = block.getAttribute('data-fence') || String.fromCharCode(96).repeat(3);
							const language = block.getAttribute('data-language') || '';
							serialized = fence + language + '\\n' + block.textContent.replace(/\\n$/, '') + '\\n' + fence;
							break;
						}
						case 'raw':
							serialized = block.textContent.replace(/\\n$/, '');
							break;
						case 'hr':
							serialized = '---';
							break;
					}
					parts.push(prefix + serialized);
					blockIndex++;
				}
				const trailing = editor.dataset.trailing ? decodeURIComponent(editor.dataset.trailing) : '';
				return parts.join('') + trailing;
			}

			function postEdit() {
				clearTimeout(pendingEdit);
				pendingEdit = setTimeout(() => {
					if (applyingExternalUpdate) {
						return;
					}
					const nextText = serializeMarkdown();
					if (nextText === markdownText) {
						return;
					}
					markdownText = nextText;
					vscode.postMessage({ type: 'edit', text: nextText });
				}, 150);
			}

			function getActiveBlock() {
				const selection = document.getSelection();
				if (!selection || !selection.anchorNode) {
					return undefined;
				}
				const node = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
				return node?.closest?.('.md-block');
			}

			function markDirty(block) {
				block?.setAttribute('data-dirty', 'true');
			}

			function applyInlineCommand(command) {
				const activeBlock = getActiveBlock();
				if (command === 'code') {
					document.execCommand('formatBlock', false, 'code');
					markDirty(activeBlock);
					postEdit();
					return;
				}

				if (command === 'link') {
					const url = window.prompt(strings.linkUrlPrompt);
					if (url) {
						document.execCommand('createLink', false, url);
						const selection = document.getSelection();
						const element = selection?.anchorNode?.parentElement?.closest?.('a');
						if (element) {
							element.setAttribute('data-md-href', url);
						}
					}
					markDirty(activeBlock);
					postEdit();
					return;
				}

				if (command === 'list') {
					const block = activeBlock;
					if (block?.getAttribute('data-md-type') === 'paragraph') {
						const list = document.createElement('ul');
						list.className = 'md-block';
						list.setAttribute('data-md-type', 'ul');
						list.setAttribute('data-dirty', 'true');
						const prefix = block.getAttribute('data-prefix');
						if (prefix !== null) {
							list.setAttribute('data-prefix', prefix);
						}
						const item = document.createElement('li');
						item.contentEditable = 'true';
						item.innerHTML = block.innerHTML;
						list.appendChild(item);
						block.replaceWith(list);
						item.focus();
						postEdit();
					}
					return;
				}

				document.execCommand(command, false);
				markDirty(activeBlock);
				postEdit();
			}

			function applyBlockFormat(value) {
				const block = getActiveBlock();
				if (!block) {
					return;
				}

				const markdown = inlineToMarkdown(block).trim();
				let replacement;
				if (value.startsWith('heading:')) {
					const level = value.split(':')[1];
					replacement = document.createElement('h' + level);
					replacement.className = 'md-block';
					replacement.setAttribute('data-md-type', 'heading');
					replacement.setAttribute('data-level', level);
				} else {
					replacement = document.createElement('p');
					replacement.className = 'md-block';
					replacement.setAttribute('data-md-type', 'paragraph');
				}

				replacement.contentEditable = 'true';
				replacement.setAttribute('data-dirty', 'true');
				const prefix = block.getAttribute('data-prefix');
				if (prefix !== null) {
					replacement.setAttribute('data-prefix', prefix);
				}
				replacement.innerHTML = renderInline(markdown);
				block.replaceWith(replacement);
				replacement.focus();
				postEdit();
			}

			editor.addEventListener('input', event => {
				const target = event.target;
				markDirty(target?.closest?.('.md-block'));
				postEdit();
			});
			editor.addEventListener('keydown', event => {
				if (event.key === 'Enter' && !event.shiftKey) {
					const block = getActiveBlock();
					if (block?.tagName === 'P' || block?.tagName?.startsWith('H')) {
						event.preventDefault();
						const next = document.createElement('p');
						next.className = 'md-block';
						next.setAttribute('data-md-type', 'paragraph');
						next.setAttribute('data-dirty', 'true');
						next.contentEditable = 'true';
						next.append(document.createElement('br'));
						block.after(next);
						next.focus();
						postEdit();
					}
				}
			});

			document.querySelectorAll('[data-command]').forEach(button => {
				button.addEventListener('click', () => applyInlineCommand(button.getAttribute('data-command')));
			});
			blockFormat.addEventListener('change', () => {
				applyBlockFormat(blockFormat.value);
				blockFormat.value = 'paragraph';
			});

			window.addEventListener('message', event => {
				const message = event.data;
				if (message.type !== 'update') {
					return;
				}
				markdownText = message.text;
				applyingExternalUpdate = true;
				renderBlocks(parseMarkdown(message.text));
				applyingExternalUpdate = false;
			});

			renderBlocks(parseMarkdown(initialText));
		})();
	</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, character => {
		switch (character) {
			case '&': return '&amp;';
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '"': return '&quot;';
			case '\'': return '&#39;';
			default: return character;
		}
	});
}

function toScriptLiteral(value: unknown): string {
	return (JSON.stringify(value) ?? 'null').replace(/[<>&\u2028\u2029]/g, character => {
		switch (character) {
			case '<': return '\\u003c';
			case '>': return '\\u003e';
			case '&': return '\\u0026';
			case '\u2028': return '\\u2028';
			case '\u2029': return '\\u2029';
			default: return character;
		}
	});
}
