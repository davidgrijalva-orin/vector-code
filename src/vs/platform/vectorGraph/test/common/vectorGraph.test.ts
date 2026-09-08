/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual, throws, rejects } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IVectorGraphService, filterVectorGraphTickets, parseVectorGraphTicketDetail, parseVectorGraphTicketPage } from '../../common/vectorGraph.js';
import { VectorGraphChannel } from '../../common/vectorGraphIpc.js';

suite('VectorGraph ticket contracts', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const issue = { identifier: 'VC-52', title: 'Ticket view', statusName: 'Todo', statusCategory: 'unstarted', priority: 'high', projectName: 'Workbench', description: 'Keep the project flow.', credential: 'must-not-cross-ipc' };

	test('projects only ticket fields from API data and retains the next cursor', () => {
		const page = parseVectorGraphTicketPage({ issues: [issue], pageInfo: { hasNextPage: true, nextCursor: 'opaque-page-2' }, token: 'must-not-cross-ipc' });
		deepStrictEqual(page, { tickets: [{ identifier: 'VC-52', title: 'Ticket view', status: 'Todo', category: 'unstarted', priority: 'high', project: 'Workbench' }], nextCursor: 'opaque-page-2' });
	});

	test('rejects malformed pages rather than silently treating them as an empty queue', () => {
		throws(() => parseVectorGraphTicketPage({ issues: [], pageInfo: { hasNextPage: true, nextCursor: null } }));
		throws(() => parseVectorGraphTicketPage({ issues: [], pageInfo: { hasNextPage: true, nextCursor: '' } }));
		throws(() => parseVectorGraphTicketPage({ issues: [], pageInfo: {} }));
		throws(() => parseVectorGraphTicketPage({ issues: [{ ...issue, title: 7 }], pageInfo: { hasNextPage: false } }));
	});

	test('searches loaded ticket identity, title and project with status filtering', () => {
		const { tickets } = parseVectorGraphTicketPage({ issues: [issue, { ...issue, identifier: 'VC-20', title: 'Project focus', statusCategory: 'completed' }], pageInfo: { hasNextPage: false } });
		strictEqual(filterVectorGraphTickets(tickets, ' workBENCH ', 'unstarted').length, 1);
		strictEqual(filterVectorGraphTickets(tickets, 'vc-20', '')[0].identifier, 'VC-20');
		strictEqual(filterVectorGraphTickets(tickets, 'Project focus', 'unstarted').length, 0);
	});

	test('retains description and comments without extra API fields', () => {
		const ticket = parseVectorGraphTicketDetail({ issue, comments: [{ authorName: 'Reviewer', body: '<script>not executed</script>', email: 'not exported' }] });
		strictEqual(ticket.description, 'Keep the project flow.');
		deepStrictEqual(ticket.comments, [{ author: 'Reviewer', body: '<script>not executed</script>' }]);
		strictEqual(JSON.stringify(ticket).includes('must-not-cross-ipc'), false);
		strictEqual(JSON.stringify(ticket).includes('not exported'), false);
	});

	test('IPC exposes read operations but cannot invoke process or authentication helpers', async () => {
		const calls: string[] = [];
		const service: IVectorGraphService = {
			_serviceBrand: undefined,
			listWorkspaces: async () => { calls.push('workspaces'); return []; },
			listTeams: async workspace => { calls.push(workspace); return []; },
			listTickets: async () => ({ tickets: [] }),
			getTicket: async () => parseVectorGraphTicketDetail({ issue, comments: [] })
		};
		const channel = new VectorGraphChannel(service);
		await channel.call(undefined, 'listWorkspaces', []);
		await channel.call(undefined, 'listTeams', ['workspace']);
		deepStrictEqual(calls, ['workspaces', 'workspace']);
		for (const command of ['run', 'call', 'auth', 'createApiIssue', 'constructor']) {
			await rejects(channel.call(undefined, command, []), /Unsupported/);
		}
		await rejects(channel.call(undefined, 'listTickets', [{ operation: 'write' }]), /Invalid/);
	});
});
