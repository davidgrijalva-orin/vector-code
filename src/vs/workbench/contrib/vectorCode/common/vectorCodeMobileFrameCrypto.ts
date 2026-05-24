/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorCodeMobileRelayEncryptedFrame, IVectorCodeMobileRelayFrameHeader } from './vectorCodeMobileProtocol.js';

const VECTOR_CODE_MOBILE_FRAME_NONCE_BYTES = 12;
const VECTOR_CODE_MOBILE_FRAME_TAG_BYTES = 16;

export async function encryptVectorCodeMobileFramePayload(input: {
	readonly pairingToken: string;
	readonly header: IVectorCodeMobileRelayFrameHeader;
	readonly payload: unknown;
}): Promise<IVectorCodeMobileRelayEncryptedFrame> {
	const key = await importVectorCodeMobileFrameKey(input.pairingToken, ['encrypt']);
	const nonce = cryptoRandomBytes(VECTOR_CODE_MOBILE_FRAME_NONCE_BYTES);
	const plaintext = arrayBufferBackedBytes(new TextEncoder().encode(JSON.stringify(input.payload)));
	const encrypted = new Uint8Array(await globalThis.crypto.subtle.encrypt({
		name: 'AES-GCM',
		iv: nonce,
		tagLength: VECTOR_CODE_MOBILE_FRAME_TAG_BYTES * 8
	}, key, plaintext));

	return {
		header: input.header,
		nonce: base64Url(nonce),
		ciphertext: base64Url(encrypted.slice(0, -VECTOR_CODE_MOBILE_FRAME_TAG_BYTES)),
		tag: base64Url(encrypted.slice(-VECTOR_CODE_MOBILE_FRAME_TAG_BYTES))
	};
}

export async function decryptVectorCodeMobileFramePayload<TPayload>(input: {
	readonly pairingToken: string;
	readonly frame: IVectorCodeMobileRelayEncryptedFrame;
}): Promise<TPayload> {
	const key = await importVectorCodeMobileFrameKey(input.pairingToken, ['decrypt']);
	const ciphertext = base64UrlDecode(input.frame.ciphertext);
	const tag = base64UrlDecode(input.frame.tag);
	const encrypted = new Uint8Array(ciphertext.byteLength + tag.byteLength);
	encrypted.set(ciphertext);
	encrypted.set(tag, ciphertext.byteLength);
	const plaintext = await globalThis.crypto.subtle.decrypt({
		name: 'AES-GCM',
		iv: base64UrlDecode(input.frame.nonce),
		tagLength: VECTOR_CODE_MOBILE_FRAME_TAG_BYTES * 8
	}, key, encrypted);
	return JSON.parse(new TextDecoder().decode(plaintext)) as TPayload;
}

function cryptoRandomBytes(byteLength: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(new ArrayBuffer(byteLength));
	globalThis.crypto.getRandomValues(bytes);
	return bytes;
}

async function importVectorCodeMobileFrameKey(pairingToken: string, keyUsages: KeyUsage[]): Promise<CryptoKey> {
	const keyBytes = base64UrlDecode(pairingToken);
	if (keyBytes.byteLength !== 32) {
		throw new Error('VectorCode mobile pairing token must decode to a 32-byte frame key.');
	}
	return globalThis.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, keyUsages);
}

function base64Url(bytes: Uint8Array): string {
	let value = '';
	for (const byte of bytes) {
		value += String.fromCharCode(byte);
	}
	return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
	const decoded = atob(padded);
	const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
	for (let index = 0; index < decoded.length; index++) {
		bytes[index] = decoded.charCodeAt(index);
	}
	return bytes;
}

function arrayBufferBackedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
	copy.set(bytes);
	return copy;
}
