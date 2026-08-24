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
import { IVectorCodeMobileRelayBridgeConnectOptions, IVectorCodeMobileRelayBridgeConnectionChange, IVectorCodeMobileRelayBridgeMessage, IVectorCodeMobileRelayBridgeService, IVectorCodeMobileRelayBridgeTokenOptions, IVectorCodeMobileRelayBridgeTokenResponse } from '../../../../../platform/vectorCodeMobile/common/vectorCodeMobileRelayBridge.js';
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
		service.dispose();
		service = disposables.add(new VectorCodeMobileRelayService(secretStorage, storageService, bridge));
		await flushMicrotasks();

		strictEqual(await secretStorage.get('vectorCode.mobile.activeRelaySession'), knownGood);
		const quarantine = JSON.parse((await secretStorage.get('vectorCode.mobile.quarantinedRelaySession')) ?? '{}') as { value?: string };
		strictEqual(quarantine.value, '{broken');
		const summary = service.getDiagnosticSummary();
		strictEqual(summary.recentEvents.some(event => event.event === 'storage.relay_session.rolled_back' && event.errorCode === VectorCodeRuntimeErrorCode.StorageCorrupt), true);
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

	async send(_connectionId: string, _message: string): Promise<void> { }

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
