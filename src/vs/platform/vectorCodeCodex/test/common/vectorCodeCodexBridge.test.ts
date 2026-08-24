/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isVectorCodeCodexAuthenticationError } from '../../common/vectorCodeCodexBridge.js';

suite('VectorCodeCodexBridge', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('classifies only explicit authentication failures', () => {
		strictEqual(isVectorCodeCodexAuthenticationError('Authentication is required.'), true);
		strictEqual(isVectorCodeCodexAuthenticationError('Please sign in.'), true);
		strictEqual(isVectorCodeCodexAuthenticationError('Request failed.', 'AUTH_REQUIRED'), true);
		strictEqual(isVectorCodeCodexAuthenticationError('Model author metadata is unavailable.'), false);
		strictEqual(isVectorCodeCodexAuthenticationError('Authorization cache stopped.', 'unknown'), true);
	});
});
