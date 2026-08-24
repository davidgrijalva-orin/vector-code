/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import * as sinon from 'sinon';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestSecretStorageService } from '../../../../../platform/secrets/test/common/testSecretStorageService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { VectorCodeRuntimeErrorCode, VectorCodeRuntimeState } from '../../../../../platform/vectorCode/common/vectorCodeRuntime.js';
import { IVectorCodeMobileRelayBridgeConnectOptions, IVectorCodeMobileRelayBridgeConnectionChange, IVectorCodeMobileRelayBridgeMessage, IVectorCodeMobileRelayBridgeSendOptions, IVectorCodeMobileRelayBridgeService, IVectorCodeMobileRelayBridgeTokenOptions, IVectorCodeMobileRelayBridgeTokenResponse } from '../../../../../platform/vectorCodeMobile/common/vectorCodeMobileRelayBridge.js';
import { VectorCodeMobileRelayService } from '../../browser/vectorCodeMobileRelayService.js';
import { VECTOR_CODE_MOBILE_CAPABILITY_REMOTE, VectorCodeMobileConnectionState } from '../../common/vectorCode.js';

suite('VectorCodeMobileRelayService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const now = Date.parse('2026-08-24T05:00:00.000Z');
	let bridge: TestVectorCodeMobileRelayBridge;
	let service: VectorCodeMobileRelayService;
	let secretStorage: TestSecretStorageService;
	let storageService: InMemoryStorageService;
	let clock: sinon.SinonFakeTimers;

	setup(async () => {
		clock = sinon.useFakeTimers({ now });
		disposables.add(toDisposable(() => clock.restore()));
		storageService = disposables.add(new InMemoryStorageService());
		await storageService.initialize();
		bridge = disposables.add(new TestVectorCodeMobileRelayBridge());
		secretStorage = disposables.add(new TestSecretStorageService());
		service = disposables.add(new VectorCodeMobileRelayService(
			secretStorage,
			storageService,
			bridge
		));
		await flushMicrotasks();
	});

	const recreateService = async (): Promise<void> => {
		service.dispose();
		service = disposables.add(new VectorCodeMobileRelayService(secretStorage, storageService, bridge));
		await waitForInitialRestore(service);
	};

	test('reading status does not append lifecycle diagnostics', () => {
		const eventCount = service.getDiagnosticSummary().recentEvents.length;
		service.getStatus();
		service.getStatus();
		strictEqual(service.getDiagnosticSummary().recentEvents.length, eventCount);
	});

	test('keeps the current bridge when refresh fails and enforces QR expiry', async () => {
		const first = await service.startPairing('relay.example.test', 'issuer-token');
		strictEqual(first.state, VectorCodeMobileConnectionState.Pairing);
		strictEqual(bridge.connectCount, 1);

		bridge.failNextConnect = true;
		const failedRefresh = await service.startPairing('other.example.test', 'replacement-issuer-token');
		strictEqual(failedRefresh.state, VectorCodeMobileConnectionState.Pairing);
		strictEqual(failedRefresh.label, 'New pairing failed');
		strictEqual(bridge.disconnected.includes('connection-1'), false);
		deepStrictEqual(JSON.parse((await secretStorage.get('vectorCode.mobile.relayIssuerToken')) ?? ''), {
			relayHost: 'relay.example.test',
			token: 'issuer-token'
		});

		await clock.tickAsync(5 * 60_000 + 100);
		strictEqual(service.getStatus().state, VectorCodeMobileConnectionState.Expired);
		strictEqual(bridge.disconnected.includes('connection-1'), true);
	});

	test('a phone accepted during the scan window survives QR expiry', async () => {
		const pairing = await service.startPairing('relay.example.test', 'issuer-token');
		strictEqual(pairing.state, VectorCodeMobileConnectionState.Pairing);
		if (!pairing.pairing) {
			throw new Error('Expected a pairing payload.');
		}
		bridge.emitMessage('connection-1', {
			type: 'relay.peer_online',
			role: 'phone',
			desktopId: pairing.pairing.payload.desktopId
		});
		await flushMicrotasks();
		strictEqual(service.getStatus().state, VectorCodeMobileConnectionState.Connected);
		strictEqual(service.getStatus().runtime.state, VectorCodeRuntimeState.Ready);
		strictEqual(service.getStatus().runtime.capabilities.includes(VECTOR_CODE_MOBILE_CAPABILITY_REMOTE), true);

		await clock.tickAsync(5 * 60_000 + 100);
		strictEqual(service.getStatus().state, VectorCodeMobileConnectionState.Connected);
		strictEqual(bridge.disconnected.includes('connection-1'), false);
	});

	test('reconnects when the current bridge closes during a failed refresh', async () => {
		await service.startPairing('relay.example.test', 'issuer-token');
		bridge.closeConnectionOnNextConnect = 'connection-1';
		bridge.failNextConnect = true;

		const failedRefresh = await service.startPairing();
		strictEqual(failedRefresh.state, VectorCodeMobileConnectionState.Failed);
		strictEqual(service.getStatus().state, VectorCodeMobileConnectionState.Reconnecting);

		await clock.tickAsync(1_000);
		strictEqual(service.getStatus().state, VectorCodeMobileConnectionState.Pairing);
		strictEqual(bridge.connectCount, 3);
	});

	test('quarantines corrupt secure state and restores the last known-good phone session', async () => {
		await service.startPairing('relay.example.test', 'issuer-token');
		const knownGood = await secretStorage.get('vectorCode.mobile.knownGoodRelaySession');
		strictEqual(typeof knownGood, 'string');

		await secretStorage.set('vectorCode.mobile.activeRelaySession', '{broken');
		await recreateService();

		strictEqual(await secretStorage.get('vectorCode.mobile.activeRelaySession'), knownGood);
		const serializedQuarantine = (await secretStorage.get('vectorCode.mobile.quarantinedRelaySession')) ?? '{}';
		const quarantine = JSON.parse(serializedQuarantine) as { byteLength?: number; sha256?: string; value?: string };
		strictEqual(quarantine.byteLength, 7);
		strictEqual(typeof quarantine.sha256, 'string');
		strictEqual(quarantine.value, undefined);
		strictEqual(serializedQuarantine.includes('{broken'), false);
		const summary = service.getDiagnosticSummary();
		strictEqual(summary.recentEvents.some(event => event.event === 'storage.relay_session.rolled_back' && event.errorCode === VectorCodeRuntimeErrorCode.StorageCorrupt), true);
	});

	test('recovers corrupt secure state when session fingerprinting is unavailable', async () => {
		await service.startPairing('relay.example.test', 'issuer-token');
		const knownGood = await secretStorage.get('vectorCode.mobile.knownGoodRelaySession');
		await secretStorage.set('vectorCode.mobile.activeRelaySession', '{broken-without-digest');
		const digestStub = sinon.stub(globalThis.crypto.subtle, 'digest').rejects(new Error('Digest unavailable'));

		try {
			await recreateService();
		} finally {
			digestStub.restore();
		}

		strictEqual(await secretStorage.get('vectorCode.mobile.activeRelaySession'), knownGood);
		const quarantine = JSON.parse((await secretStorage.get('vectorCode.mobile.quarantinedRelaySession')) ?? '{}') as { byteLength?: number; sha256?: string; value?: string };
		strictEqual(quarantine.byteLength, 22);
		strictEqual(quarantine.sha256, undefined);
		strictEqual(quarantine.value, undefined);
		const summary = service.getDiagnosticSummary();
		strictEqual(summary.recentEvents.some(event => event.event === 'storage.relay_session.fingerprint_failed' && event.errorCode === VectorCodeRuntimeErrorCode.StorageUnavailable), true);
		strictEqual(summary.recentEvents.some(event => event.event === 'storage.relay_session.rolled_back' && event.errorCode === VectorCodeRuntimeErrorCode.StorageCorrupt), true);
	});

	test('restores a valid snapshot when a partial write omitted the active session', async () => {
		await service.startPairing('relay.example.test', 'issuer-token');
		const knownGood = await secretStorage.get('vectorCode.mobile.knownGoodRelaySession');
		await secretStorage.delete('vectorCode.mobile.activeRelaySession');

		await recreateService();

		strictEqual(await secretStorage.get('vectorCode.mobile.activeRelaySession'), knownGood);
		strictEqual(service.getDiagnosticSummary().recentEvents.some(event => event.event === 'storage.relay_session.restored_missing_active'), true);
	});

	test('resets invalid active and known-good sessions without retaining raw quarantine data', async () => {
		await service.startPairing('relay.example.test', 'issuer-token');
		await secretStorage.set('vectorCode.mobile.activeRelaySession', '{active-broken');
		await secretStorage.set('vectorCode.mobile.knownGoodRelaySession', '{snapshot-broken');

		await recreateService();

		strictEqual(await secretStorage.get('vectorCode.mobile.activeRelaySession'), undefined);
		strictEqual(await secretStorage.get('vectorCode.mobile.knownGoodRelaySession'), undefined);
		strictEqual(await secretStorage.get('vectorCode.mobile.quarantinedRelaySession'), undefined);
		strictEqual(service.getDiagnosticSummary().recentEvents.some(event => event.event === 'storage.relay_session.reset' && event.errorCode === VectorCodeRuntimeErrorCode.StorageCorrupt), true);
	});
});

