/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { localize } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { asJson, IRequestService, isSuccess, NO_FETCH_TELEMETRY } from '../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorCodeMobileConnectionStatus, IVectorCodeMobilePairingPayload, IVectorCodeMobilePairingSession, IVectorCodeMobileRelayService, VectorCodeMobileConnectionState } from '../common/vectorCode.js';
import { toString as qrToString } from './vectorCodeQrBundle.js';

const VECTOR_CODE_MOBILE_DESKTOP_ID_STORAGE_KEY = 'vectorCode.mobile.desktopId';
const VECTOR_CODE_MOBILE_PRIVATE_KEY_STORAGE_KEY = 'vectorCode.mobile.privateKeyJwk';
const VECTOR_CODE_MOBILE_RELAY_HOST_STORAGE_KEY = 'vectorCode.mobile.relayHost';
const VECTOR_CODE_MOBILE_RELAY_ISSUER_TOKEN_SECRET_KEY = 'vectorCode.mobile.relayIssuerToken';
const VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST = 'relay-production-e21f.up.railway.app';
const VECTOR_CODE_MOBILE_PAIRING_TTL_MS = 5 * 60_000;
const VECTOR_CODE_MOBILE_PHONE_RELAY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const VECTOR_CODE_MOBILE_DEFAULT_USER_ID = 'default';

