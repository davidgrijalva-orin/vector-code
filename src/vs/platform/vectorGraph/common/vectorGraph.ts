/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorGraphDocument, IVectorGraphDocumentSave } from './vectorGraphDocuments.js';
import { IVectorGraphProject, IVectorGraphTeamMetadata, IVectorGraphIssueDraft, IVectorGraphIssuePatch, IVectorGraphRepositoryState } from './vectorGraphWork.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const VECTOR_GRAPH_CHANNEL = 'vectorGraphTickets';
export const IVectorGraphService = createDecorator<IVectorGraphService>('vectorGraphService');

export interface IVectorGraphSession {
	readonly workspaces: readonly IVectorGraphWorkspace[];
	readonly authorization?: { readonly url: string; readonly code: string; readonly expiresAt: number };
}
export interface IVectorGraphDiscovery {
	readonly bindings: readonly IVectorGraphBinding[];
	readonly incomplete: boolean;
	readonly repository?: string;
}
export interface IVectorGraphWorkspace { readonly id: string; readonly name: string }
export interface IVectorGraphTeam extends IVectorGraphWorkspace { readonly identifier: string }
export interface IVectorGraphBinding {
	readonly workspace: IVectorGraphWorkspace;
	readonly team: IVectorGraphTeam;
	readonly project?: IVectorGraphProject;
}
export interface IVectorGraphTicket {
	readonly identifier: string;
	readonly title: string;
	readonly status: string;
	readonly category: string;
	readonly priority: string;
	readonly project: string;
}
export interface IVectorGraphTicketPage {
	readonly tickets: readonly IVectorGraphTicket[];
	readonly nextCursor?: string;
}
export interface IVectorGraphTicketDetail extends IVectorGraphTicket {
	readonly description: string;
	readonly teamId?: string;
	readonly statusId?: string;
	readonly assigneeUserId?: string;
	readonly projectId?: string;
	readonly updatedAt?: string;
	readonly links?: readonly { readonly title: string; readonly url: string }[];
	readonly comments: readonly { readonly author: string; readonly body: string }[];
}
export interface IVectorGraphService {
	readonly _serviceBrand: undefined;
	listDocuments(workspace: string): Promise<readonly IVectorGraphDocument[]>;
	getDocument(workspace: string, document: string): Promise<IVectorGraphDocument>;
	createDocument(workspace: string, team: string, project: string | undefined, title: string, requestId: string): Promise<IVectorGraphDocument>;
	saveDocument(workspace: string, document: string, save: IVectorGraphDocumentSave, requestId: string): Promise<IVectorGraphDocument>;

	readonly onDidChangeSession: Event<void>;
	readonly onDidChangeTickets: Event<{ workspace: string; identifier: string }>;
	getSession(): Promise<IVectorGraphSession>;
	beginSignIn(): Promise<IVectorGraphSession>;
	pollSignIn(): Promise<IVectorGraphSession>;
	cancelSignIn(): Promise<void>;
	signOut(): Promise<void>;
	discoverRepository(project: string): Promise<IVectorGraphDiscovery>;
	listWorkspaces(): Promise<readonly IVectorGraphWorkspace[]>;
	listTeams(workspace: string): Promise<readonly IVectorGraphTeam[]>;
	listTickets(workspace: string, team: string, cursor?: string, project?: string, assignee?: string): Promise<IVectorGraphTicketPage>;
	listProjects(workspace: string, team: string): Promise<readonly IVectorGraphProject[]>;
	getTeamMetadata(workspace: string, team: string): Promise<IVectorGraphTeamMetadata>;
	createTicket(workspace: string, draft: IVectorGraphIssueDraft, requestId: string): Promise<string>;
	updateTicket(workspace: string, identifier: string, patch: IVectorGraphIssuePatch, requestId: string): Promise<void>;
	addComment(workspace: string, identifier: string, body: string, requestId: string): Promise<void>;
	linkPullRequest(workspace: string, identifier: string, project: string, url: string, requestId: string): Promise<void>;
	getRepositoryState(project: string): Promise<IVectorGraphRepositoryState>;
	createBranch(project: string, branch: string, expectedHead: string): Promise<void>;
	getTicket(workspace: string, identifier: string): Promise<IVectorGraphTicketDetail>;
}

