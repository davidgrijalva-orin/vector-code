/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VECTOR_CODE_LANGUAGE_BY_EXTENSION } from './vectorCodeGeneratedConfig.js';

export { VECTOR_CODE_LANGUAGE_BY_EXTENSION, VECTOR_CODE_LANGUAGE_BY_EXTENSION_VALUES } from './vectorCodeGeneratedConfig.js';

export function inferVectorCodeLanguage(path: string): string {
	const extension = path.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
	return extension ? VECTOR_CODE_LANGUAGE_BY_EXTENSION.get(extension) ?? 'text' : 'text';
}
