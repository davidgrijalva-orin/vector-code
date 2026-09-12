/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorGraphService } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import { IVectorGraphWorkService, IVectorGraphSelection, IVectorGraphActiveTicket } from '../common/vectorGraphWork.js';

export class VectorGraphWorkService extends Disposable implements IVectorGraphWorkService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	selection: IVectorGraphSelection | undefined;
	constructor(@IStorageService private readonly storage: IStorageService, @IVectorCodeWorkbenchService projects: IVectorCodeWorkbenchService, @IVectorGraphService graph: IVectorGraphService) {
		super();
		this._register(projects.onDidChangeActiveProject(() => this.select(undefined)));
		this._register(graph.onDidChangeSession(() => this.select(undefined)));
	}
	select(selection: IVectorGraphSelection | undefined): void { this.selection = selection; this.changed.fire(); }
	getActive(project: string): IVectorGraphActiveTicket | undefined {
		const value = this.storage.getObject<IVectorGraphActiveTicket>('vectorGraph.active.' + project, StorageScope.PROFILE);
		return value && typeof value.workspace === 'string' && typeof value.identifier === 'string' ? value : undefined;
	}
	setActive(project: string, ticket: IVectorGraphActiveTicket | undefined): void {
		if (ticket) { this.storage.store('vectorGraph.active.' + project, ticket, StorageScope.PROFILE, StorageTarget.MACHINE); }
		else { this.storage.remove('vectorGraph.active.' + project, StorageScope.PROFILE); }
		this.changed.fire();
	}
}
registerSingleton(IVectorGraphWorkService, VectorGraphWorkService, InstantiationType.Delayed);
