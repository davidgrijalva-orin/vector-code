/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { VectorGraphTicketsWidget } from './vectorGraphTicketsWidget.js';
import './vectorGraphDetails.contribution.js';
import './vectorGraphDocuments.contribution.js';

/** Compatibility host for extensions/tests; project pages own the visible list. */
export class VectorGraphTicketsView extends ViewPane {
	private widget: VectorGraphTicketsWidget | undefined;
	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.widget = this._register(this.instantiationService.createInstance(VectorGraphTicketsWidget));
		this.widget.render(container);
	}
	override focus(): void { super.focus(); this.widget?.focus(); }
}