export function vectorGraphRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('VectorGraph returned an invalid response.');
	}
	return value as Record<string, unknown>;
}
export function vectorGraphText(value: unknown): string {
	if (typeof value !== 'string') { throw new Error('VectorGraph returned an invalid text field.'); }
	return value;
}
export function vectorGraphArray(value: unknown): unknown[] {
	if (!Array.isArray(value)) { throw new Error('VectorGraph returned an invalid list.'); }
	return value;
}
export function parseVectorGraphTicket(value: unknown): IVectorGraphTicket {
	const row = vectorGraphRecord(value);
	return {
		identifier: vectorGraphText(row.identifier), title: vectorGraphText(row.title),
		status: vectorGraphText(row.statusName), category: vectorGraphText(row.statusCategory),
		priority: vectorGraphText(row.priority), project: (row.projectName === null || row.projectName === undefined) ? '' : vectorGraphText(row.projectName)
	};
}
export function parseVectorGraphTicketPage(value: unknown): IVectorGraphTicketPage {
	const result = vectorGraphRecord(value);
	const page = vectorGraphRecord(result.pageInfo);
	if (typeof page.hasNextPage !== 'boolean') { throw new Error('VectorGraph returned invalid pagination.'); }
	const nextCursor = page.hasNextPage ? vectorGraphText(page.nextCursor) : undefined;
	if (nextCursor === '') { throw new Error('VectorGraph returned an empty page cursor.'); }
	return { tickets: vectorGraphArray(result.issues).map(parseVectorGraphTicket), nextCursor };
}
export function parseVectorGraphTicketDetail(value: unknown): IVectorGraphTicketDetail {
	const result = vectorGraphRecord(value);
	const issue = vectorGraphRecord(result.issue);
	return {
		...parseVectorGraphTicket(issue),
		teamId: typeof issue.teamId === 'string' ? issue.teamId : undefined,
		statusId: typeof issue.statusId === 'string' ? issue.statusId : undefined,
		projectId: typeof issue.projectId === 'string' ? issue.projectId : undefined,
		assigneeUserId: typeof issue.assigneeUserId === 'string' ? issue.assigneeUserId : undefined,
		updatedAt: typeof issue.updatedAt === 'string' ? issue.updatedAt : undefined,
		links: result.links === undefined ? [] : vectorGraphArray(result.links).map(value => {
			const link = vectorGraphRecord(value); return { title: typeof link.title === 'string' ? link.title : vectorGraphText(link.url), url: vectorGraphText(link.url) };
		}), description: (issue.description === null || issue.description === undefined) ? '' : vectorGraphText(issue.description),
		comments: vectorGraphArray(result.comments).map(value => {
			const comment = vectorGraphRecord(value);
			return { author: typeof comment.authorName === 'string' ? comment.authorName : 'Unknown author', body: vectorGraphText(comment.body) };
		})
	};
}
export function filterVectorGraphTickets(tickets: readonly IVectorGraphTicket[], query: string, category: string): readonly IVectorGraphTicket[] {
	const search = query.trim().toLocaleLowerCase();
	return tickets.filter(ticket => (!category || ticket.category === category) && `${ticket.identifier} ${ticket.title} ${ticket.project}`.toLocaleLowerCase().includes(search));
}

/** Match only GitHub remotes; another host with the same owner/name is a different repository. */
export function vectorGraphRepositoryIdentity(remote: string): string | undefined {
	const ssh = /^git@github\.com:([^?#\s]+)$/i.exec(remote);
	let path = ssh?.[1];
	if (!path) {
		try {
			const url = new URL(remote);
			if (!['https:', 'ssh:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' || url.port || url.search || url.hash) { return undefined; }
			path = url.pathname.slice(1);
		} catch { return undefined; }
	}
	path = path.replace(/\.git\/?$/i, '').replace(/\/$/, '');
	return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(path) ? path.toLowerCase() : undefined;
}

export class VectorGraphConnectionError extends Error {
	readonly code = 'VECTORGRAPH_CONNECTION_RETRY';
}
export function isVectorGraphConnectionError(error: unknown): boolean {
	return error instanceof Error && (error as { code?: unknown }).code === 'VECTORGRAPH_CONNECTION_RETRY';
}
