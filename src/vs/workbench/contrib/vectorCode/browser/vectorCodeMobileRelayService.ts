/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IVectorCodeMobileRelayBridgeService } from '../../../../platform/vectorCodeMobile/common/vectorCodeMobileRelayBridge.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IVectorCodeMobileConnectionStatus, IVectorCodeMobilePairingPayload, IVectorCodeMobilePairingSession, IVectorCodeMobileRelayService, IVectorCodeMobileRemoteRequestHandler, VectorCodeMobileConnectionState } from '../common/vectorCode.js';
import { normalizeVectorCodeRelayHost, VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST, VECTOR_CODE_MOBILE_DEFAULT_USER_ID } from '../common/vectorCodeHosts.js';
import { cryptoRandomVectorCodeBase64Url, encodeVectorCodeBase64Url } from '../common/vectorCodeMobileEncoding.js';
import { decryptVectorCodeMobileFramePayload, encryptVectorCodeMobileFramePayload } from '../common/vectorCodeMobileFrameCrypto.js';
import { createVectorCodeMobileRemoteErrorResponse, IVectorCodeMobileRemoteEnvelope, IVectorCodeMobileRelayEncryptedFrame, VectorCodeMobileRelayFrameDirection, VectorCodeMobileRelayOutboundMessage, VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION } from '../common/vectorCodeMobileProtocol.js';
import { isValidVectorCodePhoneRelayFrame, isValidVectorCodeRemoteRequest, VectorCodeMobileRelayReplayGuard } from '../common/vectorCodeMobileRelayValidation.js';
import { VectorCodeReconnectPolicy } from '../common/vectorCodeReconnectPolicy.js';
import { matchVectorCodeRelayIssuerCredential } from '../common/vectorCodeRelayIssuerCredential.js';
import { toString as qrToString } from './vectorCodeQrBundle.js';

const VECTOR_CODE_MOBILE_DESKTOP_ID_STORAGE_KEY = 'vectorCode.mobile.desktopId';
const VECTOR_CODE_MOBILE_PRIVATE_KEY_STORAGE_KEY = 'vectorCode.mobile.privateKeyJwk';
const VECTOR_CODE_MOBILE_RELAY_HOST_STORAGE_KEY = 'vectorCode.mobile.relayHost';
const VECTOR_CODE_MOBILE_RELAY_ISSUER_TOKEN_SECRET_KEY = 'vectorCode.mobile.relayIssuerToken';
const VECTOR_CODE_MOBILE_ACTIVE_RELAY_SESSION_SECRET_KEY = 'vectorCode.mobile.activeRelaySession';
const VECTOR_CODE_MOBILE_PAIRING_TTL_MS = 5 * 60_000;
const VECTOR_CODE_MOBILE_PHONE_RELAY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const VECTOR_CODE_MOBILE_TOKEN_EXPIRY_SKEW_MS = 60_000;
const VECTOR_CODE_MOBILE_RECONNECT_DELAYS_MS = [1_000, 2_500, 5_000, 10_000, 30_000] as const;
const VECTOR_CODE_MOBILE_RECONNECT_STABLE_AFTER_MS = 30_000;

interface IVectorCodeMobileDesktopRelayConnection {
	readonly connectionId: string;
	readonly payload: IVectorCodeMobilePairingPayload;
	readonly replayGuard: VectorCodeMobileRelayReplayGuard;
	phonePairedAt?: string;
	sequence: number;
}

interface IVectorCodeMobileStoredRelaySession {
	readonly payload: IVectorCodeMobilePairingPayload;
	readonly desktopRelayToken: string;
	readonly desktopRelayTokenExpiresAt: string;
	readonly phonePairedAt?: string;
}

interface IVectorCodeMobileRelayToken {
	readonly relayToken: string;
	readonly relayTokenExpiresAt: string;
}

interface IVectorCodeMobilePairingRelayTokens {
	readonly phoneRelayToken: IVectorCodeMobileRelayToken;
	readonly desktopRelayToken: IVectorCodeMobileRelayToken;
}

interface IVectorCodeMobileStoredRelayIssuerCredential {
	readonly relayHost: string;
	readonly token: string;
}

