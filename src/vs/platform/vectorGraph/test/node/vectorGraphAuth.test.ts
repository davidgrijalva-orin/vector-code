/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual, rejects } from 'assert';
import { isVectorGraphConnectionError } from '../../common/vectorGraph.js';
import { isVectorGraphRepositoryUnavailable } from '../../node/vectorGraphRepository.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEncryptionMainService, KnownStorageProvider } from '../../../encryption/common/encryptionService.js';
import { IStateService } from '../../../state/node/state.js';
import { VectorGraphAuth } from '../../node/vectorGraphAuth.js';

suite('VectorGraph IDE authorization', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const workspace = { id: 'bf275fab-fe03-44c3-b993-ced522c45a07', name: 'VectorCode' };
	const profiles = [{ workspace, token: 'test-private-token' }];
	let saved: Map<string, unknown>;
	let requests: { url: string; init: RequestInit }[];
	let responses: (() => Promise<Response>)[];
	let encryption: IEncryptionMainService;
	let state: IStateService;
	const response = (body: object, status = 200) => async () => new Response(JSON.stringify(body), { status });
	const approval = () => response({ apiUrl: 'https://vectorgraph.app', activeWorkspaceId: workspace.id, profiles });
	function create() {
		return store.add(new VectorGraphAuth(encryption, state, async (url, init) => {
			requests.push({ url, init });
			const next = responses.shift();
			if (!next) { throw new Error('Unexpected request'); }
			return next();
		}));
	}
	setup(() => {
		saved = new Map(); requests = [];
		responses = [response({ apiUrl: 'https://vectorgraph.app', deviceCode: 'private-device-code', verificationUriComplete: 'https://vectorgraph.app/cli/authorize?code=TEST', userCode: 'TEST', expiresAt: new Date(Date.now() + 60000).toISOString(), intervalSeconds: 5 })];
		encryption = {
			_serviceBrand: undefined, isEncryptionAvailable: async () => true, getKeyStorageProvider: async () => KnownStorageProvider.keychainAccess,
			encrypt: async (value: string) => Buffer.from(value).toString('base64'), decrypt: async (value: string) => Buffer.from(value, 'base64').toString(), setUsePlainTextEncryption: async () => { }
		};
		state = { getItem: (key: string) => saved.get(key), setItem: (key: string, value: unknown) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) } as unknown as IStateService;
	});

	test('classifies expected non-repositories without hiding Git failures', () => {
		strictEqual(isVectorGraphRepositoryUnavailable(1, '', false), true);
		strictEqual(isVectorGraphRepositoryUnavailable('ENOENT', '', false), true);
		strictEqual(isVectorGraphRepositoryUnavailable(128, 'fatal: --local can only be used inside a git repository', false), true);
		strictEqual(isVectorGraphRepositoryUnavailable(128, 'fatal: bad config line 1', false), false);
		strictEqual(isVectorGraphRepositoryUnavailable(1, '', true), false);
	});

	test('transient polling errors retain authorization, terminal errors clear it', async () => {
		for (const status of [503, 429, 401, 403]) {
			const auth = create();
			if (!responses.length) { responses.push(response({ apiUrl: 'https://vectorgraph.app', deviceCode: 'private-device-code', verificationUriComplete: 'https://vectorgraph.app/cli/authorize?code=TEST', userCode: 'TEST', expiresAt: new Date(Date.now() + 60000).toISOString(), intervalSeconds: 5 })); }
			await auth.beginSignIn(); responses.push(response({}, status));
			await rejects(auth.pollSignIn(), error => isVectorGraphConnectionError(error) === (status === 503 || status === 429));
			strictEqual(!!(await auth.getSession()).authorization, status === 503 || status === 429);
		}
	});

	test('reconnect during decryption preserves the existing account; sign-out remains authoritative', async () => {
		saved.set('vectorGraph.session.v1', 'encrypted');
		const pending = new DeferredPromise<string>();
		encryption.decrypt = () => pending.p;
		const auth = create();
		const session = auth.getSession();
		const reconnect = auth.beginSignIn();
		await Promise.resolve(); await Promise.resolve();
		await pending.complete(JSON.stringify(profiles));
		deepStrictEqual((await session).workspaces, [workspace]);
		await reconnect;
		await auth.signOut();
		deepStrictEqual((await auth.getSession()).workspaces, []);
	});
	test('authorizes, encrypts and restores IDE-only credentials without exporting secrets', async () => {
		const auth = create();
		const started = await auth.beginSignIn();
		strictEqual(started.authorization?.code, 'TEST');
		strictEqual(JSON.stringify(started).includes('private-device-code'), false);
		responses.push(approval());
		const session = await auth.pollSignIn();
		deepStrictEqual(session, { workspaces: [workspace], authorization: undefined });
		strictEqual(JSON.stringify([...saved.values()]).includes('test-private-token'), false);
		deepStrictEqual(await create().getSession(), session);
		responses.push(response({ teams: [] }));
		await auth.call(workspace.id, 'listApiTeams');
		strictEqual((requests[2].init.headers as Record<string, string>).authorization, 'Bearer test-private-token');
		strictEqual(requests[2].init.redirect, 'error');
		await auth.signOut();
		strictEqual(saved.size, 0);
		await rejects(auth.call(workspace.id, 'listApiTeams'), /Sign in/);
	});
	test('conflicts retain authorization and describe recovery without another login', async () => {
		const auth = create();
		await auth.beginSignIn(); responses.push(approval()); await auth.pollSignIn();
		responses.push(response({ error: { code: 'document_version_conflict' } }, 409));
		await rejects(auth.call(workspace.id, 'updateApiWorkspaceDocument'), /conflicting change/);
		deepStrictEqual((await auth.getSession()).workspaces, [workspace]);
	});
	test('canceling reconnect preserves the authorized account', async () => {
		const auth = create();
		await auth.beginSignIn(); responses.push(approval()); await auth.pollSignIn();
		responses.push(response({ apiUrl: 'https://vectorgraph.app', deviceCode: 'new-private-device-code', verificationUriComplete: 'https://vectorgraph.app/cli/authorize?code=NEXT', userCode: 'NEXT', expiresAt: new Date(Date.now() + 60000).toISOString(), intervalSeconds: 5 }));
		await auth.beginSignIn();
		await auth.cancelSignIn();
		deepStrictEqual(await auth.getSession(), { workspaces: [workspace], authorization: undefined });
		strictEqual(saved.size, 1);
	});

	test('corrupt stored credentials produce a safe recovery error', async () => {
		saved.set('vectorGraph.session.v1', Buffer.from('invalid private-secret').toString('base64'));
		await rejects(create().getSession(), error => error instanceof Error && error.message.includes('Sign out') && !error.message.includes('private-secret'));
	});

	test('late approval cannot restore a signed-out session', async () => {
		const auth = create();
		await auth.beginSignIn();
		const pending = new DeferredPromise<Response>();
		responses.push(() => pending.p);
		const poll = auth.pollSignIn();
		await auth.signOut();
		await pending.complete(await approval()());
		deepStrictEqual((await poll).workspaces, []);
		strictEqual(saved.size, 0);
	});
	test('deduplicates polling and respects the server interval', async () => {
		const auth = create();
		await auth.beginSignIn();
		responses.push(response({ error: { code: 'authorization_pending' } }, 202));
		await Promise.all([auth.pollSignIn(), auth.pollSignIn()]);
		await auth.pollSignIn();
		strictEqual(requests.length, 2);
	});
	test('rejects external verification origins and insecure credential storage', async () => {
		responses[0] = response({ apiUrl: 'https://vectorgraph.app', verificationUriComplete: 'https://evil.test/approve', expiresAt: new Date(Date.now() + 60000).toISOString() });
		await rejects(create().beginSignIn(), /invalid authorization/);
		encryption.getKeyStorageProvider = async () => KnownStorageProvider.basicText;
		await rejects(create().beginSignIn(), /credential store/);
	});
	test('does not return data from a request completed after sign-out', async () => {
		const auth = create();
		await auth.beginSignIn(); responses.push(approval()); await auth.pollSignIn();
		const pending = new DeferredPromise<Response>(); responses.push(() => pending.p);
		const result = auth.call(workspace.id, 'listApiTeams');
		await Promise.resolve();
		await auth.signOut();
		await pending.complete(await response({ teams: [] })());
		await rejects(result, /account changed/);
	});
});
