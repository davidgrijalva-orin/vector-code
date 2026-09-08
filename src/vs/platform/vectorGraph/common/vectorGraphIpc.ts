/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IVectorGraphService } from './vectorGraph.js';

/** Expose only these reads, never the adapter's internal process runner. */
export class VectorGraphChannel implements IServerChannel {
	constructor(private readonly service: IVectorGraphService) { }
	listen<T>(): Event<T> { throw new Error('VectorGraph ticket events are not supported.'); }
	call<T>(_context: unknown, command: string, args: unknown): Promise<T> {
		if (!Array.isArray(args) || args.some(arg => arg !== undefined && typeof arg !== 'string')) {
			return Promise.reject(new Error('Invalid VectorGraph arguments.'));
		}
		let result: Promise<unknown>;
		switch (command) {
			case 'listWorkspaces': result = this.service.listWorkspaces(); break;
			case 'listTeams': result = this.service.listTeams(args[0]); break;
			case 'listTickets': result = this.service.listTickets(args[0], args[1], args[2]); break;
			case 'getTicket': result = this.service.getTicket(args[0], args[1]); break;
			default: return Promise.reject(new Error('Unsupported VectorGraph operation.'));
		}
		return result as Promise<T>;
	}
}