export class VectorCodeMobileRelayService extends Disposable implements IVectorCodeMobileRelayService {
	readonly _serviceBrand: undefined;
	private readonly _onDidChangeStatus = this._register(new Emitter<IVectorCodeMobileConnectionStatus>());
	readonly onDidChangeStatus = this._onDidChangeStatus.event;
	private _lastStatus: IVectorCodeMobileConnectionStatus | undefined;
	private requestHandler: IVectorCodeMobileRemoteRequestHandler | undefined;
	private desktopRelayConnection: IVectorCodeMobileDesktopRelayConnection | undefined;
	private pairingOperation: Promise<IVectorCodeMobileConnectionStatus> | undefined;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private pendingReconnect: { relayHost: string | undefined } | undefined;
	private pairingExpiryTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly reconnectPolicy = new VectorCodeReconnectPolicy(VECTOR_CODE_MOBILE_RECONNECT_DELAYS_MS, VECTOR_CODE_MOBILE_RECONNECT_STABLE_AFTER_MS);

	constructor(
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService,
		@IVectorCodeMobileRelayBridgeService private readonly relayBridgeService: IVectorCodeMobileRelayBridgeService,
	) {
		super();
		this._register(this.relayBridgeService.onDidReceiveMessage(message => {
			void this.handleDesktopRelayMessage(message.connectionId, message.message).catch(() => {
				this.handleDesktopRelayConnectionChange(message.connectionId, 'error');
				void this.relayBridgeService.disconnect(message.connectionId);
			});
		}));
		this._register(this.relayBridgeService.onDidChangeConnection(event => {
			this.handleDesktopRelayConnectionChange(event.connectionId, event.state, event.detail);
		}));
		this._register(toDisposable(() => {
			this.cancelReconnect(false);
			this.cancelPairingExpiry();
			const connection = this.desktopRelayConnection;
			this.desktopRelayConnection = undefined;
			if (connection) {
				void this.relayBridgeService.disconnect(connection.connectionId);
			}
		}));
		this.setStatus({
			state: VectorCodeMobileConnectionState.Reconnecting,
			label: localize('vectorCodeMobileRestoringBridge', 'Restoring phone bridge'),
			detail: localize('vectorCodeMobileRestoringBridgeDetail', 'Checking for a secure saved phone session.'),
			relayHost: this.getStoredRelayHost()
		});
		this.queueDesktopRelayRestore();
	}

