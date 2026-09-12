/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function isVectorGraphRepositoryUnavailable(code: string | number | null | undefined, stderr: string, killed: boolean | undefined): boolean {
	if (killed) { return false; }
	return code === 'ENOENT' || code === 1 || (code === 128 && /--local can only be used inside a git repository|not a git repository/i.test(stderr));
}
