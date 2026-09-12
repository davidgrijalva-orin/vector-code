/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	readonly comments: readonly { readonly author: string; readonly body: string }[];
}
export interface IVectorGraphService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSession: Event<void>;
	getSession(): Promise<IVectorGraphSession>;
	beginSignIn(): Promise<IVectorGraphSession>;
	pollSignIn(): Promise<IVectorGraphSession>;
	cancelSignIn(): Promise<void>;
	signOut(): Promise<void>;
	discoverRepository(project: string): Promise<IVectorGraphDiscovery>;
	listWorkspaces(): Promise<readonly IVectorGraphWorkspace[]>;
	listTeams(workspace: string): Promise<readonly IVectorGraphTeam[]>;
	listTickets(workspace: string, team: string, cursor?: string): Promise<IVectorGraphTicketPage>;
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
		...parseVectorGraphTicket(issue), description: (issue.description === null || issue.description === undefined) ? '' : vectorGraphText(issue.description),
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
