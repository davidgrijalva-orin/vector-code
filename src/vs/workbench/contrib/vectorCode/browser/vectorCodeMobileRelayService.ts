/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IVectorCodeMobileRelayBridgeService } from '../../../../platform/vectorCodeMobile/common/vectorCodeMobileRelayBridge.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorCodeMobileConnectionStatus, IVectorCodeMobilePairingPayload, IVectorCodeMobilePairingSession, IVectorCodeMobileRelayService, IVectorCodeMobileRemoteRequestHandler, VectorCodeMobileConnectionState } from '../common/vectorCode.js';
import { decryptVectorCodeMobileFramePayload, encryptVectorCodeMobileFramePayload } from '../common/vectorCodeMobileFrameCrypto.js';
import { IVectorCodeMobileRemoteEnvelope, IVectorCodeMobileRelayEncryptedFrame, VectorCodeMobileRelayFrameDirection, VectorCodeMobileRelayInboundMessage, VectorCodeMobileRelayOutboundMessage, VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION } from '../common/vectorCodeMobileProtocol.js';
import { toString as qrToString } from './vectorCodeQrBundle.js';

const VECTOR_CODE_MOBILE_DESKTOP_ID_STORAGE_KEY = 'vectorCode.mobile.desktopId';
const VECTOR_CODE_MOBILE_PRIVATE_KEY_STORAGE_KEY = 'vectorCode.mobile.privateKeyJwk';
const VECTOR_CODE_MOBILE_RELAY_HOST_STORAGE_KEY = 'vectorCode.mobile.relayHost';
const VECTOR_CODE_MOBILE_RELAY_ISSUER_TOKEN_SECRET_KEY = 'vectorCode.mobile.relayIssuerToken';
const VECTOR_CODE_MOBILE_ACTIVE_RELAY_SESSION_SECRET_KEY = 'vectorCode.mobile.activeRelaySession';
const VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST = 'relay.vectorcode.app';
const VECTOR_CODE_MOBILE_LEGACY_RELAY_HOSTS = new Set([
	'relay-production-e21f.up.railway.app',
	'sskpzvaw.up.railway.app'
]);
const VECTOR_CODE_MOBILE_PAIRING_TTL_MS = 5 * 60_000;
const VECTOR_CODE_MOBILE_PHONE_RELAY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const VECTOR_CODE_MOBILE_TOKEN_EXPIRY_SKEW_MS = 60_000;
const VECTOR_CODE_MOBILE_DEFAULT_USER_ID = 'default';

interface IVectorCodeMobileDesktopRelayConnection {
	readonly connectionId: string;
	readonly payload: IVectorCodeMobilePairingPayload;
	sequence: number;
}

interface IVectorCodeMobileStoredRelaySession {
	readonly payload: IVectorCodeMobilePairingPayload;
	readonly desktopRelayToken: string;
	readonly desktopRelayTokenExpiresAt: string;
}

class VectorCodeMobileRelayService extends Disposable implements IVectorCodeMobileRelayService {
	readonly _serviceBrand: undefined;
	private _lastStatus: IVectorCodeMobileConnectionStatus | undefined;
	private requestHandler: IVectorCodeMobileRemoteRequestHandler | undefined;
	private desktopRelayConnection: IVectorCodeMobileDesktopRelayConnection | undefined;

	constructor(
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService,
		@IVectorCodeMobileRelayBridgeService private readonly relayBridgeService: IVectorCodeMobileRelayBridgeService,
	) {
		super();
		this._register(this.relayBridgeService.onDidReceiveMessage(message => {
			void this.handleDesktopRelayMessage(message.connectionId, message.message);
		}));
		this._register(this.relayBridgeService.onDidChangeConnection(event => {
			this.handleDesktopRelayConnectionChange(event.connectionId, event.state, event.detail);
		}));
		void this.restoreDesktopRelayConnection();
	}

