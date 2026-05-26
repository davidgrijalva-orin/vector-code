/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function encodeVectorCodeBase64Url(bytes: Uint8Array): string {
	let value = '';
	for (const byte of bytes) {
		value += String.fromCharCode(byte);
	}
	return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeVectorCodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
	const decoded = atob(padded);
	const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
	for (let index = 0; index < decoded.length; index++) {
		bytes[index] = decoded.charCodeAt(index);
	}
	return bytes;
}

export function cryptoRandomVectorCodeBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	globalThis.crypto.getRandomValues(bytes);
	return encodeVectorCodeBase64Url(bytes);
}
