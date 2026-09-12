/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promisify } from 'util';
import { URI } from '../../../base/common/uri.js';
import { vectorGraphRecord, vectorGraphArray, vectorGraphText, vectorGraphRepositoryIdentity } from '../common/vectorGraph.js';
import { IVectorGraphIssueDraft, IVectorGraphIssuePatch, IVectorGraphProject, IVectorGraphTeamMetadata, IVectorGraphRepositoryState, validateVectorGraphPatch, vectorGraphId, vectorGraphIdentifier, vectorGraphPullRequest } from '../common/vectorGraphWork.js';

type Call = (workspace: string, operation: string, query?: object, path?: object, body?: object, key?: string) => Promise<unknown>;
export class VectorGraphOperations {
	constructor(private readonly call: Call) { }
	async listProjects(workspace: string, team: string): Promise<readonly IVectorGraphProject[]> {
		vectorGraphId(team);
		const result = vectorGraphRecord(await this.call(workspace, 'listApiProjects'));
		return vectorGraphArray(result.projects).map(vectorGraphRecord).filter(row => vectorGraphArray(row.teams).some(value => vectorGraphRecord(value).id === team)).map(row => ({ id: vectorGraphId(row.id), name: vectorGraphText(row.name) }));
	}
	async getTeamMetadata(workspace: string, team: string): Promise<IVectorGraphTeamMetadata> {
		vectorGraphId(team);
		const result = vectorGraphRecord(await this.call(workspace, 'listApiTeams'));
		const statuses = vectorGraphRecord(result.statusesByTeam)[team];
		return {
			statuses: vectorGraphArray(statuses).map(value => { const row = vectorGraphRecord(value); return { id: vectorGraphId(row.id), name: vectorGraphText(row.name), category: vectorGraphText(row.category) }; }),
			members: vectorGraphArray(result.members).map(value => { const row = vectorGraphRecord(value); return { id: vectorGraphId(row.id), name: typeof row.name === 'string' ? row.name : vectorGraphText(row.email) }; })
		};
	}
	async createTicket(workspace: string, draft: IVectorGraphIssueDraft, requestId: string): Promise<string> {
		const body = validateVectorGraphPatch(draft, true);
		const response = vectorGraphRecord(await this.call(workspace, 'createApiIssue', {}, {}, body, vectorGraphId(requestId)));
		return vectorGraphIdentifier(vectorGraphRecord(response.issue).identifier);
	}
	async updateTicket(workspace: string, identifier: string, patch: IVectorGraphIssuePatch, requestId: string): Promise<void> {
		await this.call(workspace, 'updateApiIssue', {}, { issueIdentifier: vectorGraphIdentifier(identifier) }, validateVectorGraphPatch(patch), vectorGraphId(requestId));
	}
	async addComment(workspace: string, identifier: string, body: string, requestId: string): Promise<void> {
		if (!vectorGraphText(body).trim() || body.length > 100000) { throw new Error('Enter a comment of at most 100000 characters.'); }
		await this.call(workspace, 'createApiIssueComment', {}, { issueIdentifier: vectorGraphIdentifier(identifier) }, { body }, vectorGraphId(requestId));
	}
	async linkPullRequest(workspace: string, identifier: string, project: string, url: string, requestId: string): Promise<void> {
		const state = await getVectorGraphRepositoryState(project);
		const link = vectorGraphPullRequest(url, state.repository);
		await this.call(workspace, 'createApiIssueExternalLink', {}, { issueIdentifier: vectorGraphIdentifier(identifier) }, { url: link, linkType: 'pull_request', provider: 'github' }, vectorGraphId(requestId));
	}
}

async function git(project: string, args: string[]): Promise<string> {
	const uri = URI.parse(project);
	if (uri.scheme !== 'file' || uri.authority || !uri.path.startsWith('/') || uri.query || uri.fragment) { throw new Error('Open a local Git repository.'); }
	const env = { ...process.env, LC_ALL: 'C' };
	for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_PARAMETERS']) { delete env[name as keyof typeof env]; }
	const { stdout } = await promisify(execFile)('git', ['-C', uri.fsPath, ...args], { timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true, env });
	return stdout;
}
export async function getVectorGraphRepositoryState(project: string): Promise<IVectorGraphRepositoryState> {
	const head = (await git(project, ['rev-parse', '--verify', 'HEAD'])).trim();
	const branch = (await git(project, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	const status = (await git(project, ['status', '--porcelain=v1', '-z'])).split('\0');
	const changes: string[] = [];
	for (let i = 0; i < status.length; i++) { const row = status[i]; if (!row) { continue; } changes.push(row); if (/^[RC]|^.[RC]/.test(row)) { i++; } }
	let repository: string | undefined;
	try { repository = vectorGraphRepositoryIdentity((await git(project, ['config', '--local', '--no-includes', '--get', 'remote.origin.url'])).trim()); } catch { /* Local repositories can have no origin. */ }
	return { head, branch, changes, repository };
}
export async function createVectorGraphBranch(project: string, branch: string, expectedHead: string): Promise<void> {
	if (typeof branch !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,199}$/.test(branch) || typeof expectedHead !== 'string' || !/^[a-f0-9]{40,64}$/i.test(expectedHead)) { throw new Error('Invalid branch or starting commit.'); }
	await git(project, ['check-ref-format', '--branch', branch]);
	const state = await getVectorGraphRepositoryState(project);
	if (state.head !== expectedHead || state.changes.length) { throw new Error('The repository changed or has uncommitted files. Save and commit your work before creating a branch.'); }
	await git(project, ['switch', '-c', branch, expectedHead]);
}
