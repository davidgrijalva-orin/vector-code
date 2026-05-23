/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IInlineCompletionsUnificationService = createDecorator<IInlineCompletionsUnificationService>('inlineCompletionsUnificationService');

export interface IInlineCompletionsUnificationState {
	codeUnification: boolean;
	modelUnification: boolean;
	extensionUnification: boolean;
	expAssignments: string[];
}

export interface IInlineCompletionsUnificationService {
	readonly _serviceBrand: undefined;

	readonly state: IInlineCompletionsUnificationState;
	readonly onDidStateChange: Event<void>;
}

export const isRunningUnificationExperiment = new RawContextKey<boolean>('isRunningUnificationExperiment', false);

class InlineCompletionsUnificationService extends Disposable implements IInlineCompletionsUnificationService {
	readonly _serviceBrand: undefined;

	readonly state: IInlineCompletionsUnificationState = {
		codeUnification: false,
		modelUnification: false,
		extensionUnification: false,
		expAssignments: []
	};

	readonly onDidStateChange = Event.None;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();
		isRunningUnificationExperiment.bindTo(contextKeyService).set(false);
	}
}

registerSingleton(IInlineCompletionsUnificationService, InlineCompletionsUnificationService, InstantiationType.Delayed);
