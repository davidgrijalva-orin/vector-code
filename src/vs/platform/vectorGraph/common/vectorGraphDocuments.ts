/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vectorGraphRecord, vectorGraphArray, vectorGraphText } from './vectorGraph.js';
import { vectorGraphId } from './vectorGraphWork.js';

export interface IVectorGraphDocument { readonly id: string; readonly title: string; readonly body: string; readonly teamId?: string; readonly projectIds: readonly string[]; readonly revisionNumber: number; readonly versionNumber: number; readonly updatedAt: string }
export interface IVectorGraphDocumentSave { readonly body: string; readonly expectedRevisionNumber: number; readonly expectedVersionNumber: number }
export function parseVectorGraphDocument(value: unknown): IVectorGraphDocument {
	const row = vectorGraphRecord(value);
	for (const key of ['revisionNumber', 'versionNumber']) { if (!Number.isSafeInteger(row[key]) || Number(row[key]) < 1) { throw new Error('Invalid document revision.'); } }
	return {
		id: vectorGraphId(row.id), title: vectorGraphText(row.title), body: vectorGraphText(row.body), teamId: row.teamId ? vectorGraphId(row.teamId) : undefined,
		projectIds: vectorGraphArray(row.links).map(vectorGraphRecord).filter(link => link.targetType === 'project').map(link => vectorGraphId(link.targetId)),
		revisionNumber: Number(row.revisionNumber), versionNumber: Number(row.versionNumber), updatedAt: vectorGraphText(row.updatedAt)
	};
}
export function validateVectorGraphDocumentSave(value: unknown): IVectorGraphDocumentSave {
	const row = vectorGraphRecord(value);
	if (Object.keys(row).some(key => !['body', 'expectedRevisionNumber', 'expectedVersionNumber'].includes(key)) || typeof row.body !== 'string' || row.body.length > 1000000 || !Number.isSafeInteger(row.expectedRevisionNumber) || Number(row.expectedRevisionNumber) < 1 || !Number.isSafeInteger(row.expectedVersionNumber) || Number(row.expectedVersionNumber) < 1) { throw new Error('Invalid document save.'); }
	return { body: row.body, expectedRevisionNumber: Number(row.expectedRevisionNumber), expectedVersionNumber: Number(row.expectedVersionNumber) };
}

export interface IVectorGraphCanvas { readonly id: string; readonly title: string; readonly projectIds: readonly string[]; readonly scene: { readonly elements: readonly Record<string, unknown>[] } }
export function parseVectorGraphCanvas(value: unknown): IVectorGraphCanvas {
	const row = vectorGraphRecord(value); const scene = vectorGraphRecord(row.scene);
	const elements = vectorGraphArray(scene.elements);
	if (elements.length > 5000) { throw new Error('Canvas is too large.'); }
	return { id: vectorGraphId(row.id), title: vectorGraphText(row.title), projectIds: vectorGraphArray(row.links).map(vectorGraphRecord).filter(link => link.targetType === 'project').map(link => vectorGraphId(link.targetId)), scene: { elements: elements.map(vectorGraphRecord) } };
}