	getStatus(): IVectorCodeMobileConnectionStatus {
		if (this._lastStatus) {
			if (this._lastStatus.state !== VectorCodeMobileConnectionState.Connected && this._lastStatus.pairing && Date.parse(this._lastStatus.pairing.payload.expiresAt) <= Date.now()) {
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
			label: localize('vectorCodeMobileRelayHostConfigured', 'Phone connection ready'),
			detail: localize('vectorCodeMobileRelayHostConfiguredDetail', 'Create a QR pairing session for the mobile app.'),
			relayHost
		} : {
			state: VectorCodeMobileConnectionState.Unconfigured,
			label: localize('vectorCodeMobileRelayHostRequired', 'Phone connection unavailable'),
			detail: localize('vectorCodeMobileRelayHostRequiredDetail', 'Mobile pairing is not configured for this desktop.')
		};
	}

	async startPairing(relayHost?: string, relayIssuerToken?: string): Promise<IVectorCodeMobileConnectionStatus> {
		const normalizedRelayHost = normalizeRelayHost(relayHost ?? this.getStoredRelayHost());
		if (!normalizedRelayHost) {
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Unconfigured,
				label: localize('vectorCodeMobileRelayHostRequired', 'Phone connection unavailable'),
				detail: localize('vectorCodeMobileRelayHostRequiredDetail', 'Mobile pairing is not configured for this desktop.')
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
				label: localize('vectorCodeMobileRelayIssuerTokenRequired', 'Connection setup required'),
				detail: localize('vectorCodeMobileRelayIssuerTokenRequiredDetail', 'Secure phone pairing is not fully configured on this desktop.'),
				relayHost: normalizedRelayHost,
				pairing
			};
			return this._lastStatus;
		}

		const phoneRelayToken = await this.createRelayToken({
			relayHost: normalizedRelayHost,
			issuerToken,
			role: 'phone',
			userId: VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
			desktopId,
			pairingId,
			ttlSeconds: VECTOR_CODE_MOBILE_PHONE_RELAY_TOKEN_TTL_SECONDS
		});
		const desktopRelayToken = await this.createRelayToken({
			relayHost: normalizedRelayHost,
			issuerToken,
			role: 'desktop',
			userId: VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
			desktopId,
			pairingId,
			ttlSeconds: VECTOR_CODE_MOBILE_PHONE_RELAY_TOKEN_TTL_SECONDS
		});
		if (!phoneRelayToken || !desktopRelayToken) {
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
				label: localize('vectorCodeMobileRelayTokenRejected', 'Secure pairing failed'),
				detail: localize('vectorCodeMobileRelayTokenRejectedDetail', 'The QR could not be prepared for the phone. Check the desktop mobile connection configuration and try again.'),
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
			relayToken: phoneRelayToken.relayToken,
			relayTokenExpiresAt: phoneRelayToken.relayTokenExpiresAt,
			expiresAt
		};

		const pairing = await createPairingSession(payload);
		try {
			await this.connectDesktopRelay(payload, desktopRelayToken.relayToken);
			await this.storeActiveRelaySession(payload, desktopRelayToken);
		} catch {
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Disconnected,
				label: localize('vectorCodeMobileDesktopRelayFailed', 'Desktop connection failed'),
				detail: localize('vectorCodeMobileDesktopRelayFailedDetail', 'The QR is ready, but this desktop could not start the phone bridge. Refresh the QR and try again.'),
				relayHost: normalizedRelayHost,
				pairing
			};
			return this._lastStatus;
		}
		this._lastStatus = {
			state: VectorCodeMobileConnectionState.Pairing,
			label: localize('vectorCodeMobilePairingReady', 'QR ready to scan'),
			detail: localize('vectorCodeMobilePairingReadyDetail', 'Secure phone bridge ready. Scan this QR by {0}.', new Date(expiresAt).toLocaleTimeString()),
			relayHost: normalizedRelayHost,
			pairing
		};
		return this._lastStatus;
	}

	registerRequestHandler(handler: IVectorCodeMobileRemoteRequestHandler): IDisposable {
		this.requestHandler = handler;
		return toDisposable(() => {
			if (this.requestHandler === handler) {
				this.requestHandler = undefined;
			}
		});
	}

	private async connectDesktopRelay(payload: IVectorCodeMobilePairingPayload, desktopRelayToken: string): Promise<void> {
		if (this.desktopRelayConnection) {
			await this.relayBridgeService.disconnect(this.desktopRelayConnection.connectionId);
			this.desktopRelayConnection = undefined;
		}

		const connectionId = await this.relayBridgeService.connect({
			url: relayWebSocketUrl(payload.relayHost, {
				role: 'desktop',
				userId: payload.userId ?? VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
				desktopId: payload.desktopId,
				deviceId: payload.desktopId,
				pairingId: payload.pairingId
			}),
			authorizationHeader: `Bearer ${desktopRelayToken}`
		});
		this.desktopRelayConnection = { connectionId, payload, sequence: 0 };
	}

	private async restoreDesktopRelayConnection(): Promise<void> {
		const session = await this.readActiveRelaySession();
		if (!session) {
			return;
		}

		if (!session.payload.relayToken || isExpiredIsoDate(session.payload.relayTokenExpiresAt, VECTOR_CODE_MOBILE_TOKEN_EXPIRY_SKEW_MS)) {
			await this.clearActiveRelaySession();
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Disconnected,
				label: localize('vectorCodeMobileStoredPairingExpired', 'Phone pairing expired'),
				detail: localize('vectorCodeMobileStoredPairingExpiredDetail', 'Create a fresh QR pairing session to reconnect the mobile app.'),
				relayHost: session.payload.relayHost
			};
			return;
		}

		const desktopRelayToken = await this.resolveDesktopRelayToken(session);
		if (!desktopRelayToken) {
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Disconnected,
				label: localize('vectorCodeMobileDesktopRestoreTokenMissing', 'Phone bridge expired'),
				detail: localize('vectorCodeMobileDesktopRestoreTokenMissingDetail', 'Refresh the QR pairing once so the desktop can reconnect.'),
				relayHost: session.payload.relayHost
			};
			return;
		}

		try {
			await this.connectDesktopRelay(session.payload, desktopRelayToken);
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Pairing,
				label: localize('vectorCodeMobileDesktopBridgeReady', 'Desktop bridge ready'),
				detail: localize('vectorCodeMobileDesktopBridgeReadyDetail', 'Waiting for the paired phone.'),
				relayHost: session.payload.relayHost
			};
		} catch {
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Disconnected,
				label: localize('vectorCodeMobileDesktopRestoreFailed', 'Desktop connection failed'),
				detail: localize('vectorCodeMobileDesktopRestoreFailedDetail', 'The desktop could not reconnect to the stored mobile pairing. Refresh the QR pairing and try again.'),
				relayHost: session.payload.relayHost
			};
		}
	}

	private async resolveDesktopRelayToken(session: IVectorCodeMobileStoredRelaySession): Promise<string | undefined> {
		if (!isExpiredIsoDate(session.desktopRelayTokenExpiresAt, VECTOR_CODE_MOBILE_TOKEN_EXPIRY_SKEW_MS)) {
			return session.desktopRelayToken;
		}

		const issuerToken = await this.resolveRelayIssuerToken();
		if (!issuerToken) {
			return undefined;
		}

		const mintedToken = await this.createRelayToken({
			relayHost: session.payload.relayHost,
			issuerToken,
			role: 'desktop',
			userId: session.payload.userId ?? VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
			desktopId: session.payload.desktopId,
			pairingId: session.payload.pairingId,
			ttlSeconds: VECTOR_CODE_MOBILE_PHONE_RELAY_TOKEN_TTL_SECONDS
		});
		if (!mintedToken) {
			return undefined;
		}

		await this.storeActiveRelaySession(session.payload, mintedToken);
		return mintedToken.relayToken;
	}

	private handleDesktopRelayConnectionChange(connectionId: string, state: 'open' | 'closed' | 'error', detail?: string): void {
		if (this.desktopRelayConnection?.connectionId !== connectionId || state === 'open') {
			return;
		}
		this.desktopRelayConnection = undefined;
		const previousStatus = this._lastStatus;
		this._lastStatus = {
			state: VectorCodeMobileConnectionState.Disconnected,
			label: localize('vectorCodeMobileDesktopRelayDisconnected', 'Phone bridge disconnected'),
			detail: detail ?? localize('vectorCodeMobileDesktopRelayDisconnectedDetail', 'Create a new QR pairing session to reconnect the desktop bridge.'),
			relayHost: previousStatus?.relayHost,
			pairing: previousStatus?.pairing
		};
	}

	private async handleDesktopRelayMessage(connectionId: string, rawMessage: string): Promise<void> {
		const connection = this.desktopRelayConnection;
		if (!connection || connection.connectionId !== connectionId) {
			return;
		}

		let message: VectorCodeMobileRelayInboundMessage;
		try {
			message = JSON.parse(rawMessage) as VectorCodeMobileRelayInboundMessage;
		} catch {
			return;
		}
		if (message.type === 'relay.peer_online' && message.role === 'phone') {
			this._lastStatus = {
				state: VectorCodeMobileConnectionState.Connected,
				label: localize('vectorCodeMobilePhoneConnected', 'Phone connected'),
				detail: localize('vectorCodeMobilePhoneConnectedDetail', 'Mobile app is connected.'),
				relayHost: connection.payload.relayHost
			};
			return;
		}
		if (message.type !== 'relay.frame' || message.frame.header.direction !== VectorCodeMobileRelayFrameDirection.PhoneToDesktop) {
			return;
		}

		let request: IVectorCodeMobileRemoteEnvelope;
		try {
			request = await decryptVectorCodeMobileFramePayload<IVectorCodeMobileRemoteEnvelope>({
				pairingToken: connection.payload.pairingToken,
				frame: message.frame
			});
		} catch {
			return;
		}
		const response = await this.createRemoteResponse(request);
		await this.sendDesktopRelayResponse(connection, message.frame, response);
	}

	private async createRemoteResponse(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		if (request.kind !== 'request') {
			return createRemoteErrorResponse(request, 'invalid_kind', 'Expected a request envelope.');
		}
		if (!this.requestHandler) {
			return createRemoteErrorResponse(request, 'desktop_handler_missing', 'The desktop bridge is not ready.');
		}
		try {
			return await this.requestHandler.handleVectorCodeMobileRemoteRequest(request);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'The desktop bridge failed to handle the request.';
			return createRemoteErrorResponse(request, 'desktop_request_failed', message);
		}
	}

	private async sendDesktopRelayResponse(connection: IVectorCodeMobileDesktopRelayConnection, requestFrame: IVectorCodeMobileRelayEncryptedFrame, response: IVectorCodeMobileRemoteEnvelope): Promise<void> {
		connection.sequence += 1;
		const frame = await encryptVectorCodeMobileFramePayload({
			pairingToken: connection.payload.pairingToken,
			header: {
				...requestFrame.header,
				frameId: cryptoRandomId('frame'),
				direction: VectorCodeMobileRelayFrameDirection.DesktopToPhone,
				seq: connection.sequence,
				issuedAt: new Date().toISOString(),
				action: response.action
			},
			payload: response
		});
		const message: VectorCodeMobileRelayOutboundMessage = {
			type: 'relay.frame',
			frame
		};
		await this.relayBridgeService.send(connection.connectionId, JSON.stringify(message));
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
			return await this.relayBridgeService.createRelayToken({
				url: relayHttpUrl(input.relayHost, '/relay/token'),
				authorizationHeader: `Bearer ${input.issuerToken}`,
				payload: {
					role: input.role,
					userId: input.userId,
					desktopId: input.desktopId,
					...(input.role === 'phone' && input.pairingId ? { pairingId: input.pairingId } : {}),
					ttlSeconds: input.ttlSeconds
				}
			});
		} catch {
			return undefined;
		}
	}

	private async storeActiveRelaySession(payload: IVectorCodeMobilePairingPayload, desktopRelayToken: { relayToken: string; relayTokenExpiresAt: string }): Promise<void> {
		const session: IVectorCodeMobileStoredRelaySession = {
			payload,
			desktopRelayToken: desktopRelayToken.relayToken,
			desktopRelayTokenExpiresAt: desktopRelayToken.relayTokenExpiresAt
		};
		await this.secretStorageService.set(VECTOR_CODE_MOBILE_ACTIVE_RELAY_SESSION_SECRET_KEY, JSON.stringify(session));
	}

	private async readActiveRelaySession(): Promise<IVectorCodeMobileStoredRelaySession | undefined> {
		const rawSession = await this.secretStorageService.get(VECTOR_CODE_MOBILE_ACTIVE_RELAY_SESSION_SECRET_KEY);
		if (!rawSession) {
			return undefined;
		}

		try {
			const candidate = JSON.parse(rawSession) as unknown;
			if (isStoredRelaySession(candidate)) {
				const relayHost = normalizeRelayHost(candidate.payload.relayHost);
				if (!relayHost) {
					await this.clearActiveRelaySession();
					return undefined;
				}
				if (relayHost !== candidate.payload.relayHost) {
					const migratedSession = {
						...candidate,
						payload: {
							...candidate.payload,
							relayHost
						}
					};
					await this.storeActiveRelaySession(migratedSession.payload, {
						relayToken: migratedSession.desktopRelayToken,
						relayTokenExpiresAt: migratedSession.desktopRelayTokenExpiresAt
					});
					return migratedSession;
				}
				return candidate;
			}
		} catch {
			// Fall through and clear malformed session data below.
		}

		await this.clearActiveRelaySession();
		return undefined;
	}

	private async clearActiveRelaySession(): Promise<void> {
		await this.secretStorageService.delete(VECTOR_CODE_MOBILE_ACTIVE_RELAY_SESSION_SECRET_KEY);
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
		const hostname = url.hostname.toLowerCase();
		const relayHost = url.port ? `${hostname}:${url.port}` : hostname;
		if (VECTOR_CODE_MOBILE_LEGACY_RELAY_HOSTS.has(hostname)) {
			return VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST;
		}
		return /^[A-Za-z0-9.-]+(?::\d{2,5})?$/.test(relayHost) ? relayHost : undefined;
	} catch {
		return undefined;
	}
}

