/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { net } from 'electron';
import { execFile } from 'child_process';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IEncryptionMainService } from '../../encryption/common/encryptionService.js';
import { IStateService } from '../../state/node/state.js';
import { IVectorGraphService, IVectorGraphTeam, IVectorGraphTicketPage, IVectorGraphTicketDetail, IVectorGraphDiscovery, IVectorGraphBinding, parseVectorGraphTicketPage, parseVectorGraphTicketDetail, vectorGraphRecord, vectorGraphText, vectorGraphArray, vectorGraphRepositoryIdentity } from '../common/vectorGraph.js';
import { VectorGraphAuth } from '../node/vectorGraphAuth.js';

/** Native adapter with an explicit read API and IDE-owned device authorization. */
export class VectorGraphMainService extends Disposable implements IVectorGraphService {
	declare readonly _serviceBrand: undefined;
	private readonly auth: VectorGraphAuth;
	readonly onDidChangeSession;
	constructor(
		@IEncryptionMainService encryption: IEncryptionMainService,
		@IStateService state: IStateService,
	) {
		super();
		this.auth = this._register(new VectorGraphAuth(encryption, state, net.fetch));
		this.onDidChangeSession = this.auth.onDidChangeSession;
	}
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
	async listTickets(workspace: string, team: string, cursor?: string): Promise<IVectorGraphTicketPage> {
		if (typeof team !== 'string' || !/^[a-f0-9-]{36}$/i.test(team)) { throw new Error('Choose a VectorGraph team.'); }
		if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096)) { throw new Error('Invalid ticket cursor.'); }
		return parseVectorGraphTicketPage(await this.auth.call(workspace, 'listApiIssues', { teamId: team, limit: 100, cursor }));
	}
	async getTicket(workspace: string, identifier: string): Promise<IVectorGraphTicketDetail> {
		if (typeof identifier !== 'string' || !/^[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*$/.test(identifier) || identifier.length > 100) { throw new Error('Invalid ticket identifier.'); }
		return parseVectorGraphTicketDetail(await this.auth.call(workspace, 'getApiIssue', {}, { issueIdentifier: identifier }));
	}
	async discoverRepository(project: string): Promise<IVectorGraphDiscovery> {
		const uri = URI.parse(project);
		if (uri.scheme !== 'file' || uri.authority || !uri.path || uri.query || uri.fragment) { return { bindings: [], incomplete: false }; }
		const remotes = await new Promise<string[]>((resolve, reject) => {
			execFile('git', ['-C', uri.fsPath, 'config', '--local', '--no-includes', '--get-regexp', '^remote\\..*\\.url$'], { timeout: 5000, maxBuffer: 65536, windowsHide: true }, (error, stdout) => {
				if (error && error.code !== 1) { reject(new Error('Cannot read this repository. Choose its workspace manually.')); return; }
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
