/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IVectorGraphBinding } from '../../../../platform/vectorGraph/common/vectorGraph.js';

export const VECTOR_GRAPH_DETAILS_VIEW = 'vectorCode.vectorGraph.details';
export interface IVectorGraphSelection { readonly workspace: string; readonly identifier?: string; readonly project: string; readonly binding?: IVectorGraphBinding }
export interface IVectorGraphActiveTicket { readonly workspace: string; readonly identifier: string; readonly branch?: string }
export const IVectorGraphWorkService = createDecorator<IVectorGraphWorkService>('vectorGraphWorkService');
export interface IVectorGraphWorkService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	readonly selection: IVectorGraphSelection | undefined;
	select(selection: IVectorGraphSelection | undefined): void;
	getActive(project: string): IVectorGraphActiveTicket | undefined;
	setActive(project: string, ticket: IVectorGraphActiveTicket | undefined): void;
}
