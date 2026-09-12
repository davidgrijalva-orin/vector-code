/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../../base/browser/dom.js';
import { deepStrictEqual, strictEqual } from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { localize2 } from '../../../../../nls.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IVectorGraphService, IVectorGraphTicket, IVectorGraphTicketPage, IVectorGraphDiscovery, IVectorGraphWorkspace } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IViewContainerModel, IViewDescriptorService, ViewContainerLocation } from '../../../../common/views.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IVectorGraphWorkService } from '../../common/vectorGraphWork.js';
import { IVectorCodeWorkbenchService } from '../../common/vectorCode.js';
import { VectorGraphTicketsView } from '../../browser/vectorGraphTickets.contribution.js';

suite('VectorGraph tickets view pagination', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const viewId = 'vectorCode.vectorGraphTickets';
	const alpha = URI.file('/alpha');
	const beta = URI.file('/beta');
	let active: URI;
	let storage: IStorageService;
	let discovery: IVectorGraphDiscovery;
	let workspaces: readonly IVectorGraphWorkspace[];
	let sessionChanged: Emitter<void>;
	let changed: Emitter<URI | undefined>;
	let root: HTMLElement;
	let requests: { workspace: string; team: string; cursor: string | undefined; project?: string; assignee?: string; response: DeferredPromise<IVectorGraphTicketPage> }[];

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

	setup(async () => {
		active = alpha;
		discovery = { bindings: [], incomplete: false };
		workspaces = [alpha, beta].map(project => ({ id: project.path, name: project.path }));
		sessionChanged = store.add(new Emitter<void>());
		requests = [];
		changed = store.add(new Emitter<URI | undefined>());
		const instantiation = workbenchInstantiationService({}, store);
		instantiation.stub(IVectorGraphWorkService, { onDidChange: Event.None, getActive: () => undefined });
		instantiation.stub(IVectorCodeWorkbenchService, {
			onDidChangeActiveProject: changed.event,
			getActiveProjectUri: () => active,
			getProjectSummaries: () => [],
			getProjectStatusLabel: () => ''
		});
		instantiation.stub(IVectorGraphService, {
			onDidChangeSession: sessionChanged.event, onDidChangeTickets: Event.None,
			getTeamMetadata: async () => ({ statuses: [], members: [] }),
			getSession: async () => ({ workspaces }),
			discoverRepository: async () => discovery,
			listTickets: (workspace: string, team: string, cursor?: string, project?: string, assignee?: string) => {
				const response = new DeferredPromise<IVectorGraphTicketPage>();
				requests.push({ workspace, team, cursor, project, assignee, response });
				return response.p;
			}
		});
		const container = { id: 'workbench.view.explorer', title: localize2('testExplorer', 'Explorer'), ctorDescriptor: new SyncDescriptor(VectorGraphTicketsView) };
		const descriptor = { id: viewId + '.list', name: localize2('testWork', 'Work'), ctorDescriptor: new SyncDescriptor(VectorGraphTicketsView) };
		instantiation.stub(IViewDescriptorService, {
			getViewLocationById: () => ViewContainerLocation.Sidebar,
			onDidChangeLocation: Event.None,
			getViewDescriptorById: () => descriptor,
			getViewContainerByViewId: () => container,
			getViewContainerModel: () => ({ onDidChangeContainerInfo: Event.None } as IViewContainerModel),
			getDefaultContainerById: () => container
		});
		storage = instantiation.get(IStorageService);
		for (const project of [alpha, beta]) {
			storage.store('vectorCode.vectorGraph.binding.' + project.toString(), {
				workspace: { id: project.path, name: project.path }, team: { id: 'team', name: 'Team', identifier: 'VC' }, project: { id: 'project', name: 'Project' }
			}, StorageScope.PROFILE, StorageTarget.MACHINE);
		}
		const view = store.add(instantiation.createInstance(descriptor.ctorDescriptor.ctor, { id: descriptor.id, title: 'Tickets' })) as ViewPane;
		view.setVisible(true);
		view.render();
		root = view.element;
		await timeout(0);
		strictEqual(requests.length, 1);
	});

	test('defaults to the linked project and makes whole-team scope explicit', async () => {
		strictEqual(requests[0].project, 'project');
		await requests[0].response.complete({ tickets: [] });
		const scope = root.querySelector<HTMLSelectElement>('select[aria-label="Ticket scope"]')!; scope.value = 'team'; scope.dispatchEvent(new (getWindow(root).Event)('change'));
		await timeout(0); strictEqual(requests[1].project, undefined); await requests[1].response.complete({ tickets: [] });
	});

	test('selects and remembers the single complete repository mapping', async () => {
		await requests[0].response.complete({ tickets: [] });
		storage.remove('vectorCode.vectorGraph.binding.' + alpha.toString(), StorageScope.PROFILE);
		discovery = { incomplete: false, bindings: [{ workspace: { id: '/alpha', name: 'Alpha' }, team: { id: 'mapped-team', name: 'Mapped', identifier: 'MAP' } }] };
		changed.fire(active);
		await timeout(0);
		strictEqual(requests.length, 1);
		strictEqual(root.textContent?.includes('Choose Project'), true);
		const scope = root.querySelector<HTMLSelectElement>('select[aria-label="Ticket scope"]')!; scope.value = 'team'; scope.dispatchEvent(new (getWindow(root).Event)('change'));
		await timeout(0);
		strictEqual(requests[1].team, 'mapped-team');
		strictEqual(storage.getObject<{ team: { id: string } }>('vectorCode.vectorGraph.binding.' + alpha.toString(), StorageScope.PROFILE)?.team.id, 'mapped-team');
		await requests[1].response.complete({ tickets: [] });
	});

	test('does not guess a workspace from ambiguous or incomplete mappings', async () => {
		await requests[0].response.complete({ tickets: [] });
		storage.remove('vectorCode.vectorGraph.binding.' + alpha.toString(), StorageScope.PROFILE);
		const binding = { workspace: { id: '/alpha', name: 'Alpha' }, team: { id: 'mapped-team', name: 'Mapped', identifier: 'MAP' } };
		discovery = { incomplete: false, bindings: [binding, { ...binding, team: { ...binding.team, id: 'other-team' } }] };
		sessionChanged.fire();
		await timeout(0);
		strictEqual(requests.length, 1);
		strictEqual(root.querySelector('[role="status"]')?.textContent?.includes('multiple teams'), true);
		discovery = { incomplete: true, bindings: [binding] };
		sessionChanged.fire();
		await timeout(0);
		strictEqual(requests.length, 1);
		strictEqual(storage.getObject('vectorCode.vectorGraph.binding.' + alpha.toString(), StorageScope.PROFILE), undefined);
	});

	test('sign-out clears visible tickets and rejects an in-flight page', async () => {
		await requests[0].response.complete({ tickets: [ticket('VC-1')], nextCursor: 'next' });
		button('Load more tickets').click();
		await timeout(0);
		workspaces = [];
		sessionChanged.fire();
		await timeout(0);
		await requests[1].response.complete({ tickets: [ticket('VC-2')] });
		deepStrictEqual(identifiers(), []);
		strictEqual(button('Sign in to VectorGraph').hidden, false);
	});

	test('loads the next page once, updates duplicates, and hides the exhausted control', async () => {
		await requests[0].response.complete({ tickets: [ticket('VC-1')], nextCursor: 'page-2' });
		const more = button('Load more tickets');
		strictEqual(more.hidden, false);
		more.click();
		more.click();
		await timeout(0);
		strictEqual(requests.length, 2);
		strictEqual(more.disabled, true);
		deepStrictEqual([requests[1].workspace, requests[1].team, requests[1].cursor], ['/alpha', 'team', 'page-2']);
		await requests[1].response.complete({ tickets: [ticket('VC-1', 'Updated title'), ticket('VC-2')] });
		deepStrictEqual(identifiers(), ['VC-1', 'VC-2']);
		strictEqual(root.querySelector('.vector-graph-tickets__title')?.textContent, 'Updated title');
		strictEqual(more.hidden, true);
		strictEqual(root.querySelector('[role="status"]')?.textContent, '/alpha / Project · 2 tickets loaded');
	});

	test('preserves the first page after failure and retries the same cursor', async () => {
		await requests[0].response.complete({ tickets: [ticket('VC-1')], nextCursor: 'page-2' });
		button('Load more tickets').click();
		await timeout(0);
		await requests[1].response.error(new Error('Temporary failure'));
		deepStrictEqual(identifiers(), ['VC-1']);
		strictEqual(root.querySelector('[role="status"]')?.textContent, 'Temporary failure');
		strictEqual(button('Load more tickets').disabled, false);
		button('Load more tickets').click();
		await timeout(0);
		strictEqual(requests[2].cursor, 'page-2');
		await requests[2].response.complete({ tickets: [ticket('VC-2')] });
		deepStrictEqual(identifiers(), ['VC-1', 'VC-2']);
	});

	test('discards a pending page after switching projects', async () => {
		await requests[0].response.complete({ tickets: [ticket('VC-1')], nextCursor: 'page-2' });
		button('Load more tickets').click();
		await timeout(0);
		active = beta;
		changed.fire(active);
		await timeout(0);
		strictEqual(requests.length, 3);
		strictEqual(requests[2].workspace, '/beta');
		strictEqual(requests[2].cursor, undefined);
		await requests[2].response.complete({ tickets: [ticket('B-1')] });
		await requests[1].response.complete({ tickets: [ticket('VC-2')], nextCursor: 'page-3' });
		deepStrictEqual(identifiers(), ['B-1']);
		strictEqual(button('Load more tickets').hidden, true);
		strictEqual(root.querySelector('[role="status"]')?.textContent, '/beta / Project · 1 tickets loaded');
	});
});
