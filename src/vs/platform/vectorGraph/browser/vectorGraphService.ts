/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IVectorGraphService } from '../common/vectorGraph.js';

class BrowserVectorGraphService implements IVectorGraphService {
	declare readonly _serviceBrand: undefined;
	private unavailable(): Promise<never> { return Promise.reject(new Error('VectorGraph tickets are available in the desktop application.')); }
	readonly onDidChangeSession = Event.None;
	readonly onDidChangeTickets = Event.None;
	listDocuments() { return this.unavailable(); }
	getDocument() { return this.unavailable(); }
	createDocument() { return this.unavailable(); }
	saveDocument() { return this.unavailable(); }
	listProjects() { return this.unavailable(); }
	getTeamMetadata() { return this.unavailable(); }
	createTicket() { return this.unavailable(); }
	updateTicket() { return this.unavailable(); }
	addComment() { return this.unavailable(); }
	linkPullRequest() { return this.unavailable(); }
	getRepositoryState() { return this.unavailable(); }
	createBranch() { return this.unavailable(); }
	getSession() { return this.unavailable(); }
	beginSignIn() { return this.unavailable(); }
	pollSignIn() { return this.unavailable(); }
	cancelSignIn() { return this.unavailable(); }
	signOut() { return this.unavailable(); }
	discoverRepository(_project: string) { return this.unavailable(); }
	listWorkspaces() { return this.unavailable(); }
	listTeams(_workspace: string) { return this.unavailable(); }
	listTickets(_workspace: string, _team: string, _cursor?: string) { return this.unavailable(); }
	getTicket(_workspace: string, _identifier: string) { return this.unavailable(); }
}
registerSingleton(IVectorGraphService, BrowserVectorGraphService, InstantiationType.Delayed);