class TestVectorCodeMobileRelayBridge extends Disposable implements IVectorCodeMobileRelayBridgeService {
	declare readonly _serviceBrand: undefined;
	private readonly _onDidReceiveMessage = this._register(new Emitter<IVectorCodeMobileRelayBridgeMessage>());
	readonly onDidReceiveMessage = this._onDidReceiveMessage.event;
	private readonly _onDidChangeConnection = this._register(new Emitter<IVectorCodeMobileRelayBridgeConnectionChange>());
	readonly onDidChangeConnection = this._onDidChangeConnection.event;
	readonly disconnected: string[] = [];
	connectCount = 0;
	failNextConnect = false;
	closeConnectionOnNextConnect: string | undefined;

	async connect(_options: IVectorCodeMobileRelayBridgeConnectOptions): Promise<string> {
		this.connectCount += 1;
		if (this.closeConnectionOnNextConnect) {
			this._onDidChangeConnection.fire({ connectionId: this.closeConnectionOnNextConnect, state: 'closed' });
			this.closeConnectionOnNextConnect = undefined;
		}
		if (this.failNextConnect) {
			this.failNextConnect = false;
			throw new Error('Relay unavailable');
		}
		return `connection-${this.connectCount}`;
	}

	async createRelayToken(options: IVectorCodeMobileRelayBridgeTokenOptions): Promise<IVectorCodeMobileRelayBridgeTokenResponse> {
		return {
			relayToken: `${options.payload.role}-token-${this.connectCount}`,
			relayTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString()
		};
	}

	async send(_options: IVectorCodeMobileRelayBridgeSendOptions): Promise<void> { }

	async disconnect(connectionId: string): Promise<void> {
		this.disconnected.push(connectionId);
	}

	emitMessage(connectionId: string, message: unknown): void {
		this._onDidReceiveMessage.fire({ connectionId, message: JSON.stringify(message) });
	}
}

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 10; index++) {
		await Promise.resolve();
	}
}

async function waitForInitialRestore(service: VectorCodeMobileRelayService): Promise<void> {
	if (service.getStatus().state !== VectorCodeMobileConnectionState.Reconnecting) {
		return;
	}
	await new Promise<void>(resolve => {
		const listener = service.onDidChangeStatus(status => {
			if (status.state !== VectorCodeMobileConnectionState.Reconnecting) {
				listener.dispose();
				resolve();
			}
		});
		if (service.getStatus().state !== VectorCodeMobileConnectionState.Reconnecting) {
			listener.dispose();
			resolve();
		}
	});
}