function relayHttpUrl(relayHost: string, pathname: string): string {
	const scheme = /^(localhost|127\.0\.0\.1)(?::|$)/.test(relayHost) ? 'http' : 'https';
	return `${scheme}://${relayHost}${pathname}`;
}

function relayWebSocketUrl(relayHost: string, query: { role: 'desktop'; userId: string; desktopId: string; deviceId: string; pairingId: string }): string {
	const scheme = /^(localhost|127\.0\.0\.1)(?::|$)/.test(relayHost) ? 'ws' : 'wss';
	const params = new URLSearchParams(query);
	return `${scheme}://${relayHost}/relay?${params.toString()}`;
}

function isStoredRelaySession(value: unknown): value is IVectorCodeMobileStoredRelaySession {
	if (!isRecord(value)) {
		return false;
	}
	return isPairingPayload(value.payload)
		&& typeof value.desktopRelayToken === 'string'
		&& value.desktopRelayToken.length > 0
		&& typeof value.desktopRelayTokenExpiresAt === 'string'
		&& value.desktopRelayTokenExpiresAt.length > 0;
}

function isPairingPayload(value: unknown): value is IVectorCodeMobilePairingPayload {
	if (!isRecord(value)) {
		return false;
	}
	return value.protocolVersion === 1
		&& typeof value.desktopId === 'string'
		&& typeof value.pairingId === 'string'
		&& typeof value.desktopPublicKey === 'string'
		&& typeof value.desktopPublicKeyFingerprint === 'string'
		&& typeof value.pairingToken === 'string'
		&& typeof value.relayHost === 'string'
		&& typeof value.expiresAt === 'string'
		&& (value.userId === undefined || typeof value.userId === 'string')
		&& (value.relayToken === undefined || typeof value.relayToken === 'string')
		&& (value.relayTokenExpiresAt === undefined || typeof value.relayTokenExpiresAt === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isExpiredIsoDate(value: string | undefined, skewMs: number): boolean {
	if (!value) {
		return true;
	}
	const timestamp = Date.parse(value);
	return !Number.isFinite(timestamp) || timestamp <= Date.now() + skewMs;
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

function createRemoteErrorResponse(request: IVectorCodeMobileRemoteEnvelope, code: string, message: string): IVectorCodeMobileRemoteEnvelope {
	return {
		kind: 'response',
		protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
		requestId: request.requestId,
		action: request.action,
		projectId: request.projectId,
		error: { code, message }
	};
}
