/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { observableValue } from '../../../../../base/common/observable.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { CodeReviewStateKind, ICodeReviewService, PRReviewStateKind } from '../fixtureUtils.js';

export function createMockCodeReviewService(): ICodeReviewService {
	return new class extends mock<ICodeReviewService>() {
		private readonly _reviewState = observableValue('fixture.reviewState', { kind: CodeReviewStateKind.Idle });
		private readonly _prReviewState = observableValue('fixture.prReviewState', { kind: PRReviewStateKind.None });

		override getReviewState() {
			return this._reviewState;
		}

		override getPRReviewState() {
			return this._prReviewState;
		}

		override hasReview(): boolean {
			return false;
		}

		override requestReview(): void { }
		override removeComment(): void { }
		override updateComment(): void { }
		override dismissReview(): void { }
		override async resolvePRReviewThread(): Promise<void> { }
		override markPRReviewCommentConverted(): void { }
	}();
}
