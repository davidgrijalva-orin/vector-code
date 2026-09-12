/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IVectorGraphService } from './vectorGraph.js';

/** Explicit operations only; credentials and arbitrary API/process calls stay in the main process. */
export class VectorGraphChannel implements IServerChannel {
	constructor(private readonly service: IVectorGraphService) { }
	listen<T>(_context: unknown, event: string): Event<T> {
		if (event === 'onDidChangeSession') { return this.service.onDidChangeSession as Event<T>; }
		throw new Error('Unsupported VectorGraph event.');
	}
	call<T>(_context: unknown, command: string, args: unknown): Promise<T> {
		if (!Array.isArray(args) || args.some(arg => arg !== undefined && typeof arg !== 'string')) {
			return Promise.reject(new Error('Invalid VectorGraph arguments.'));
		}
		let result: Promise<unknown>;
		switch (command) {
			case 'getSession': result = this.service.getSession(); break;
			case 'beginSignIn': result = this.service.beginSignIn(); break;
			case 'pollSignIn': result = this.service.pollSignIn(); break;
			case 'cancelSignIn': result = this.service.cancelSignIn(); break;
			case 'signOut': result = this.service.signOut(); break;
			case 'discoverRepository': result = this.service.discoverRepository(args[0]); break;
			case 'listWorkspaces': result = this.service.listWorkspaces(); break;
			case 'listTeams': result = this.service.listTeams(args[0]); break;
			case 'listTickets': result = this.service.listTickets(args[0], args[1], args[2]); break;
			case 'getTicket': result = this.service.getTicket(args[0], args[1]); break;
			default: return Promise.reject(new Error('Unsupported VectorGraph operation.'));
		}
		return result as Promise<T>;
	}
}
