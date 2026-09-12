/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../../base/browser/dom.js';
import { deepStrictEqual, strictEqual } from 'assert';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { timeout } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IVectorGraphService, IVectorGraphTicketDetail } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorGraphWorkService, IVectorGraphSelection, IVectorGraphActiveTicket } from '../../common/vectorGraphWork.js';
import { IVectorCodeWorkbenchService } from '../../common/vectorCode.js';
import { VectorGraphTicketDetails } from '../../browser/vectorGraphTicketDetails.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('VectorGraph editable ticket details', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const workspace = 'bf275fab-fe03-44c3-b993-ced522c45a07';
	const team = '658d2b51-5118-46d4-8b60-bf1954501284';
	const projectId = '1c084781-df5b-46d4-81b5-e3b8100c93e6';
	const selection: IVectorGraphSelection = { workspace, identifier: 'VC-57', project: URI.file('/project').toString() };
	let root: HTMLElement; let details: VectorGraphTicketDetails; let storage: IStorageService;
	let ticket: IVectorGraphTicketDetail; let writes: { kind: string; args: unknown[] }[]; let fail: boolean; let active: IVectorGraphActiveTicket | undefined;
	let sessionChanged: Emitter<void>;
	function button(label: string): HTMLButtonElement { const button = [...root.querySelectorAll('button')].find(value => value.textContent === label); if (!button) { throw new Error('Missing ' + label); } return button; }
	function field(label: string, value: string): void { const input = root.querySelector<HTMLInputElement>('[aria-label="' + label + '"]')!; input.value = value; input.dispatchEvent(new (getWindow(root).Event)('input')); }
	async function click(label: string): Promise<void> { button(label).click(); await timeout(0); }
	setup(() => {
		writes = []; fail = false; active = undefined;
		sessionChanged = store.add(new Emitter<void>());
		ticket = { identifier: 'VC-57', title: 'Original', status: 'Todo', statusId: team, teamId: team, category: 'unstarted', priority: 'high', project: 'Project', description: 'Description', comments: [], updatedAt: 'first' };
		const instantiation = workbenchInstantiationService({}, store);
		storage = instantiation.get(IStorageService);
		instantiation.stub(IVectorCodeWorkbenchService, { getActiveProjectUri: () => URI.file('/project') });
		instantiation.stub(IVectorGraphWorkService, { getActive: () => active, setActive: (_project: string, value: IVectorGraphActiveTicket) => { active = value; }, select: () => { } });
		instantiation.stub(IVectorGraphService, {
			onDidChangeSession: sessionChanged.event, onDidChangeTickets: Event.None,
			getTicket: async () => ({ ...ticket }),
			getTeamMetadata: async () => ({ statuses: [{ id: team, name: 'Todo', category: 'unstarted' }], members: [] }),
			updateTicket: async (...args: unknown[]) => { writes.push({ kind: 'update', args }); ticket = { ...ticket, updatedAt: 'saved' }; if (fail) { throw new Error('Connection interrupted'); } },
			createTicket: async (...args: unknown[]) => { writes.push({ kind: 'create', args }); return 'VC-58'; },
			addComment: async (...args: unknown[]) => { writes.push({ kind: 'comment', args }); if (fail) { throw new Error('Connection interrupted'); } },
			getRepositoryState: async () => ({ branch: 'main', head: '0'.repeat(40), changes: [' M file.ts'] })
		});
		root = document.createElement('div'); details = store.add(instantiation.createInstance(VectorGraphTicketDetails, root));
	});
	test('editing retains drafts when navigating away and only saves on explicit action', async () => {
		await details.show(selection); await click('Edit Ticket'); field('Title', 'Draft title');
		await details.show(undefined); strictEqual(writes.length, 0);
		await details.show(selection); await click('Edit Ticket');
		strictEqual(root.querySelector<HTMLInputElement>('[aria-label="Title"]')!.value, 'Draft title');
		await click('Save Changes'); strictEqual(writes.length, 1); strictEqual((writes[0].args[2] as { title: string }).title, 'Draft title');
	});
	test('retry after an uncertain update reuses the request ID despite server timestamp changing', async () => {
		await details.show(selection); await click('Edit Ticket'); field('Title', 'Edited'); fail = true; await click('Save Changes');
		fail = false; await click('Save Changes'); strictEqual(writes.length, 2); strictEqual(writes[0].args[3], writes[1].args[3]);
	});
	test('a remote edit blocks a first save and preserves the draft', async () => {
		await details.show(selection); await click('Edit Ticket'); field('Title', 'My draft'); ticket = { ...ticket, updatedAt: 'someone-else' };
		await click('Save Changes'); strictEqual(writes.length, 0); strictEqual(root.textContent?.includes('changed on VectorGraph'), true);
		strictEqual(storage.getObject<{ title: string }>('vectorGraph.draft.' + workspace + '.VC-57', StorageScope.PROFILE)?.title, 'My draft');
		await click('Back (Keep Draft)'); await click('Edit Ticket'); await click('Apply Draft to Reviewed Version');
		strictEqual(root.querySelector<HTMLInputElement>('[aria-label="Title"]')!.value, 'My draft');
		await click('Save Changes'); strictEqual(writes.length, 1);
	});
	test('creates tickets in the explicitly linked project', async () => {
		await details.show({ ...selection, identifier: undefined, binding: { workspace: { id: workspace, name: 'Workspace' }, team: { id: team, name: 'Team', identifier: 'VC' }, project: { id: projectId, name: 'Project' } } });
		field('Title', 'New work'); await click('Create Ticket'); strictEqual(writes[0].kind, 'create'); strictEqual((writes[0].args[1] as { projectId: string }).projectId, projectId);
	});
	test('posting comments retains retry identity and clears the draft only on success', async () => {
		await details.show(selection); field('Add a comment', 'Comment draft'); fail = true; await click('Post Comment'); fail = false; await click('Post Comment');
		deepStrictEqual(writes.map(value => value.kind), ['comment', 'comment']); strictEqual(writes[0].args[3], writes[1].args[3]); strictEqual(storage.get('vectorGraph.comment.' + workspace + '.VC-57', StorageScope.PROFILE), undefined);
	});
	test('selection does not start work; Start Work shows branch and changed files', async () => {
		await details.show(selection); strictEqual(active, undefined); await click('Start Work'); strictEqual((active as IVectorGraphActiveTicket | undefined)?.identifier, 'VC-57'); strictEqual(root.textContent?.includes('main · 1 changed files'), true); strictEqual(root.textContent?.includes('file.ts'), true); strictEqual(writes.length, 0);
	});
});
