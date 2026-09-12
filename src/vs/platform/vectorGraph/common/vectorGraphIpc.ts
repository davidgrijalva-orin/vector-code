/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { validateVectorGraphDocumentSave } from './vectorGraphDocuments.js';
import { Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { validateVectorGraphPatch, IVectorGraphIssueDraft } from './vectorGraphWork.js';
import { IVectorGraphService } from './vectorGraph.js';

/** Explicit operations only; credentials and arbitrary API/process calls stay in the main process. */
export class VectorGraphChannel implements IServerChannel {
	constructor(private readonly service: IVectorGraphService, private readonly authorizeRepository?: (context: unknown, project: string, write: boolean) => Promise<string>) { }
	listen<T>(_context: unknown, event: string): Event<T> {
		if (event === 'onDidChangeTickets') { return this.service.onDidChangeTickets as Event<T>; }
		if (event === 'onDidChangeSession') { return this.service.onDidChangeSession as Event<T>; }
		throw new Error('Unsupported VectorGraph event.');
	}
	async call<T>(context: unknown, command: string, args: unknown): Promise<T> {
		if (!Array.isArray(args) || args.some((arg, index) => arg !== undefined && typeof arg !== 'string' && !((command === 'createTicket' && index === 1) || (command === 'updateTicket' && index === 2) || (command === 'saveDocument' && index === 2)))) {
			return Promise.reject(new Error('Invalid VectorGraph arguments.'));
		}
		const repositoryIndex = command === 'linkPullRequest' ? 2 : ['getRepositoryState', 'createBranch', 'discoverRepository'].includes(command) ? 0 : undefined;
		if (repositoryIndex !== undefined) {
			if (!this.authorizeRepository) { throw new Error('Repository access is unavailable.'); }
			// Canonicalize only after main-process workspace authorization.
			args[repositoryIndex] = await this.authorizeRepository(context, args[repositoryIndex], command === 'createBranch');
		}
		let result: Promise<unknown>;
		switch (command) {
			case 'listDocuments': result = this.service.listDocuments(args[0]); break;
			case 'getDocument': result = this.service.getDocument(args[0], args[1]); break;
			case 'createDocument': result = this.service.createDocument(args[0], args[1], args[2], args[3], args[4]); break;
			case 'saveDocument': result = this.service.saveDocument(args[0], args[1], validateVectorGraphDocumentSave(args[2]), args[3]); break;
			case 'getSession': result = this.service.getSession(); break;
			case 'beginSignIn': result = this.service.beginSignIn(); break;
			case 'pollSignIn': result = this.service.pollSignIn(); break;
			case 'cancelSignIn': result = this.service.cancelSignIn(); break;
			case 'signOut': result = this.service.signOut(); break;
			case 'discoverRepository': result = this.service.discoverRepository(args[0]); break;
			case 'listWorkspaces': result = this.service.listWorkspaces(); break;
			case 'listTeams': result = this.service.listTeams(args[0]); break;
			case 'listTickets': result = this.service.listTickets(args[0], args[1], args[2], args[3], args[4]); break;
			case 'listProjects': result = this.service.listProjects(args[0], args[1]); break;
			case 'getTeamMetadata': result = this.service.getTeamMetadata(args[0], args[1]); break;
			case 'createTicket': result = this.service.createTicket(args[0], validateVectorGraphPatch(args[1], true) as IVectorGraphIssueDraft, args[2]); break;
			case 'updateTicket': result = this.service.updateTicket(args[0], args[1], validateVectorGraphPatch(args[2]), args[3]); break;
			case 'addComment': result = this.service.addComment(args[0], args[1], args[2], args[3]); break;
			case 'linkPullRequest': result = this.service.linkPullRequest(args[0], args[1], args[2], args[3], args[4]); break;
			case 'getRepositoryState': result = this.service.getRepositoryState(args[0]); break;
			case 'createBranch': result = this.service.createBranch(args[0], args[1], args[2]); break;
			case 'getTicket': result = this.service.getTicket(args[0], args[1]); break;
			default: return Promise.reject(new Error('Unsupported VectorGraph operation.'));
		}
		return result as Promise<T>;
	}
}
