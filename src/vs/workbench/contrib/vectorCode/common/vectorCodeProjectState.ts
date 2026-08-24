/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IVectorCodeProjectSummary } from './vectorCode.js';

/**
 * Resolves one authoritative active project from the folders that are currently open.
 * A stale persisted identifier deliberately falls back to the first live project.
 */
export function resolveVectorCodeActiveProjectUri(
	projects: readonly IVectorCodeProjectSummary[],
	...preferredProjectIds: readonly (string | undefined)[]
): URI | undefined {
	for (const preferredProjectId of preferredProjectIds) {
		if (!preferredProjectId) {
			continue;
		}
		const preferredProject = projects.find(project => project.uri.toString() === preferredProjectId);
		if (preferredProject) {
			return preferredProject.uri;
		}
	}

	return projects[0]?.uri;
}
