/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function toString(text: string, options: {
	readonly errorCorrectionLevel?: string;
	readonly margin?: number;
	readonly width?: number;
	readonly color?: {
		readonly dark?: string;
		readonly light?: string;
	};
}): Promise<string>;
