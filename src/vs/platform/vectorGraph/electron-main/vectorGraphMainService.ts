/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorGraphDocumentSave } from '../common/vectorGraphDocuments.js';
import { Emitter } from '../../../base/common/event.js';
import { VectorGraphOperations, getVectorGraphRepositoryState, createVectorGraphBranch } from '../node/vectorGraphOperations.js';
import { IVectorGraphIssueDraft, IVectorGraphIssuePatch, vectorGraphId } from '../common/vectorGraphWork.js';
import { net } from 'electron';
import { execFile } from 'child_process';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IEncryptionMainService } from '../../encryption/common/encryptionService.js';
import { IStateService } from '../../state/node/state.js';
import { IVectorGraphService, IVectorGraphTeam, IVectorGraphTicketPage, IVectorGraphTicketDetail, IVectorGraphDiscovery, IVectorGraphBinding, parseVectorGraphTicketPage, parseVectorGraphTicketDetail, vectorGraphRecord, vectorGraphText, vectorGraphArray, vectorGraphRepositoryIdentity } from '../common/vectorGraph.js';
import { isVectorGraphRepositoryUnavailable } from '../node/vectorGraphRepository.js';
import { VectorGraphAuth } from '../node/vectorGraphAuth.js';

/** Native adapter with an explicit ticket API and IDE-owned device authorization. */
export class VectorGraphMainService extends Disposable implements IVectorGraphService {
	declare readonly _serviceBrand: undefined;
	private readonly auth: VectorGraphAuth;
	private readonly operations: VectorGraphOperations;
	private readonly ticketsChanged = this._register(new Emitter<{ workspace: string; identifier: string }>());
	readonly onDidChangeTickets = this.ticketsChanged.event;
	readonly onDidChangeSession;
	constructor(
		@IEncryptionMainService encryption: IEncryptionMainService,
		@IStateService state: IStateService,
	) {
		super();
		this.auth = this._register(new VectorGraphAuth(encryption, state, net.fetch));
		this.onDidChangeSession = this.auth.onDidChangeSession;
		this.operations = new VectorGraphOperations(this.auth.call.bind(this.auth));
	}
	listDocuments(workspace: string) { return this.operations.listDocuments(workspace); }
	getDocument(workspace: string, document: string) { return this.operations.getDocument(workspace, document); }
	createDocument(workspace: string, team: string, project: string, title: string, requestId: string) { return this.operations.createDocument(workspace, team, project, title, requestId); }
	saveDocument(workspace: string, document: string, save: IVectorGraphDocumentSave, requestId: string) { return this.operations.saveDocument(workspace, document, save, requestId); }