class VectorCodeMobileRelayService implements IVectorCodeMobileRelayService {
	readonly _serviceBrand: undefined;
	private _lastStatus: IVectorCodeMobileConnectionStatus | undefined;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService,
	) { }

	getStatus(): IVectorCodeMobileConnectionStatus {
		if (this._lastStatus) {
			if (this._lastStatus.pairing && Date.parse(this._lastStatus.pairing.payload.expiresAt) <= Date.now()) {
				this._lastStatus = {
					state: VectorCodeMobileConnectionState.Disconnected,
					label: localize('vectorCodeMobilePairingExpired', 'QR expired'),
					detail: localize('vectorCodeMobilePairingExpiredDetail', 'Create a new QR pairing session to connect the mobile app.'),
					relayHost: this._lastStatus.relayHost
				};
			}
			return this._lastStatus;
		}

		const relayHost = this.getStoredRelayHost();
		return relayHost ? {
			state: VectorCodeMobileConnectionState.Disconnected,
			label: localize('vectorCodeMobileRelayHostConfigured', 'Railway relay configured'),
			detail: localize('vectorCodeMobileRelayHostConfiguredDetail', 'Create a QR pairing session against the Railway relay.'),
			relayHost
		} : {
			state: VectorCodeMobileConnectionState.Unconfigured,
			label: localize('vectorCodeMobileRelayHostRequired', 'Railway relay required'),
			detail: localize('vectorCodeMobileRelayHostRequiredDetail', 'Enter a relay host to create a QR pairing session.')
		};
	}

	async startPairing(relayHost?: string, relayIssuerToken?: string): Promise<IVectorCodeMobileConnectionStatus> {
		const normalizedRelayHost = normalizeRelayHost(relayHost ?? this.getStoredRelayHost());
		if (!normalizedRelayHost) {
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Unconfigured,
				label: localize('vectorCodeMobileRelayHostRequired', 'Railway relay required'),
				detail: localize('vectorCodeMobileRelayHostRequiredDetail', 'Enter a relay host to create a QR pairing session.')
			};
			return this._lastStatus;
		}

		this.storageService.store(VECTOR_CODE_MOBILE_RELAY_HOST_STORAGE_KEY, normalizedRelayHost, StorageScope.APPLICATION, StorageTarget.MACHINE);
		const identity = await this.getOrCreateIdentity();
		const expiresAt = new Date(Date.now() + VECTOR_CODE_MOBILE_PAIRING_TTL_MS).toISOString();
		const desktopId = this.getOrCreateDesktopId();
		const pairingId = cryptoRandomId('pairing');
		const pairingToken = cryptoRandomBase64Url(32);
		const issuerToken = await this.resolveRelayIssuerToken(relayIssuerToken);
		if (!issuerToken) {
			const pairing = await createPairingSession({
				protocolVersion: 1,
				desktopId,
				pairingId,
				desktopPublicKey: identity.publicKey,
				desktopPublicKeyFingerprint: identity.publicKeyFingerprint,
				pairingToken,
				relayHost: normalizedRelayHost,
				userId: VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
				expiresAt
			});
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Unconfigured,
				label: localize('vectorCodeMobileRelayIssuerTokenRequired', 'Relay issuer token required'),
				detail: localize('vectorCodeMobileRelayIssuerTokenRequiredDetail', 'The QR is visible with the Railway relay host. Enter the issuer token to mint the signed phone relay token before scanning.'),
				relayHost: normalizedRelayHost,
				pairing
			};
			return this._lastStatus;
		}

		const relayToken = await this.createRelayToken({
			relayHost: normalizedRelayHost,
			issuerToken,
			role: 'phone',
			userId: VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
			desktopId,
			pairingId,
			ttlSeconds: VECTOR_CODE_MOBILE_PHONE_RELAY_TOKEN_TTL_SECONDS
		});
		if (!relayToken) {
			const pairing = await createPairingSession({
				protocolVersion: 1,
				desktopId,
				pairingId,
				desktopPublicKey: identity.publicKey,
				desktopPublicKeyFingerprint: identity.publicKeyFingerprint,
				pairingToken,
				relayHost: normalizedRelayHost,
				userId: VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
				expiresAt
			});
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Disconnected,
				label: localize('vectorCodeMobileRelayTokenRejected', 'Relay token rejected'),
				detail: localize('vectorCodeMobileRelayTokenRejectedDetail', 'The QR remains visible, but the Railway relay did not issue a signed phone token. Check the issuer token or relay CORS and try again.'),
				relayHost: normalizedRelayHost,
				pairing
			};
			return this._lastStatus;
		}

		const payload: IVectorCodeMobilePairingPayload = {
			protocolVersion: 1,
			desktopId,
			pairingId,
			desktopPublicKey: identity.publicKey,
			desktopPublicKeyFingerprint: identity.publicKeyFingerprint,
			pairingToken,
			relayHost: normalizedRelayHost,
			userId: VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
			relayToken: relayToken.relayToken,
			relayTokenExpiresAt: relayToken.relayTokenExpiresAt,
			expiresAt
		};

		const pairing = await createPairingSession(payload);
		this._lastStatus = {
			state: VectorCodeMobileConnectionState.Pairing,
			label: localize('vectorCodeMobilePairingReady', 'Railway QR ready to scan'),
			detail: localize('vectorCodeMobilePairingReadyDetail', 'Railway relay verified. Pairing expires at {0}.', new Date(expiresAt).toLocaleTimeString()),
			relayHost: normalizedRelayHost,
			pairing
		};
		return this._lastStatus;
	}

	private getStoredRelayHost(): string | undefined {
		return normalizeRelayHost(this.storageService.get(VECTOR_CODE_MOBILE_RELAY_HOST_STORAGE_KEY, StorageScope.APPLICATION)) ?? VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST;
	}

	private getOrCreateDesktopId(): string {
		const storedDesktopId = this.storageService.get(VECTOR_CODE_MOBILE_DESKTOP_ID_STORAGE_KEY, StorageScope.APPLICATION);
		if (storedDesktopId && /^[A-Za-z0-9._:-]{1,160}$/.test(storedDesktopId)) {
			return storedDesktopId;
		}

		const desktopId = cryptoRandomId('desktop');
		this.storageService.store(VECTOR_CODE_MOBILE_DESKTOP_ID_STORAGE_KEY, desktopId, StorageScope.APPLICATION, StorageTarget.MACHINE);
		return desktopId;
	}

	private async getOrCreateIdentity(): Promise<{ publicKey: string; publicKeyFingerprint: string }> {
		const crypto = globalThis.crypto;
		if (!crypto?.subtle) {
			throw new Error(localize('vectorCodeMobileCryptoUnavailable', 'Secure pairing requires Web Crypto support.'));
		}

		const storedPrivateKey = await this.secretStorageService.get(VECTOR_CODE_MOBILE_PRIVATE_KEY_STORAGE_KEY);
		let privateKey: CryptoKey;
		if (storedPrivateKey) {
			try {
				privateKey = await crypto.subtle.importKey(
					'jwk',
					JSON.parse(storedPrivateKey) as JsonWebKey,
					{ name: 'ECDSA', namedCurve: 'P-256' },
					true,
					['sign']
				);
			} catch {
				await this.secretStorageService.delete(VECTOR_CODE_MOBILE_PRIVATE_KEY_STORAGE_KEY);
				return this.getOrCreateIdentity();
			}
		} else {
			const keyPair = await crypto.subtle.generateKey(
				{ name: 'ECDSA', namedCurve: 'P-256' },
				true,
				['sign', 'verify']
			);
			privateKey = keyPair.privateKey;
			const privateKeyJwk = await crypto.subtle.exportKey('jwk', privateKey);
			await this.secretStorageService.set(VECTOR_CODE_MOBILE_PRIVATE_KEY_STORAGE_KEY, JSON.stringify(privateKeyJwk));
		}

		const privateKeyJwk = await crypto.subtle.exportKey('jwk', privateKey);
		const publicKeyJwk = publicJwkFromPrivate(privateKeyJwk);
		const publicCryptoKey = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
		const publicKey = await crypto.subtle.exportKey('spki', publicCryptoKey);
		return {
			publicKey: base64Url(new Uint8Array(publicKey)),
			publicKeyFingerprint: await sha256Base64Url(new Uint8Array(publicKey))
		};
	}

	private async resolveRelayIssuerToken(input?: string): Promise<string | undefined> {
		const token = input?.trim();
		if (token) {
			await this.secretStorageService.set(VECTOR_CODE_MOBILE_RELAY_ISSUER_TOKEN_SECRET_KEY, token);
			return token;
		}

		const storedToken = (await this.secretStorageService.get(VECTOR_CODE_MOBILE_RELAY_ISSUER_TOKEN_SECRET_KEY))?.trim();
		return storedToken || undefined;
	}

	private async createRelayToken(input: {
		relayHost: string;
		issuerToken: string;
		role: 'phone' | 'desktop';
		userId: string;
		desktopId: string;
		pairingId?: string;
		ttlSeconds: number;
	}): Promise<{ relayToken: string; relayTokenExpiresAt: string } | undefined> {
		try {
			const response = await this.requestService.request({
				type: 'POST',
				url: relayHttpUrl(input.relayHost, '/relay/token'),
				headers: {
					Authorization: `Bearer ${input.issuerToken}`,
					'content-type': 'application/json'
				},
				data: JSON.stringify({
					role: input.role,
					userId: input.userId,
					desktopId: input.desktopId,
					pairingId: input.pairingId,
					ttlSeconds: input.ttlSeconds
				}),
				callSite: NO_FETCH_TELEMETRY,
				timeout: 10_000
			}, CancellationToken.None);
			if (!isSuccess(response)) {
				return undefined;
			}

			const body = await asJson<{ token?: unknown; expiresAt?: unknown }>(response);
			const relayToken = typeof body?.token === 'string' ? body.token.trim() : '';
			const relayTokenExpiresAt = typeof body?.expiresAt === 'string' ? body.expiresAt.trim() : '';
			return relayToken && relayTokenExpiresAt ? { relayToken, relayTokenExpiresAt } : undefined;
		} catch {
			return undefined;
		}
	}
}

