/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorCodeMobileRelayEncryptedFrame, IVectorCodeMobileRelayFrameHeader } from './vectorCodeMobileProtocol.js';
import { decodeVectorCodeBase64Url, encodeVectorCodeBase64Url } from './vectorCodeMobileEncoding.js';
import { VECTOR_CODE_MOBILE_FRAME_KEY_BYTES, VECTOR_CODE_MOBILE_FRAME_NONCE_BYTES, VECTOR_CODE_MOBILE_FRAME_TAG_BYTES } from './vectorCodeGeneratedConfig.js';

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
		additionalData: authenticatedHeaderBytes(input.header),
		tagLength: VECTOR_CODE_MOBILE_FRAME_TAG_BYTES * 8
	}, key, plaintext));

	return {
		header: input.header,
		nonce: encodeVectorCodeBase64Url(nonce),
		ciphertext: encodeVectorCodeBase64Url(encrypted.slice(0, -VECTOR_CODE_MOBILE_FRAME_TAG_BYTES)),
		tag: encodeVectorCodeBase64Url(encrypted.slice(-VECTOR_CODE_MOBILE_FRAME_TAG_BYTES))
	};
}

export async function decryptVectorCodeMobileFramePayload<TPayload>(input: {
	readonly pairingToken: string;
	readonly frame: IVectorCodeMobileRelayEncryptedFrame;
}): Promise<TPayload> {
	const key = await importVectorCodeMobileFrameKey(input.pairingToken, ['decrypt']);
	const ciphertext = decodeVectorCodeBase64Url(input.frame.ciphertext);
	const tag = decodeVectorCodeBase64Url(input.frame.tag);
	const encrypted = new Uint8Array(ciphertext.byteLength + tag.byteLength);
	encrypted.set(ciphertext);
	encrypted.set(tag, ciphertext.byteLength);
	const plaintext = await globalThis.crypto.subtle.decrypt({
		name: 'AES-GCM',
		iv: decodeVectorCodeBase64Url(input.frame.nonce),
		additionalData: authenticatedHeaderBytes(input.frame.header),
		tagLength: VECTOR_CODE_MOBILE_FRAME_TAG_BYTES * 8
	}, key, encrypted);
	return JSON.parse(new TextDecoder().decode(plaintext)) as TPayload;
}

/**
 * Encodes every routed header field as a length-prefixed UTF-8 value. Keeping
 * the encoding independent of JSON key ordering makes the authenticated data
 * byte-for-byte compatible with CryptoKit on iOS.
 */
function authenticatedHeaderBytes(header: IVectorCodeMobileRelayFrameHeader): Uint8Array<ArrayBuffer> {
	const encoder = new TextEncoder();
	const fields = [
		String(header.protocolVersion),
		header.frameId,
		header.desktopId,
		header.phoneId,
		header.sessionId ?? '',
		header.streamId,
		header.channel,
		header.direction,
		String(header.seq),
		header.issuedAt,
		header.action
	];
	const encodedFields = fields.map(field => encoder.encode(field));
	const byteLength = encodedFields.reduce((total, field) => total + encoder.encode(`${field.byteLength}:`).byteLength + field.byteLength, 0);
	const result = new Uint8Array(new ArrayBuffer(byteLength));
	let offset = 0;
	for (const field of encodedFields) {
		const prefix = encoder.encode(`${field.byteLength}:`);
		result.set(prefix, offset);
		offset += prefix.byteLength;
		result.set(field, offset);
		offset += field.byteLength;
	}
	return result;
}

function cryptoRandomBytes(byteLength: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(new ArrayBuffer(byteLength));
	globalThis.crypto.getRandomValues(bytes);
	return bytes;
}

async function importVectorCodeMobileFrameKey(pairingToken: string, keyUsages: KeyUsage[]): Promise<CryptoKey> {
	const keyBytes = decodeVectorCodeBase64Url(pairingToken);
	if (keyBytes.byteLength !== VECTOR_CODE_MOBILE_FRAME_KEY_BYTES) {
		throw new Error(`VectorCode mobile pairing token must decode to a ${VECTOR_CODE_MOBILE_FRAME_KEY_BYTES}-byte frame key.`);
	}
	return globalThis.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, keyUsages);
}

function arrayBufferBackedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
	copy.set(bytes);
	return copy;
}
