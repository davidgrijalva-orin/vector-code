/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IVectorGraphService, IVectorGraphTicket, IVectorGraphTicketPage } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { Extensions, IViewContainerModel, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainerLocation } from '../../../../common/views.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IVectorCodeWorkbenchService } from '../../common/vectorCode.js';
import '../../browser/vectorGraphTickets.contribution.js';

suite('VectorGraph tickets view pagination', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const viewId = 'vectorCode.vectorGraphTickets';
	const alpha = URI.file('/alpha');
	const beta = URI.file('/beta');
	let active: URI;
	let changed: Emitter<URI | undefined>;
	let root: HTMLElement;
	let requests: { workspace: string; team: string; cursor: string | undefined; response: DeferredPromise<IVectorGraphTicketPage> }[];

	function ticket(identifier: string, title = identifier): IVectorGraphTicket {
		return { identifier, title, status: 'Todo', category: 'unstarted', priority: 'high', project: '' };
	}

	function button(label: string): HTMLButtonElement {
		const result = [...root.querySelectorAll('button')].find(button => button.textContent === label);
		if (!result) { throw new Error(`Missing button: ${label}`); }
		return result;
	}

	function identifiers(): (string | null)[] {
		return [...root.querySelectorAll('[data-ticket]')].map(button => button.getAttribute('data-ticket'));
	}

	setup(() => {
		active = alpha;
		requests = [];
		changed = store.add(new Emitter<URI | undefined>());
		const instantiation = workbenchInstantiationService({}, store);
		instantiation.stub(IVectorCodeWorkbenchService, {
			onDidChangeActiveProject: changed.event,
			getActiveProjectUri: () => active,
			getProjectSummaries: () => [],
			getProjectStatusLabel: () => ''
		});
		instantiation.stub(IVectorGraphService, {
			listTickets: (workspace: string, team: string, cursor?: string) => {
				const response = new DeferredPromise<IVectorGraphTicketPage>();
				requests.push({ workspace, team, cursor, response });
				return response.p;
			}
		});
		const container = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).get(viewId)!;
		const descriptor = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).getViews(container).find(view => view.id === viewId + '.list')!;
		instantiation.stub(IViewDescriptorService, {
			getViewLocationById: () => ViewContainerLocation.Sidebar,
			onDidChangeLocation: Event.None,
			getViewDescriptorById: () => descriptor,
			getViewContainerByViewId: () => container,
			getViewContainerModel: () => ({ onDidChangeContainerInfo: Event.None } as IViewContainerModel),
			getDefaultContainerById: () => container
		});
		const storage = instantiation.get(IStorageService);
		for (const project of [alpha, beta]) {
			storage.store('vectorCode.vectorGraph.binding.' + project.toString(), {
				workspace: { id: project.path, name: project.path }, team: { id: 'team', name: 'Team', identifier: 'VC' }
			}, StorageScope.PROFILE, StorageTarget.MACHINE);
		}
		const view = store.add(instantiation.createInstance(descriptor.ctorDescriptor.ctor, { id: descriptor.id, title: 'Tickets' })) as ViewPane;
		view.setVisible(true);
		view.render();
		root = view.element;
		strictEqual(requests.length, 1);
	});

	test('loads the next page once, updates duplicates, and hides the exhausted control', async () => {
		await requests[0].response.complete({ tickets: [ticket('VC-1')], nextCursor: 'page-2' });
		const more = button('Load more tickets');
		strictEqual(more.hidden, false);
		more.click();
		more.click();
		strictEqual(requests.length, 2);
		strictEqual(more.disabled, true);
		deepStrictEqual([requests[1].workspace, requests[1].team, requests[1].cursor], ['/alpha', 'team', 'page-2']);
		await requests[1].response.complete({ tickets: [ticket('VC-1', 'Updated title'), ticket('VC-2')] });
		deepStrictEqual(identifiers(), ['VC-1', 'VC-2']);
		strictEqual(root.querySelector('.vector-graph-tickets__title')?.textContent, 'Updated title');
		strictEqual(more.hidden, true);
		strictEqual(root.querySelector('[role="status"]')?.textContent, '/alpha / Team · 2 tickets loaded');
	});

	test('preserves the first page after failure and retries the same cursor', async () => {
		await requests[0].response.complete({ tickets: [ticket('VC-1')], nextCursor: 'page-2' });
		button('Load more tickets').click();
		await requests[1].response.error(new Error('Temporary failure'));
		deepStrictEqual(identifiers(), ['VC-1']);
		strictEqual(root.querySelector('[role="status"]')?.textContent, 'Temporary failure');
		strictEqual(button('Load more tickets').disabled, false);
		button('Load more tickets').click();
		strictEqual(requests[2].cursor, 'page-2');
		await requests[2].response.complete({ tickets: [ticket('VC-2')] });
		deepStrictEqual(identifiers(), ['VC-1', 'VC-2']);
	});

	test('discards a pending page after switching projects', async () => {
		await requests[0].response.complete({ tickets: [ticket('VC-1')], nextCursor: 'page-2' });
		button('Load more tickets').click();
		active = beta;
		changed.fire(active);
		strictEqual(requests.length, 3);
		strictEqual(requests[2].workspace, '/beta');
		strictEqual(requests[2].cursor, undefined);
		await requests[2].response.complete({ tickets: [ticket('B-1')] });
		await requests[1].response.complete({ tickets: [ticket('VC-2')], nextCursor: 'page-3' });
		deepStrictEqual(identifiers(), ['B-1']);
		strictEqual(button('Load more tickets').hidden, true);
		strictEqual(root.querySelector('[role="status"]')?.textContent, '/beta / Team · 1 tickets loaded');
	});
});