	getSession() { return this.auth.getSession(); }
	beginSignIn() { return this.auth.beginSignIn(); }
	pollSignIn() { return this.auth.pollSignIn(); }
	cancelSignIn() { return this.auth.cancelSignIn(); }
	signOut() { return this.auth.signOut(); }
	async listWorkspaces() { return (await this.getSession()).workspaces; }
	async listTeams(workspace: string): Promise<readonly IVectorGraphTeam[]> {
		const result = vectorGraphRecord(await this.auth.call(workspace, 'listApiTeams'));
		return vectorGraphArray(result.teams).map(value => {
			const row = vectorGraphRecord(value);
			return { id: vectorGraphText(row.id), name: vectorGraphText(row.name), identifier: vectorGraphText(row.identifier) };
		});
	}
	async listTickets(workspace: string, team: string, cursor?: string, project?: string, assignee?: string): Promise<IVectorGraphTicketPage> {
		if (typeof team !== 'string' || !/^[a-f0-9-]{36}$/i.test(team)) { throw new Error('Choose a VectorGraph team.'); }
		if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096)) { throw new Error('Invalid ticket cursor.'); }
		return parseVectorGraphTicketPage(await this.auth.call(workspace, 'listApiIssues', { teamId: team, limit: 100, cursor, projectId: project === undefined ? undefined : vectorGraphId(project), assigneeUserId: assignee === undefined ? undefined : vectorGraphId(assignee) }));
	}
	listProjects(workspace: string, team: string) { return this.operations.listProjects(workspace, team); }
	getTeamMetadata(workspace: string, team: string) { return this.operations.getTeamMetadata(workspace, team); }
	async createTicket(workspace: string, draft: IVectorGraphIssueDraft, requestId: string) { const identifier = await this.operations.createTicket(workspace, draft, requestId); this.ticketsChanged.fire({ workspace, identifier }); return identifier; }
	async updateTicket(workspace: string, identifier: string, patch: IVectorGraphIssuePatch, requestId: string) { await this.operations.updateTicket(workspace, identifier, patch, requestId); this.ticketsChanged.fire({ workspace, identifier }); }
	async addComment(workspace: string, identifier: string, body: string, requestId: string) { await this.operations.addComment(workspace, identifier, body, requestId); this.ticketsChanged.fire({ workspace, identifier }); }
	async linkPullRequest(workspace: string, identifier: string, project: string, url: string, requestId: string) { await this.operations.linkPullRequest(workspace, identifier, project, url, requestId); this.ticketsChanged.fire({ workspace, identifier }); }
	getRepositoryState(project: string) { return getVectorGraphRepositoryState(project); }
	createBranch(project: string, branch: string, expectedHead: string) { return createVectorGraphBranch(project, branch, expectedHead); }
	async getTicket(workspace: string, identifier: string): Promise<IVectorGraphTicketDetail> {
		if (typeof identifier !== 'string' || !/^[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*$/.test(identifier) || identifier.length > 100) { throw new Error('Invalid ticket identifier.'); }
		return parseVectorGraphTicketDetail(await this.auth.call(workspace, 'getApiIssue', {}, { issueIdentifier: identifier }));
	}
	async discoverRepository(project: string): Promise<IVectorGraphDiscovery> {
		const uri = URI.parse(project);
		if (uri.scheme !== 'file' || uri.authority || !uri.path || uri.query || uri.fragment) { return { bindings: [], incomplete: false }; }
		const remotes = await new Promise<string[]>((resolve, reject) => {
			execFile('git', ['-C', uri.fsPath, 'config', '--local', '--no-includes', '--get-regexp', '^remote\\..*\\.url$'], { timeout: 5000, maxBuffer: 65536, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
				if (error) {
					if (isVectorGraphRepositoryUnavailable(error.code, stderr, error.killed)) { resolve([]); return; }
					reject(new Error('Cannot read this repository. Choose its workspace manually.'));
					return;
				}
				const lines = stdout.split(/\r?\n/).filter(Boolean);
				const origins = lines.filter(line => /^remote\.origin\.url\s/.test(line));
				resolve((origins.length ? origins : lines).map(line => line.replace(/^\S+\s+/, '')));
			});
		});
		const identities = new Set(remotes.map(vectorGraphRepositoryIdentity).filter((value): value is string => !!value));
		if (!identities.size) { return { bindings: [], incomplete: false }; }
		const bindings = new Map<string, IVectorGraphBinding>();
		let incomplete = identities.size > 1;
		for (const workspace of await this.listWorkspaces()) {
			try {
				const result = vectorGraphRecord(await this.auth.call(workspace.id, 'listApiGithubRepositories'));
				for (const value of vectorGraphArray(result.repositories)) {
					const row = vectorGraphRecord(value);
					if (row.status !== 'enabled' || row.workspaceId !== workspace.id || typeof row.fullName !== 'string' || !identities.has(row.fullName.toLowerCase()) || typeof row.teamId !== 'string') { continue; }
					const team = { id: row.teamId, name: vectorGraphText(row.teamName), identifier: vectorGraphText(row.teamIdentifier) };
					bindings.set(workspace.id + ':' + team.id, { workspace, team });
				}
			} catch { incomplete = true; }
		}
		return { bindings: [...bindings.values()], incomplete, repository: [...identities].join(', ') };
	}
}
