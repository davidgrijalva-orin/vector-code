/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { localize } from '../../../../nls.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
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
