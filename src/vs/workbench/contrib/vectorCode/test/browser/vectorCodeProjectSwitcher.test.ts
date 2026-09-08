/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { VectorCodeProjectSwitcher } from '../../browser/vectorCodeProjectSwitcher.js';
import { IVectorCodeProjectSummary } from '../../common/vectorCode.js';
import '../../browser/media/vectorCode.css';

suite('VectorCodeProjectSwitcher', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const alpha: IVectorCodeProjectSummary = { name: 'Alpha', uri: URI.file('/alpha'), uriLabel: '/alpha' };
	const beta: IVectorCodeProjectSummary = { name: 'Beta', uri: URI.file('/beta'), uriLabel: '/beta' };
	let container: HTMLElement;
	let switcher: VectorCodeProjectSwitcher;
	let select: (project: IVectorCodeProjectSummary) => Promise<unknown>;
	let close: (project: IVectorCodeProjectSummary) => Promise<unknown>;
	let errors: string[];

	setup(() => {
		container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		select = async () => { };
		close = async () => { };
		errors = [];
		switcher = disposables.add(new VectorCodeProjectSwitcher(container, {
			add: async () => { },
			select: project => select(project),
			close: project => close(project),
			onError: message => errors.push(message)
		}));
		switcher.update([alpha, beta], alpha.uri, '2 projects');
	});

	function button(label: string): HTMLButtonElement {
		const result = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label);
		if (!result) {
			throw new Error(`Missing button: ${label}`);
		}
		return result;
	}

	test('active project updates retain the focused control and expose selection', () => {
		const focused = button('Select Beta');
		focused.focus();
		switcher.update([alpha, beta], beta.uri, '2 projects');
		strictEqual(button('Select Beta'), focused);
		strictEqual(mainWindow.document.activeElement, focused);
		strictEqual(focused.getAttribute('aria-pressed'), 'true');
		strictEqual(button('Select Alpha').getAttribute('aria-pressed'), 'false');
	});

	test('workspace reorder and rename preserve focus and update action targets', async () => {
		const focused = button('Close Beta');
		focused.focus();
		const renamed = { ...beta, name: 'Renamed Beta', uriLabel: '/renamed-label' };
		let closed: IVectorCodeProjectSummary | undefined;
		close = async project => { closed = project; };
		switcher.update([renamed, alpha], beta.uri, '2 projects');
		strictEqual(mainWindow.document.activeElement, focused);
		strictEqual(button('Close Renamed Beta'), focused);
		focused.click();
		await Promise.resolve();
		strictEqual(closed, renamed);
		deepStrictEqual([...container.querySelectorAll('.vector-code-project-switcher__project-name')].map(node => node.textContent), ['Renamed Beta', 'Alpha']);
	});

	test('removing the focused project focuses its neighbor then Add Project when empty', () => {
		button('Close Alpha').focus();
		switcher.update([beta], beta.uri, '1 project');
		strictEqual(mainWindow.document.activeElement, button('Select Beta'));
		switcher.update([], undefined, 'No projects');
		strictEqual(mainWindow.document.activeElement, button('Add Project'));
		strictEqual(container.querySelector<HTMLElement>('.vector-code-project-switcher__empty')!.hidden, false);
	});

	test('removal after reordering follows the visible project order', () => {
		const gamma = { name: 'Gamma', uri: URI.file('/gamma'), uriLabel: '/gamma' };
		switcher.update([alpha, beta, gamma], alpha.uri, '3 projects');
		switcher.update([gamma, alpha, beta], alpha.uri, '3 projects');
		button('Close Alpha').focus();
		switcher.update([gamma, beta], beta.uri, '2 projects');
		strictEqual(mainWindow.document.activeElement, button('Select Beta'));
	});

	test('long names leave select and close targets inside a narrow project row', async () => {
		await Promise.all([...mainWindow.document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(link => link.sheet ? Promise.resolve() : new Promise<void>((resolve, reject) => {
			link.addEventListener('load', () => resolve(), { once: true });
			link.addEventListener('error', () => reject(new Error(`Failed to load ${link.href}`)), { once: true });
		})));
		container.style.width = '170px';
		container.style.height = '180px';
		const long = { ...alpha, name: 'A very long project name that must truncate', uriLabel: '/a/very/long/project/path/that/must/truncate' };
		switcher.update([long], alpha.uri, '1 project');
		const selectBounds = button(`Select ${long.name}`).getBoundingClientRect();
		const closeBounds = button(`Close ${long.name}`).getBoundingClientRect();
		const rowBounds = container.querySelector('.vector-code-project-switcher__project')!.getBoundingClientRect();
		strictEqual(selectBounds.right <= closeBounds.left, true, 'select and close must not overlap');
		strictEqual(closeBounds.top >= rowBounds.top, true, 'close target must stay below row top');
		strictEqual(closeBounds.bottom <= rowBounds.bottom, true, 'close target must stay above row bottom');
		strictEqual(selectBounds.top >= rowBounds.top, true, 'select target must stay below row top');
		strictEqual(selectBounds.bottom <= rowBounds.bottom, true, 'select target must stay above row bottom');
		strictEqual(closeBounds.right <= rowBounds.right, true, 'close target must stay inside narrow row');
	});

	test('background updates never steal editor focus', () => {
		const editor = mainWindow.document.createElement('textarea');
		container.appendChild(editor);
		editor.focus();
		switcher.update([beta], beta.uri, '1 project');
		strictEqual(mainWindow.document.activeElement, editor);
	});

	test('repeat clicks stay bounded across service updates and failures allow retry', async () => {
		const pending = new DeferredPromise<void>();
		let calls = 0;
		select = () => { calls++; return pending.p; };
		const target = button('Select Beta');
		target.focus();
		target.click();
		switcher.update([alpha, beta], beta.uri, '2 projects');
		target.click();
		strictEqual(calls, 1);
		strictEqual(target.getAttribute('aria-busy'), 'true');
		strictEqual(mainWindow.document.activeElement, target);
		await pending.error(new Error('Project unavailable'));
		await Promise.resolve();
		strictEqual(errors.length, 1);
		strictEqual(errors[0].includes('Try again.'), true);
		strictEqual(target.hasAttribute('aria-busy'), false);
		select = async () => { calls++; };
		target.click();
		await Promise.resolve();
		strictEqual(calls, 2);
	});

	test('rapid A to B to A preserves the final choice and its busy state', async () => {
		const requests: { project: string; completion: DeferredPromise<void> }[] = [];
		select = project => {
			const completion = new DeferredPromise<void>();
			requests.push({ project: project.name, completion });
			return completion.p;
		};
		button('Select Alpha').click();
		button('Select Beta').click();
		button('Select Alpha').click();
		button('Select Alpha').click();
		deepStrictEqual(requests.map(request => request.project), ['Alpha', 'Beta', 'Alpha']);
		await requests[0].completion.complete();
		strictEqual(button('Select Alpha').getAttribute('aria-busy'), 'true');
		await requests[1].completion.complete();
		await requests[2].completion.complete();
		strictEqual(button('Select Alpha').hasAttribute('aria-busy'), false);
	});

	test('a disposed view does not report a late action failure', async () => {
		const pending = new DeferredPromise<void>();
		select = () => pending.p;
		button('Select Beta').click();
		switcher.dispose();
		await pending.error(new Error('Late failure'));
		deepStrictEqual(errors, []);
	});

	test('close actions do not select the project and removed controls cannot run', async () => {
		let selected = 0;
		let closed = 0;
		select = async () => { selected++; };
		close = async () => { closed++; };
		const target = button('Close Beta');
		target.click();
		await Promise.resolve();
		strictEqual(closed, 1);
		strictEqual(selected, 0);
		switcher.update([alpha], alpha.uri, '1 project');
		target.click();
		strictEqual(closed, 1);
	});
});
