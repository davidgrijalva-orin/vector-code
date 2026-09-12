/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual, throws, rejects } from 'assert';
import { Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IVectorGraphService, filterVectorGraphTickets, parseVectorGraphTicketDetail, parseVectorGraphTicketPage, vectorGraphRepositoryIdentity } from '../../common/vectorGraph.js';
import { VectorGraphChannel } from '../../common/vectorGraphIpc.js';

suite('VectorGraph ticket contracts', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const issue = { identifier: 'VC-52', title: 'Ticket view', statusName: 'Todo', statusCategory: 'unstarted', priority: 'high', projectName: 'Workbench', description: 'Keep the project flow.', credential: 'must-not-cross-ipc' };

	test('normalizes equivalent GitHub remotes without matching other hosts or paths', () => {
		for (const remote of ['git@github.com:Orin/Vector.git', 'https://github.com/orin/vector.git', 'ssh://git@github.com/orin/vector']) {
			strictEqual(vectorGraphRepositoryIdentity(remote), 'orin/vector');
		}
		for (const remote of ['https://evil.test/orin/vector', 'file:///orin/vector', 'https://github.com/orin/vector/issues', 'https://github.com/orin/vector?token=secret', '/orin/vector']) {
			strictEqual(vectorGraphRepositoryIdentity(remote), undefined);
		}
	});

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

	test('IPC exposes explicit operations but cannot invoke private helpers', async () => {
		const calls: string[] = [];
		const service: IVectorGraphService = {
			_serviceBrand: undefined,
			onDidChangeSession: Event.None,
			onDidChangeTickets: Event.None,
			listProjects: async () => [], getTeamMetadata: async () => ({ statuses: [], members: [] }),
			createTicket: async () => 'VC-57', updateTicket: async () => { }, addComment: async () => { }, linkPullRequest: async () => { },
			getRepositoryState: async () => ({ head: '', branch: '', changes: [] }), createBranch: async () => { },
			getSession: async () => ({ workspaces: [] }),
			beginSignIn: async () => ({ workspaces: [] }),
			pollSignIn: async () => ({ workspaces: [] }),
			cancelSignIn: async () => { },
			signOut: async () => { },
			discoverRepository: async () => ({ bindings: [], incomplete: false }),
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
		for (const operation of ['getRepositoryState', 'createBranch', 'discoverRepository']) { await rejects(channel.call('window:1', operation, ['file:///outside']), /access is unavailable/); }
		const authorizations: unknown[][] = [];
		const scoped = new VectorGraphChannel(service, async (...args) => { authorizations.push(args); throw new Error('Denied'); });
		await rejects(scoped.call('window:1', 'createBranch', ['file:///outside', 'branch', 'head']), /Denied/);
		await rejects(scoped.call('window:1', 'linkPullRequest', ['workspace', 'VC-57', 'file:///outside', 'url', 'key']), /Denied/);
		deepStrictEqual(authorizations, [['window:1', 'file:///outside', true], ['window:1', 'file:///outside', false]]);
	});
});
