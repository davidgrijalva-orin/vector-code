/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vectorGraphRecord, vectorGraphText } from './vectorGraph.js';

export interface IVectorGraphProject { readonly id: string; readonly name: string }
export interface IVectorGraphTeamMetadata {
	readonly statuses: readonly { id: string; name: string; category: string }[];
	readonly members: readonly { id: string; name: string }[];
	readonly planning?: { projects: readonly IVectorGraphProject[]; sprints: readonly IVectorGraphProject[]; labels: readonly IVectorGraphProject[]; milestones: readonly (IVectorGraphProject & { projectId: string })[] };
	readonly planningError?: string;
}
export interface IVectorGraphIssuePatch { readonly title?: string; readonly description?: string; readonly statusId?: string; readonly priority?: string; readonly assigneeUserId?: string | null; readonly projectId?: string | null; readonly sprintId?: string | null; readonly projectMilestoneId?: string | null; readonly targetDate?: string | null; readonly parentIssueIdentifier?: string | null; readonly estimatePoints?: number | null; readonly labelIds?: readonly string[] }
export interface IVectorGraphIssueDraft extends IVectorGraphIssuePatch { readonly title: string; readonly teamId: string; readonly projectId: string }
export interface IVectorGraphRepositoryState { readonly branch: string; readonly head: string; readonly repository?: string; readonly changes: readonly string[] }

export function vectorGraphId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) { throw new Error('Invalid VectorGraph ID.'); }
	return value;
}
export function vectorGraphIdentifier(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]*-[1-9][0-9]*$/.test(value) || value.length > 100) { throw new Error('Invalid ticket identifier.'); }
	return value;
}
export function validateVectorGraphPatch(value: unknown, create = false): IVectorGraphIssuePatch | IVectorGraphIssueDraft {
	const row = vectorGraphRecord(value);
	const allowed = ['title', 'description', 'statusId', 'priority', 'assigneeUserId', 'projectId', 'sprintId', 'projectMilestoneId', 'targetDate', 'parentIssueIdentifier', 'estimatePoints', 'labelIds', ...(create ? ['teamId'] : [])];
	if (!Object.values(row).some(value => value !== undefined) || Object.keys(row).some(key => !allowed.includes(key))) { throw new Error('Unsupported ticket fields.'); }
	if (create || row.title !== undefined) { const title = vectorGraphText(row.title); if (!title.trim() || title.length > 1000) { throw new Error('Enter a ticket title of at most 1000 characters.'); } }
	if (row.description !== undefined && vectorGraphText(row.description).length > 100000) { throw new Error('Ticket description is too long.'); }
	if (row.priority !== undefined && !['no_priority', 'low', 'medium', 'high', 'urgent'].includes(vectorGraphText(row.priority))) { throw new Error('Invalid ticket priority.'); }
	for (const key of ['statusId', 'teamId', 'projectId']) { if ((row[key] !== undefined && row[key] !== null) || (create && key !== 'statusId')) { vectorGraphId(row[key]); } }
	if (row.assigneeUserId !== undefined && row.assigneeUserId !== null) { vectorGraphId(row.assigneeUserId); }
	for (const key of ['sprintId', 'projectMilestoneId']) { if (row[key] !== undefined && row[key] !== null) { vectorGraphId(row[key]); } }
	if (row.parentIssueIdentifier !== undefined && row.parentIssueIdentifier !== null) { vectorGraphIdentifier(row.parentIssueIdentifier); }
	if (row.targetDate !== undefined && row.targetDate !== null && (typeof row.targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.targetDate) || new Date(row.targetDate).toISOString().slice(0, 10) !== row.targetDate)) { throw new Error('Invalid target date.'); }
	if (row.estimatePoints !== undefined && row.estimatePoints !== null && (!Number.isInteger(row.estimatePoints) || Number(row.estimatePoints) < 0 || Number(row.estimatePoints) > 1000)) { throw new Error('Estimate must be between 0 and 1000.'); }
	if (row.labelIds !== undefined && (!Array.isArray(row.labelIds) || row.labelIds.length > 50)) { throw new Error('Invalid labels.'); }
	if (Array.isArray(row.labelIds)) { row.labelIds.forEach(vectorGraphId); }
	const patch: IVectorGraphIssuePatch = {
		...Object.fromEntries(['projectId', 'sprintId', 'projectMilestoneId', 'targetDate', 'parentIssueIdentifier', 'estimatePoints', 'labelIds'].filter(key => row[key] !== undefined).map(key => [key, row[key]])),
		...(row.title === undefined ? {} : { title: vectorGraphText(row.title) }),
		...(row.description === undefined ? {} : { description: vectorGraphText(row.description) }),
		...(row.statusId === undefined ? {} : { statusId: vectorGraphId(row.statusId) }),
		...(row.priority === undefined ? {} : { priority: vectorGraphText(row.priority) }),
		...(row.assigneeUserId === undefined ? {} : { assigneeUserId: row.assigneeUserId === null ? null : vectorGraphId(row.assigneeUserId) })
	};
	return create ? { ...patch, title: vectorGraphText(row.title), teamId: vectorGraphId(row.teamId), projectId: vectorGraphId(row.projectId) } : patch;
}
export function vectorGraphPullRequest(url: string, repository: string | undefined): string {
	const parsed = new URL(url);
	if (!repository || parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*\/?$/.test(parsed.pathname) || parsed.pathname.split('/').slice(1, 3).join('/').toLowerCase() !== repository.toLowerCase()) { throw new Error('Choose a GitHub pull request from this repository.'); }
	return parsed.toString();
}
