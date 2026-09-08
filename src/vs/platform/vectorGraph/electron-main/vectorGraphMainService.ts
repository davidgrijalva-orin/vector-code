/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { dirname, join } from '../../../base/common/path.js';
import { findExecutable } from '../../../base/node/processes.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { ILogService } from '../../log/common/log.js';
import { getResolvedShellEnv } from '../../shell/node/shellEnv.js';
import { IVectorGraphService, IVectorGraphWorkspace, IVectorGraphTeam, IVectorGraphTicketPage, IVectorGraphTicketDetail, parseVectorGraphTicketPage, parseVectorGraphTicketDetail, vectorGraphRecord, vectorGraphText, vectorGraphArray } from '../common/vectorGraph.js';

/** Read-only CLI adapter. Credentials and raw responses never cross IPC. */
export class VectorGraphMainService implements IVectorGraphService {
	declare readonly _serviceBrand: undefined;
	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
	) { }

	async listWorkspaces(): Promise<readonly IVectorGraphWorkspace[]> {
		const result = vectorGraphRecord(await this.run(['workspace', 'list', '--json']));
		return vectorGraphArray(result.workspaces).map(value => {
			const row = vectorGraphRecord(value);
			return { id: vectorGraphText(row.id), name: vectorGraphText(row.name) };
		});
	}
	async listTeams(workspace: string): Promise<readonly IVectorGraphTeam[]> {
		const result = vectorGraphRecord(await this.call('listApiTeams', workspace));
		return vectorGraphArray(result.teams).map(value => {
			const row = vectorGraphRecord(value);
			return { id: vectorGraphText(row.id), name: vectorGraphText(row.name), identifier: vectorGraphText(row.identifier) };
		});
	}
	async listTickets(workspace: string, team: string, cursor?: string): Promise<IVectorGraphTicketPage> {
		this.validateId(team);
		if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096)) { throw new Error('Invalid ticket cursor.'); }
		return parseVectorGraphTicketPage(await this.call('listApiIssues', workspace, '--query-json', { teamId: team, limit: 100, cursor }));
	}
	async getTicket(workspace: string, identifier: string): Promise<IVectorGraphTicketDetail> {
		if (typeof identifier !== 'string' || !/^[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*$/.test(identifier) || identifier.length > 100) { throw new Error('Invalid ticket identifier.'); }
		return parseVectorGraphTicketDetail(await this.call('getApiIssue', workspace, '--path-json', { issueIdentifier: identifier }));
	}
	private validateId(id: string): void {
		if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) { throw new Error('Choose a saved VectorGraph workspace and team.'); }
	}
	private call(operation: string, workspace: string, argument?: string, values?: object): Promise<unknown> {
		this.validateId(workspace);
		return this.run(['api', 'call', operation, '--workspace', workspace, ...(argument ? [argument, JSON.stringify(values)] : []), '--json']);
	}
	private async run(args: string[]): Promise<unknown> {
		const shellEnv = await getResolvedShellEnv(this.configurationService, this.logService, this.environmentService.args, process.env);
		const env: NodeJS.ProcessEnv = { ...process.env, ...shellEnv, ELECTRON_RUN_AS_NODE: '1' };
		// The view explicitly selects saved profiles rather than inheriting a terminal's overrides.
		for (const key of ['VECTORGRAPH_API_TOKEN', 'VECTORGRAPH_CLI_TOKEN', 'VECTORGRAPH_WORKSPACE_ID', 'VECTORGRAPH_API_URL']) { delete env[key]; }
		const executable = await findExecutable('vectorgraph', this.environmentService.userHome.fsPath, undefined, env);
		if (!executable) { throw new Error('Install the VectorGraph CLI and sign in with vectorgraph auth login, then refresh Tickets.'); }
		const script = /\.cmd$/i.test(executable) ? join(dirname(executable), 'node_modules', '@orintech', 'cli', 'dist', 'index.js') : await fs.realpath(executable);
		if (!/\.[cm]?js$/i.test(script)) { throw new Error('Install the official @orintech/cli npm package to use Tickets.'); }
		return new Promise((resolve, reject) => {
			execFile(process.execPath, [script, ...args], { env, cwd: this.environmentService.userHome.fsPath, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
				if (error) {
					reject(new Error('Could not read VectorGraph. Check your connection and CLI sign-in (vectorgraph auth login), then retry.'));
					return;
				}
				try { resolve(JSON.parse(stdout)); } catch { reject(new Error('VectorGraph returned invalid JSON. Update the CLI and retry.')); }
			});
		});
	}
}
