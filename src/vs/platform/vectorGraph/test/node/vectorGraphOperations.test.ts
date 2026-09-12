/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual, throws } from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { authorizeVectorGraphRepository } from '../../node/vectorGraphRepositoryAccess.js';
import { VectorGraphOperations, getVectorGraphRepositoryState, createVectorGraphBranch } from '../../node/vectorGraphOperations.js';
import { validateVectorGraphPatch, vectorGraphPullRequest } from '../../common/vectorGraphWork.js';

suite('VectorGraph work operations', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const workspace = 'bf275fab-fe03-44c3-b993-ced522c45a07';
	const team = '658d2b51-5118-46d4-8b60-bf1954501284';
	const project = '1c084781-df5b-46d4-81b5-e3b8100c93e6';
	const key = '01a09380-3fca-76d3-948c-aa88fe512a27';
	test('document writes preserve revision checks, project links and retry identity', async () => {
		const calls: unknown[][] = [];
		const document = { id: project, title: 'Design', body: '# Content', teamId: team, links: [{ targetType: 'project', targetId: project }], revisionNumber: 3, versionNumber: 2, updatedAt: '' };
		const service = new VectorGraphOperations(async (...args) => { calls.push(args); return { document }; });
		deepStrictEqual((await service.createDocument(workspace, team, project, 'Design', key)).projectIds, [project]);
		const save = { body: '# Updated', expectedRevisionNumber: 3, expectedVersionNumber: 2 };
		await service.saveDocument(workspace, project, save, key);
		deepStrictEqual(calls[0], [workspace, 'createApiWorkspaceDocument', {}, {}, { title: 'Design', body: '', teamId: team, links: [{ targetType: 'project', targetId: project }] }, key]);
		deepStrictEqual(calls[1], [workspace, 'updateApiWorkspaceDocument', {}, { documentId: project }, { ...save, saveMode: 'versioned' }, key]);
		await rejects(service.saveDocument(workspace, project, { ...save, expectedRevisionNumber: 0 }, key));
		await rejects(service.saveDocument(workspace, project, { ...save, operation: 'delete' } as typeof save, key));
		strictEqual(calls.length, 2);
		await rejects(new VectorGraphOperations(async () => ({ document, error: { code: 'document_version_conflict' } })).saveDocument(workspace, project, save, key), /changed on VectorGraph/);
	});
	test('notes use the existing create API with no project links and retain explicit team scope', async () => {
		const calls: unknown[][] = [];
		const document = { id: project, title: 'Note', body: '', teamId: team, links: [], revisionNumber: 1, versionNumber: 1, updatedAt: '' };
		const service = new VectorGraphOperations(async (...args) => { calls.push(args); return { document }; });
		deepStrictEqual((await service.createDocument(workspace, team, undefined, 'Note', key)).projectIds, []);
		deepStrictEqual(calls[0], [workspace, 'createApiWorkspaceDocument', {}, {}, { title: 'Note', body: '', teamId: team, links: [] }, key]);
		await rejects(service.createDocument(workspace, team, '', 'Note', key));
		await rejects(service.createDocument(workspace, '', undefined, 'Note', key));
		strictEqual(calls.length, 1);
	});
	test('repository access rejects outside roots, missing trust, and symlink escapes', async () => {
		const directory = await fs.mkdtemp(join(tmpdir(), 'vg-access-'));
		try {
			const first = URI.file(join(directory, 'first')); const second = URI.file(join(directory, 'second'));
			await fs.mkdir(first.fsPath); await fs.mkdir(second.fsPath);
			strictEqual(await authorizeVectorGraphRepository(second.toString(), [first, second], [URI.file(directory)]), URI.file(await fs.realpath(second.fsPath)).toString());
			await rejects(authorizeVectorGraphRepository(second.toString(), [first]), /not an open/);
			await rejects(authorizeVectorGraphRepository(first.toString(), [first, second], [first]), /Trust every/);
			await rejects(authorizeVectorGraphRepository(first.toString(), [first], []), /Trust every/);
			await fs.symlink(second.fsPath, join(first.fsPath, 'escape'), 'junction');
			await rejects(authorizeVectorGraphRepository(URI.file(join(first.fsPath, 'escape')).toString(), [first], [first]), /not an open/);
			await rejects(authorizeVectorGraphRepository('https://example.com/repo', [first]), /local workspace/);
		} finally { await fs.rm(directory, { recursive: true, force: true }); }
	});
	test('projects are filtered by explicit team membership', async () => {
		const service = new VectorGraphOperations(async () => ({ projects: [{ id: project, name: 'Selected', teams: [{ id: team }] }, { id: workspace, name: 'Other', teams: [] }] }));
		deepStrictEqual(await service.listProjects(workspace, team), [{ id: project, name: 'Selected' }]);
	});
	test('writes carry only validated fields and preserve the caller request ID', async () => {
		const calls: unknown[][] = [];
		const service = new VectorGraphOperations(async (...args) => { calls.push(args); return { issue: { identifier: 'VC-57' } }; });
		const draft = { title: 'Ticket', teamId: team, projectId: project };
		strictEqual(await service.createTicket(workspace, draft, key), 'VC-57');
		await service.updateTicket(workspace, 'VC-57', { title: 'Edited' }, key);
		await service.addComment(workspace, 'VC-57', 'Comment', key);
		deepStrictEqual(calls[0], [workspace, 'createApiIssue', {}, {}, draft, key]);
		deepStrictEqual(calls[1], [workspace, 'updateApiIssue', {}, { issueIdentifier: 'VC-57' }, { title: 'Edited' }, key]);
		deepStrictEqual(calls[2], [workspace, 'createApiIssueComment', {}, { issueIdentifier: 'VC-57' }, { body: 'Comment' }, key]);
		await rejects(service.addComment(workspace, 'VC-57', ' ', key));
		strictEqual(calls.length, 3);
	});
	test('rejects arbitrary write payloads and unrelated PR links', () => {
		for (const value of [{ operation: 'archiveApiIssue' }, { title: '' }, { statusId: 'wrong' }, { assigneeUserId: {} }, { priority: 'super' }]) { throws(() => validateVectorGraphPatch(value)); }
		throws(() => validateVectorGraphPatch({ title: 'Missing project', teamId: team }, true));
		strictEqual(vectorGraphPullRequest('https://github.com/owner/repo/pull/12', 'owner/repo'), 'https://github.com/owner/repo/pull/12');
		for (const url of ['http://github.com/owner/repo/pull/12', 'https://github.com/other/repo/pull/12', 'https://github.com/owner/repo/issues/12', 'https://user@github.com/owner/repo/pull/12']) { throws(() => vectorGraphPullRequest(url, 'owner/repo')); }
	});
	test('creates only a new branch from the reviewed clean repository state', async () => {
		const path = await fs.mkdtemp(join(tmpdir(), 'vc57-git-'));
		const git = (...args: string[]) => promisify(execFile)('git', ['-C', path, ...args]);
		try {
			await git('init', '-b', 'main'); await git('config', 'user.name', 'VectorCode Test'); await git('config', 'user.email', 'test@example.invalid');
			await fs.writeFile(join(path, 'file.txt'), 'first'); await git('add', 'file.txt'); await git('commit', '-m', 'fixture');
			const uri = URI.file(path).toString(); const before = await getVectorGraphRepositoryState(uri);
			await fs.writeFile(join(path, 'file.txt'), 'unsaved work');
			await rejects(createVectorGraphBranch(uri, 'codex/vc-57', before.head), /uncommitted/);
			strictEqual((await getVectorGraphRepositoryState(uri)).branch, 'main'); strictEqual(await fs.readFile(join(path, 'file.txt'), 'utf8'), 'unsaved work');
			await fs.writeFile(join(path, 'file.txt'), 'first');
			await rejects(createVectorGraphBranch(uri, '--bad', before.head), /Invalid/);
			await rejects(createVectorGraphBranch(uri, 'codex/vc-57', '0'.repeat(40)), /changed/);
			await createVectorGraphBranch(uri, 'codex/vc-57', before.head);
			strictEqual((await getVectorGraphRepositoryState(uri)).branch, 'codex/vc-57');
			await rejects(createVectorGraphBranch(uri, 'codex/vc-57', before.head));
		} finally { await fs.rm(path, { recursive: true, force: true }); }
	});
});