registerSingleton(IVectorCodeMobileRelayService, VectorCodeMobileRelayService, InstantiationType.Delayed);

async function createPairingSession(payload: IVectorCodeMobilePairingPayload): Promise<IVectorCodeMobilePairingSession> {
	const payloadJson = JSON.stringify(payload);
	return {
		payload,
		payloadJson,
		pairingCode: formatPairingCode(payload.pairingToken),
		qrDataUrl: svgDataUrl(await qrToString(payloadJson, {
			errorCorrectionLevel: 'M',
			margin: 2,
			width: 220,
			color: {
				dark: '#181c26',
				light: '#ffffff'
			}
		}))
	};
}

function normalizeRelayHost(value?: string | null): string | undefined {
	const rawValue = value?.trim();
	if (!rawValue) {
		return undefined;
	}

	try {
		const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue) ? rawValue : `wss://${rawValue}`);
		const relayHost = url.port ? `${url.hostname}:${url.port}` : url.hostname;
		return /^[A-Za-z0-9.-]+(?::\d{2,5})?$/.test(relayHost) ? relayHost : undefined;
	} catch {
		return undefined;
	}
}

function relayHttpUrl(relayHost: string, pathname: string): string {
	const scheme = /^(localhost|127\.0\.0\.1)(?::|$)/.test(relayHost) ? 'http' : 'https';
	return `${scheme}://${relayHost}${pathname}`;
}

function svgDataUrl(svg: string): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function cryptoRandomId(prefix: string): string {
	const uuid = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : cryptoRandomBase64Url(16);
	return `${prefix}_${uuid}`;
}

function cryptoRandomBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	globalThis.crypto.getRandomValues(bytes);
	return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
	let value = '';
	for (const byte of bytes) {
		value += String.fromCharCode(byte);
	}
	return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return base64Url(new Uint8Array(digest));
}

function formatPairingCode(value: string): string {
	return value.match(/.{1,4}/g)?.join('-') ?? value;
}

function publicJwkFromPrivate(privateKeyJwk: JsonWebKey): JsonWebKey {
	return {
		kty: privateKeyJwk.kty,
		crv: privateKeyJwk.crv,
		x: privateKeyJwk.x,
		y: privateKeyJwk.y,
		ext: true,
		key_ops: ['verify']
	};
}
