/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual, rejects, ok } from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEncryptionMainService, KnownStorageProvider } from '../../../encryption/common/encryptionService.js';
import { IStateService } from '../../../state/node/state.js';
import { VectorVoiceAuth, VECTOR_VOICE_ORIGIN } from '../../node/vectorVoiceAuth.js';

suite('Vector Voice native authorization', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const accessToken = 'header.' + Buffer.from(JSON.stringify({ sub: 'user-a', iss: 'https://api.workos.com', org_id: 'org-a' })).toString('base64url') + '.signature';
	let saved: Map<string, unknown>; let responses: Response[]; let calls: { url: string; init: RequestInit }[]; let encryption: IEncryptionMainService;
	setup(() => {
		saved = new Map(); responses = []; calls = [];
		encryption = { _serviceBrand: undefined, isEncryptionAvailable: async () => true, getKeyStorageProvider: async () => KnownStorageProvider.keychainAccess, encrypt: async value => Buffer.from(value).toString('base64'), decrypt: async value => Buffer.from(value, 'base64').toString(), setUsePlainTextEncryption: async () => { } };
	});
	function create() {
		const state = { getItem: (key: string) => saved.get(key), setItem: (key: string, value: unknown) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) } as unknown as IStateService;
		return disposables.add(new VectorVoiceAuth(encryption, state, async (url, init) => { calls.push({ url, init }); return responses.shift()!; }));
	}
	async function begin(auth: VectorVoiceAuth) {
		responses.push(Response.json({ platform: 'vectorcode', clientId: 'client_test123456', redirectUri: 'vector-code://vectorvoice/auth/callback' }));
		const connection = await auth.beginSignIn(); return new URL(connection.authorizationUrl!);
	}
	test('uses PKCE and state, consumes callback once, and stores Voice credentials separately', async () => {
		saved.set('vectorGraph.session.v1', 'Graph session preserved');
		const auth = create(); const url = await begin(auth);
		strictEqual(url.origin, 'https://api.workos.com'); strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
		await auth.handleURL(URI.parse('vector-code://vectorvoice/auth/callback?state=wrong&code=authorization-code'));
		strictEqual(calls.length, 1);
		responses.push(Response.json({ accessToken, refreshToken: 'refresh-secret' }));
		const callback = URI.parse('vector-code://vectorvoice/auth/callback?state=' + url.searchParams.get('state') + '&code=authorization-code');
		await auth.handleURL(callback); await auth.handleURL(callback);
		strictEqual(calls.length, 2);
		const exchange = JSON.parse(String(calls[1].init.body));
		ok(exchange.codeVerifier.length >= 43); strictEqual(url.toString().includes(exchange.codeVerifier), false);
		strictEqual(calls[1].url, VECTOR_VOICE_ORIGIN + '/api/native-auth/exchange');
		deepStrictEqual(await auth.connection(), { connected: true, authorizationUrl: undefined });
		strictEqual(JSON.stringify([...saved.values()]).includes('refresh-secret'), false);
		await auth.signOut(); strictEqual(saved.get('vectorGraph.session.v1'), 'Graph session preserved');
		strictEqual((await auth.connection()).connected, false);
	});
	test('sign-out wins an exchange racing encrypted persistence', async () => {
		const auth = create(); const url = await begin(auth); const encrypted = new DeferredPromise<string>();
		encryption.encrypt = () => encrypted.p;
		responses.push(Response.json({ accessToken, refreshToken: 'refresh-secret' }));
		const exchange = auth.handleURL(URI.parse('vector-code://vectorvoice/auth/callback?state=' + url.searchParams.get('state') + '&code=authorization-code'));
		await auth.signOut(); await encrypted.complete('encrypted');
		await rejects(exchange, /session changed/); strictEqual(saved.has('vectorVoice.session.v1'), false);
	});
	test('refresh retries preserve payload and idempotency while preventing account substitution', async () => {
		saved.set('vectorVoice.session.v1', Buffer.from(JSON.stringify({ accessToken, refreshToken: 'refresh-secret' })).toString('base64'));
		const auth = create(); const account = await auth.accountKey();
		responses.push(new Response('', { status: 401 }), Response.json({ accessToken, refreshToken: 'rotated-secret' }), Response.json({ ok: true }));
		const body = new FormData(); body.set('source', 'upload');
		await auth.authorized('/api/v1/transcriptions', { method: 'POST', body, headers: { 'idempotency-key': 'same-request' } }, account);
		strictEqual(calls[0].init.body, calls[2].init.body);
		strictEqual(new Headers(calls[2].init.headers).get('idempotency-key'), 'same-request');
		strictEqual(calls[2].init.redirect, 'error');
		await rejects(auth.authorized('/api/v1/transcriptions', {}, 'other-account'), /Connect Voice/);
		await rejects(auth.authorized('https://attacker.test'), /Unsupported/);
		strictEqual(calls.length, 3);
	});
	test('rejects insecure credential storage and unexpected callback configuration', async () => {
		const auth = create(); encryption.getKeyStorageProvider = async () => KnownStorageProvider.basicText;
		await rejects(auth.beginSignIn(), /credential store/); strictEqual(calls.length, 0);
		encryption.getKeyStorageProvider = async () => KnownStorageProvider.keychainAccess;
		responses.push(Response.json({ platform: 'vectorcode', clientId: 'client_test123456', redirectUri: 'attacker://callback' }));
		await rejects(auth.beginSignIn(), /invalid sign-in configuration/);
	});
});