	getStatus(): IVectorCodeMobileConnectionStatus {
		if (this._lastStatus) {
			if (this._lastStatus.state === VectorCodeMobileConnectionState.Pairing && this._lastStatus.pairing && Date.parse(this._lastStatus.pairing.payload.expiresAt) <= Date.now()) {
				const pairingId = this._lastStatus.pairing.payload.pairingId;
				this.setStatus({
					state: VectorCodeMobileConnectionState.Expired,
					label: localize('vectorCodeMobilePairingExpired', 'QR expired'),
					detail: localize('vectorCodeMobilePairingExpiredDetail', 'Create a new QR pairing session to connect the mobile app.'),
					relayHost: this._lastStatus.relayHost
				});
				void this.expireUnclaimedPairing(pairingId);
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

	startPairing(relayHost?: string, relayIssuerToken?: string): Promise<IVectorCodeMobileConnectionStatus> {
		if (this.pairingOperation) {
			return this.pairingOperation;
		}
		const operation = this.doStartPairing(relayHost, relayIssuerToken).finally(() => {
			if (this.pairingOperation === operation) {
				this.pairingOperation = undefined;
				const pendingReconnect = this.pendingReconnect;
				this.pendingReconnect = undefined;
				if (pendingReconnect) {
					this.scheduleDesktopRelayReconnect(pendingReconnect.relayHost);
				}
			}
		});
		this.pairingOperation = operation;
		return operation;
	}

	private async doStartPairing(relayHost?: string, relayIssuerToken?: string): Promise<IVectorCodeMobileConnectionStatus> {
		this.cancelReconnect(true);
		const normalizedRelayHost = normalizeVectorCodeRelayHost(relayHost ?? this.getStoredRelayHost());
		if (!normalizedRelayHost) {
			return this.setStatus({
				state: VectorCodeMobileConnectionState.Unconfigured,
				label: localize('vectorCodeMobileRelayHostRequired', 'Phone connection unavailable'),
				detail: localize('vectorCodeMobileRelayHostRequiredDetail', 'Mobile pairing is not configured for this desktop.')
			});
		}

		const previouslyStoredRelayHost = this.getExplicitStoredRelayHost();
		this.storageService.store(VECTOR_CODE_MOBILE_RELAY_HOST_STORAGE_KEY, normalizedRelayHost, StorageScope.APPLICATION, StorageTarget.MACHINE);
		const issuerToken = await this.resolveRelayIssuerToken(relayIssuerToken, normalizedRelayHost, previouslyStoredRelayHost);
		if (!issuerToken) {
			return this.setStatus({
				state: VectorCodeMobileConnectionState.Unconfigured,
				label: localize('vectorCodeMobileRelayIssuerTokenRequired', 'Connection setup required'),
				detail: localize('vectorCodeMobileRelayIssuerTokenRequiredDetail', 'Enter the relay issuer token to create a secure phone pairing QR.'),
				relayHost: normalizedRelayHost,
				requiresRelayIssuerToken: true
			});
		}

		const identity = await this.getOrCreateIdentity();
		const expiresAt = new Date(Date.now() + VECTOR_CODE_MOBILE_PAIRING_TTL_MS).toISOString();
		const desktopId = this.getOrCreateDesktopId();
		const pairingId = cryptoRandomId('pairing');
		const pairingToken = cryptoRandomVectorCodeBase64Url(32);
		const basePairingPayload: IVectorCodeMobilePairingPayload = {
			protocolVersion: VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION,
			desktopId,
			pairingId,
			desktopPublicKey: identity.publicKey,
			desktopPublicKeyFingerprint: identity.publicKeyFingerprint,
			pairingToken,
			relayHost: normalizedRelayHost,
			userId: VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
			expiresAt
		};
		let relayTokens: IVectorCodeMobilePairingRelayTokens | undefined;
		try {
			relayTokens = await this.createPairingRelayTokens({
				relayHost: normalizedRelayHost,
				issuerToken,
				userId: VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
				desktopId,
				pairingId,
				ttlSeconds: VECTOR_CODE_MOBILE_PHONE_RELAY_TOKEN_TTL_SECONDS
			});
		} catch {
			return this.setStatus({
				state: VectorCodeMobileConnectionState.Failed,
				label: localize('vectorCodeMobileRelayUnavailable', 'Relay unavailable'),
				detail: localize('vectorCodeMobileRelayUnavailableDetail', 'The secure relay could not be reached. Check the network and try again.'),
				relayHost: normalizedRelayHost
			});
		}
		if (!relayTokens) {
			return this.setStatus({
				state: VectorCodeMobileConnectionState.Unconfigured,
				label: localize('vectorCodeMobileRelayTokenRejected', 'Relay authorization failed'),
				detail: localize('vectorCodeMobileRelayTokenRejectedDetail', 'Enter a valid relay issuer token, then try the secure phone pairing again.'),
				relayHost: normalizedRelayHost,
				requiresRelayIssuerToken: true
			});
		}
		const payload: IVectorCodeMobilePairingPayload = {
			...basePairingPayload,
			relayToken: relayTokens.phoneRelayToken.relayToken,
			relayTokenExpiresAt: relayTokens.phoneRelayToken.relayTokenExpiresAt
		};

		const previousStatus = this._lastStatus;
		const hadPreviousConnection = Boolean(this.desktopRelayConnection);
		try {
			await this.replaceDesktopRelayConnection(payload, relayTokens.desktopRelayToken, undefined, connection => this.storeActiveRelaySession(payload, relayTokens.desktopRelayToken, connection.phonePairedAt));
		} catch {
			if (hadPreviousConnection && this.desktopRelayConnection && previousStatus) {
				return this.setStatus({
					...previousStatus,
					label: localize('vectorCodeMobileNewPairingFailed', 'New pairing failed'),
					detail: localize('vectorCodeMobileNewPairingFailedExistingDetail', 'The existing phone bridge remains active. Check the relay connection before replacing it.')
				});
			}
			return this.setStatus({
				state: VectorCodeMobileConnectionState.Failed,
				label: localize('vectorCodeMobileDesktopRelayFailed', 'Desktop connection failed'),
				detail: localize('vectorCodeMobileDesktopRelayFailedDetail', 'This desktop could not start the secure phone bridge. Check the network and try again.'),
				relayHost: normalizedRelayHost
			});
		}
		let issuerCredentialSaved = true;
		try {
			await this.storeRelayIssuerCredential(normalizedRelayHost, issuerToken);
		} catch {
			issuerCredentialSaved = false;
		}
		const pairing = await createPairingSession(payload);
		return this.setStatus({
			state: VectorCodeMobileConnectionState.Pairing,
			label: localize('vectorCodeMobilePairingReady', 'QR ready to scan'),
			detail: issuerCredentialSaved
				? localize('vectorCodeMobilePairingReadyDetail', 'Secure phone bridge ready. Scan this QR by {0}.', new Date(expiresAt).toLocaleTimeString())
				: localize('vectorCodeMobilePairingReadyCredentialUnsavedDetail', 'Secure phone bridge ready. Scan this QR by {0}. The issuer token could not be saved and may be required again after restart.', new Date(expiresAt).toLocaleTimeString()),
			relayHost: normalizedRelayHost,
			pairing
		});
	}

	registerRequestHandler(handler: IVectorCodeMobileRemoteRequestHandler): IDisposable {
		this.requestHandler = handler;
		return toDisposable(() => {
			if (this.requestHandler === handler) {
				this.requestHandler = undefined;
			}
		});
	}

	private async replaceDesktopRelayConnection(
		payload: IVectorCodeMobilePairingPayload,
		desktopRelayToken: IVectorCodeMobileRelayToken,
		phonePairedAt?: string,
		activate?: (connection: IVectorCodeMobileDesktopRelayConnection) => Promise<void>
	): Promise<IVectorCodeMobileDesktopRelayConnection> {
		const connectionId = await this.relayBridgeService.connect({
			url: relayWebSocketUrl(payload.relayHost, {
				role: 'desktop',
				userId: payload.userId ?? VECTOR_CODE_MOBILE_DEFAULT_USER_ID,
				desktopId: payload.desktopId,
				deviceId: payload.desktopId,
				pairingId: payload.pairingId
			}),
			authorizationHeader: `Bearer ${desktopRelayToken.relayToken}`
		});
		const previousConnection = this.desktopRelayConnection;
		const connection: IVectorCodeMobileDesktopRelayConnection = {
			connectionId,
			payload,
			replayGuard: new VectorCodeMobileRelayReplayGuard(),
			phonePairedAt,
			sequence: 0
		};
		this.desktopRelayConnection = connection;
		try {
			await activate?.(connection);
		} catch (error) {
			if (this.desktopRelayConnection === connection) {
				this.desktopRelayConnection = previousConnection;
			}
			await this.relayBridgeService.disconnect(connectionId);
			throw error;
		}
		if (previousConnection) {
			await this.relayBridgeService.disconnect(previousConnection.connectionId);
		}
		this.cancelReconnect(false);
		this.reconnectPolicy.markReady();
		this.schedulePairingExpiry(connection);
		return connection;
	}

	private async restoreDesktopRelayConnection(): Promise<void> {
		let session: IVectorCodeMobileStoredRelaySession | undefined;
		try {
			session = await this.readActiveRelaySession();
		} catch {
			this.scheduleDesktopRelayReconnect();
			return;
		}
		if (!session) {
			this.cancelReconnect(true);
			this.setStatus({
				state: VectorCodeMobileConnectionState.Disconnected,
				label: localize('vectorCodeMobileRelayHostConfigured', 'Phone connection ready'),
				detail: localize('vectorCodeMobileRelayHostConfiguredDetail', 'Create a QR pairing session for the mobile app.'),
				relayHost: this.getStoredRelayHost()
			});
			return;
		}

		if (!session.phonePairedAt && Date.parse(session.payload.expiresAt) <= Date.now()) {
			await this.clearActiveRelaySession();
			this.cancelReconnect(true);
			this.setStatus({
				state: VectorCodeMobileConnectionState.Expired,
				label: localize('vectorCodeMobilePairingExpired', 'QR expired'),
				detail: localize('vectorCodeMobilePairingExpiredDetail', 'Create a new QR pairing session to connect the mobile app.'),
				relayHost: session.payload.relayHost
			});
			return;
		}

		if (!session.payload.relayToken || isExpiredIsoDate(session.payload.relayTokenExpiresAt, VECTOR_CODE_MOBILE_TOKEN_EXPIRY_SKEW_MS)) {
			await this.clearActiveRelaySession();
			this.cancelReconnect(true);
			this.setStatus({
				state: VectorCodeMobileConnectionState.Expired,
				label: localize('vectorCodeMobileStoredPairingExpired', 'Phone pairing expired'),
				detail: localize('vectorCodeMobileStoredPairingExpiredDetail', 'Create a fresh QR pairing session to reconnect the mobile app.'),
				relayHost: session.payload.relayHost
			});
			return;
		}

		let desktopRelayToken: IVectorCodeMobileRelayToken | undefined;
		try {
			desktopRelayToken = await this.resolveDesktopRelayToken(session);
		} catch {
			this.scheduleDesktopRelayReconnect(session.payload.relayHost);
			return;
		}
		if (!desktopRelayToken) {
			this.cancelReconnect(true);
			this.setStatus({
				state: VectorCodeMobileConnectionState.Unconfigured,
				label: localize('vectorCodeMobileDesktopRestoreTokenMissing', 'Phone bridge expired'),
				detail: localize('vectorCodeMobileDesktopRestoreTokenMissingDetail', 'Enter the relay issuer token so this desktop can reconnect securely.'),
				relayHost: session.payload.relayHost,
				requiresRelayIssuerToken: true
			});
			return;
		}

		try {
			const connection = await this.replaceDesktopRelayConnection(session.payload, desktopRelayToken, session.phonePairedAt);
			if (this.desktopRelayConnection !== connection || this._lastStatus?.state === VectorCodeMobileConnectionState.Connected) {
				return;
			}
			const pairing = !session.phonePairedAt ? await createPairingSession(session.payload) : undefined;
			this.setStatus(pairing ? {
				state: VectorCodeMobileConnectionState.Pairing,
				label: localize('vectorCodeMobilePairingReady', 'QR ready to scan'),
				detail: localize('vectorCodeMobilePairingReadyDetail', 'Secure phone bridge ready. Scan this QR by {0}.', new Date(session.payload.expiresAt).toLocaleTimeString()),
				relayHost: session.payload.relayHost,
				pairing
			} : {
				state: VectorCodeMobileConnectionState.Pairing,
				label: localize('vectorCodeMobileDesktopBridgeReady', 'Desktop bridge ready'),
				detail: localize('vectorCodeMobileDesktopBridgeReadyDetail', 'Waiting for the paired phone.'),
				relayHost: session.payload.relayHost
			});
		} catch {
			this.scheduleDesktopRelayReconnect(session.payload.relayHost);
		}
	}

	private queueDesktopRelayRestore(relayHost = this.getStoredRelayHost()): void {
		void this.restoreDesktopRelayConnection().catch(() => this.scheduleDesktopRelayReconnect(relayHost));
	}

	private async resolveDesktopRelayToken(session: IVectorCodeMobileStoredRelaySession): Promise<IVectorCodeMobileRelayToken | undefined> {
		if (!isExpiredIsoDate(session.desktopRelayTokenExpiresAt, VECTOR_CODE_MOBILE_TOKEN_EXPIRY_SKEW_MS)) {
			return {
				relayToken: session.desktopRelayToken,
				relayTokenExpiresAt: session.desktopRelayTokenExpiresAt
			};
		}

		const issuerToken = await this.resolveRelayIssuerToken(undefined, session.payload.relayHost, this.getExplicitStoredRelayHost());
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

		await this.storeActiveRelaySession(session.payload, mintedToken, session.phonePairedAt);
		return mintedToken;
	}

	private handleDesktopRelayConnectionChange(connectionId: string, state: 'open' | 'closed' | 'error', detail?: string): void {
		if (this.desktopRelayConnection?.connectionId !== connectionId || state === 'open') {
			return;
		}
		this.desktopRelayConnection = undefined;
		this.scheduleDesktopRelayReconnect(this._lastStatus?.relayHost, detail);
	}

	private scheduleDesktopRelayReconnect(relayHost = this.getStoredRelayHost(), _detail?: string): void {
		if (this.reconnectTimer) {
			return;
		}
		if (this.pairingOperation) {
			this.pendingReconnect = { relayHost };
			return;
		}
		const retry = this.reconnectPolicy.nextRetry();
		this.setStatus({
			state: VectorCodeMobileConnectionState.Reconnecting,
			label: localize('vectorCodeMobileReconnecting', 'Reconnecting phone bridge'),
			detail: localize('vectorCodeMobileReconnectingDetail', 'Retrying the secure relay in {0} seconds (attempt {1}).', Math.ceil(retry.delayMs / 1_000), retry.attempt),
			relayHost
		});
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			this.queueDesktopRelayRestore(relayHost);
		}, retry.delayMs);
	}

	private cancelReconnect(resetPolicy: boolean): void {
		this.pendingReconnect = undefined;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		if (resetPolicy) {
			this.reconnectPolicy.reset();
		}
	}

	private schedulePairingExpiry(connection: IVectorCodeMobileDesktopRelayConnection): void {
		this.cancelPairingExpiry();
		if (connection.phonePairedAt) {
			return;
		}
		const expiresIn = Date.parse(connection.payload.expiresAt) - Date.now();
		if (expiresIn <= 0) {
			void this.expireUnclaimedPairing(connection.payload.pairingId);
			return;
		}
		this.pairingExpiryTimer = setTimeout(() => {
			this.pairingExpiryTimer = undefined;
			void this.expireUnclaimedPairing(connection.payload.pairingId);
		}, expiresIn + 50);
	}

	private cancelPairingExpiry(): void {
		if (this.pairingExpiryTimer) {
			clearTimeout(this.pairingExpiryTimer);
			this.pairingExpiryTimer = undefined;
		}
	}

	private async expireUnclaimedPairing(pairingId: string): Promise<void> {
		const connection = this.desktopRelayConnection;
		let session: IVectorCodeMobileStoredRelaySession | undefined;
		try {
			session = await this.readActiveRelaySession();
		} catch {
			this.setPairingCleanupFailed(connection);
			return;
		}
		const matchesConnection = connection?.payload.pairingId === pairingId && !connection.phonePairedAt;
		const matchesSession = session?.payload.pairingId === pairingId && !session.phonePairedAt;
		if (!matchesConnection && !matchesSession) {
			return;
		}
		try {
			if (matchesConnection && connection) {
				this.desktopRelayConnection = undefined;
				await this.relayBridgeService.disconnect(connection.connectionId);
			}
			if (matchesSession) {
				await this.clearActiveRelaySession();
			}
		} catch {
			this.setPairingCleanupFailed(connection, session);
			return;
		}
		this.cancelPairingExpiry();
		this.cancelReconnect(true);
		if (this._lastStatus?.state !== VectorCodeMobileConnectionState.Connected) {
			this.setStatus({
				state: VectorCodeMobileConnectionState.Expired,
				label: localize('vectorCodeMobilePairingExpired', 'QR expired'),
				detail: localize('vectorCodeMobilePairingExpiredDetail', 'Create a new QR pairing session to connect the mobile app.'),
				relayHost: connection?.payload.relayHost ?? session?.payload.relayHost ?? this.getStoredRelayHost()
			});
		}
	}

	private setPairingCleanupFailed(connection?: IVectorCodeMobileDesktopRelayConnection, session?: IVectorCodeMobileStoredRelaySession): void {
		this.setStatus({
			state: VectorCodeMobileConnectionState.Failed,
			label: localize('vectorCodeMobilePairingExpiryFailed', 'Pairing cleanup failed'),
			detail: localize('vectorCodeMobilePairingExpiryFailedDetail', 'Secure session storage is unavailable. Restart VectorCode, then create a fresh pairing QR.'),
			relayHost: connection?.payload.relayHost ?? session?.payload.relayHost ?? this.getStoredRelayHost()
		});
	}

	private async handleDesktopRelayMessage(connectionId: string, rawMessage: string): Promise<void> {
		const connection = this.desktopRelayConnection;
		if (!connection || connection.connectionId !== connectionId) {
			return;
		}

		let message: unknown;
		try {
			message = JSON.parse(rawMessage) as unknown;
		} catch {
			return;
		}
		if (!isRecord(message) || typeof message.type !== 'string') {
			return;
		}
		if (message.type === 'relay.peer_online' && message.role === 'phone' && message.desktopId === connection.payload.desktopId) {
			if (!await this.acceptPhoneConnection(connection)) {
				return;
			}
			this.setStatus({
				state: VectorCodeMobileConnectionState.Connected,
				label: localize('vectorCodeMobilePhoneConnected', 'Phone connected'),
				detail: localize('vectorCodeMobilePhoneConnectedDetail', 'Mobile app is connected.'),
				relayHost: connection.payload.relayHost
			});
			return;
		}
		if (message.type === 'relay.peer_offline' && message.role === 'phone' && message.desktopId === connection.payload.desktopId && connection.phonePairedAt) {
			this.setStatus({
				state: VectorCodeMobileConnectionState.Pairing,
				label: localize('vectorCodeMobilePhoneDisconnected', 'Phone disconnected'),
				detail: localize('vectorCodeMobilePhoneDisconnectedDetail', 'Waiting for the paired phone to reconnect.'),
				relayHost: connection.payload.relayHost
			});
			return;
		}
		if (message.type !== 'relay.frame' || !isValidVectorCodePhoneRelayFrame(message.frame, connection.payload)) {
			return;
		}
		const frame = message.frame;

		let request: unknown;
		try {
			request = await decryptVectorCodeMobileFramePayload<unknown>({
				pairingToken: connection.payload.pairingToken,
				frame
			});
		} catch {
			return;
		}
		if (!isValidVectorCodeRemoteRequest(request)
			|| request.action !== frame.header.action
			|| !await this.acceptPhoneConnection(connection)
			|| !connection.replayGuard.record(frame)) {
			return;
		}
		const response = await this.createRemoteResponse(request);
		await this.sendDesktopRelayResponse(connection, frame, response);
	}

	private async acceptPhoneConnection(connection: IVectorCodeMobileDesktopRelayConnection): Promise<boolean> {
		if (connection.phonePairedAt) {
			return true;
		}
		if (Date.parse(connection.payload.expiresAt) <= Date.now()) {
			await this.expireUnclaimedPairing(connection.payload.pairingId);
			return false;
		}

		connection.phonePairedAt = new Date().toISOString();
		this.cancelPairingExpiry();
		try {
			const session = await this.readActiveRelaySession();
			if (session?.payload.pairingId === connection.payload.pairingId) {
				await this.storeActiveRelaySession(connection.payload, {
					relayToken: session.desktopRelayToken,
					relayTokenExpiresAt: session.desktopRelayTokenExpiresAt
				}, connection.phonePairedAt);
			}
		} catch {
			// The authenticated connection remains usable for this process. A later
			// reconnect will surface secure-storage recovery if persistence failed.
		}
		return true;
	}

	private async createRemoteResponse(request: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope> {
		if (request.kind !== 'request') {
			return createVectorCodeMobileRemoteErrorResponse(request, 'invalid_kind', 'Expected a request envelope.');
		}
		if (!this.requestHandler) {
			return createVectorCodeMobileRemoteErrorResponse(request, 'desktop_handler_missing', 'The desktop bridge is not ready.');
		}
		try {
			return await this.requestHandler.handleVectorCodeMobileRemoteRequest(request);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'The desktop bridge failed to handle the request.';
			return createVectorCodeMobileRemoteErrorResponse(request, 'desktop_request_failed', message);
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

	private setStatus(status: IVectorCodeMobileConnectionStatus): IVectorCodeMobileConnectionStatus {
		this._lastStatus = status;
		this._onDidChangeStatus.fire(status);
		return status;
	}

	private getStoredRelayHost(): string | undefined {
		return this.getExplicitStoredRelayHost() ?? VECTOR_CODE_MOBILE_DEFAULT_RELAY_HOST;
	}

	private getExplicitStoredRelayHost(): string | undefined {
		return normalizeVectorCodeRelayHost(this.storageService.get(VECTOR_CODE_MOBILE_RELAY_HOST_STORAGE_KEY, StorageScope.APPLICATION));
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
			publicKey: encodeVectorCodeBase64Url(new Uint8Array(publicKey)),
			publicKeyFingerprint: await sha256Base64Url(new Uint8Array(publicKey))
		};
	}

	private async resolveRelayIssuerToken(input: string | undefined, relayHost: string, legacyRelayHost: string | undefined): Promise<string | undefined> {
		const token = input?.trim();
		if (token) {
			return token;
		}

		const storedCredential = (await this.secretStorageService.get(VECTOR_CODE_MOBILE_RELAY_ISSUER_TOKEN_SECRET_KEY))?.trim();
		if (!storedCredential) {
			return undefined;
		}
		const match = matchVectorCodeRelayIssuerCredential(storedCredential, relayHost, legacyRelayHost);
		if (!match) {
			return undefined;
		}
		if (match.requiresMigration) {
			await this.storeRelayIssuerCredential(relayHost, match.token);
		}
		return match.token;
	}

	private async storeRelayIssuerCredential(relayHost: string, token: string): Promise<void> {
		const credential: IVectorCodeMobileStoredRelayIssuerCredential = { relayHost, token };
		await this.secretStorageService.set(VECTOR_CODE_MOBILE_RELAY_ISSUER_TOKEN_SECRET_KEY, JSON.stringify(credential));
	}

	private async createPairingRelayTokens(input: {
		relayHost: string;
		issuerToken: string;
		userId: string;
		desktopId: string;
		pairingId: string;
		ttlSeconds: number;
	}): Promise<IVectorCodeMobilePairingRelayTokens | undefined> {
		const [phoneRelayToken, desktopRelayToken] = await Promise.all([
			this.createRelayToken({ ...input, role: 'phone' }),
			this.createRelayToken({ ...input, role: 'desktop' })
		]);
		if (!phoneRelayToken || !desktopRelayToken) {
			return undefined;
		}
		return { phoneRelayToken, desktopRelayToken };
	}

	private async createRelayToken(input: {
		relayHost: string;
		issuerToken: string;
		role: 'phone' | 'desktop';
		userId: string;
		desktopId: string;
		pairingId?: string;
		ttlSeconds: number;
	}): Promise<IVectorCodeMobileRelayToken | undefined> {
		return this.relayBridgeService.createRelayToken({
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
	}

	private async storeActiveRelaySession(payload: IVectorCodeMobilePairingPayload, desktopRelayToken: IVectorCodeMobileRelayToken, phonePairedAt?: string): Promise<void> {
		const session: IVectorCodeMobileStoredRelaySession = {
			payload,
			desktopRelayToken: desktopRelayToken.relayToken,
			desktopRelayTokenExpiresAt: desktopRelayToken.relayTokenExpiresAt,
			phonePairedAt
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
				const relayHost = normalizeVectorCodeRelayHost(candidate.payload.relayHost);
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
					}, migratedSession.phonePairedAt);
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
	const phonePairedAt = value.phonePairedAt;
	return isPairingPayload(value.payload)
		&& typeof value.desktopRelayToken === 'string'
		&& value.desktopRelayToken.length > 0
		&& typeof value.desktopRelayTokenExpiresAt === 'string'
		&& value.desktopRelayTokenExpiresAt.length > 0
		&& (phonePairedAt === undefined || (typeof phonePairedAt === 'string' && isValidIsoDate(phonePairedAt)));
}

function isPairingPayload(value: unknown): value is IVectorCodeMobilePairingPayload {
	if (!isRecord(value)) {
		return false;
	}
	return value.protocolVersion === VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION
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

function isValidIsoDate(value: string): boolean {
	return Number.isFinite(Date.parse(value));
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
	const uuid = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : cryptoRandomVectorCodeBase64Url(16);
	return `${prefix}_${uuid}`;
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return encodeVectorCodeBase64Url(new Uint8Array(digest));
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
