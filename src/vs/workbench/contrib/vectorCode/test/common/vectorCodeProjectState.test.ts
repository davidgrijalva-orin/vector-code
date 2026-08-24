/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IVectorCodeProjectSummary } from '../../common/vectorCode.js';
import { resolveVectorCodeActiveProjectUri } from '../../common/vectorCodeProjectState.js';

suite('VectorCodeProjectState', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const first = project('first', 'C:\\projects\\first');
	const second = project('second', 'C:\\projects\\second');

	test('restores a persisted project that is still open', () => {
		strictEqual(resolveVectorCodeActiveProjectUri([first, second], second.uri.toString()), second.uri);
	});

	test('falls back deterministically when persisted state is stale', () => {
		strictEqual(resolveVectorCodeActiveProjectUri([first, second], URI.file('C:\\projects\\removed').toString()), first.uri);
	});

	test('selects the first project when no state has been persisted', () => {
		strictEqual(resolveVectorCodeActiveProjectUri([first, second]), first.uri);
	});

	test('returns undefined when no projects are open', () => {
		strictEqual(resolveVectorCodeActiveProjectUri([], second.uri.toString()), undefined);
	});
});

function project(name: string, path: string): IVectorCodeProjectSummary {
	return {
		name,
		uri: URI.file(path),
		uriLabel: path,
	};
}
