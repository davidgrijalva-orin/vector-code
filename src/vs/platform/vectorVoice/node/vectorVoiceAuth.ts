/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VoiceConnection } from '../common/vectorVoice.js';
import { createHash, randomBytes } from 'crypto';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { IEncryptionMainService, KnownStorageProvider } from '../../encryption/common/encryptionService.js';
import { IStateService } from '../../state/node/state.js';

export const VECTOR_VOICE_ORIGIN = 'https://web-production-27ff4.up.railway.app';
const callback = 'vector-code://vectorvoice/auth/callback';
const sessionKey = 'vectorVoice.session.v1';
interface Tokens { accessToken: string; refreshToken: string }
interface Pending { state: string; verifier: string; expiresAt: number; url: string }


/** Voice credentials never enter the renderer or the separate Graph session. */
export class VectorVoiceAuth extends Disposable {
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private pending: Pending | undefined;
	private generation = 0;
	private refreshing: Promise<Tokens> | undefined;
	constructor(private readonly encryption: IEncryptionMainService, private readonly state: IStateService, private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>) { super(); }
	private async load(): Promise<Tokens | undefined> {
		const value = this.state.getItem<string>(sessionKey);
		if (!value) { return undefined; }
		try { return this.tokens(JSON.parse(await this.encryption.decrypt(value))); }
		catch { throw new Error('Cannot unlock Voice sign-in. Sign out of Voice and reconnect.'); }
	}
	private tokens(value: unknown): Tokens {
		if (!value || typeof value !== 'object') { throw new Error('Invalid Voice session.'); }
		const result = value as Tokens;
		if (typeof result.accessToken !== 'string' || typeof result.refreshToken !== 'string' || result.accessToken.length < 8 || result.refreshToken.length < 8 || result.accessToken.length > 8192 || result.refreshToken.length > 4096) { throw new Error('Invalid Voice session.'); }
		return { accessToken: result.accessToken, refreshToken: result.refreshToken };
	}
	async connection(): Promise<VoiceConnection> {
		const generation = this.generation; const tokens = await this.load();
		return { connected: generation === this.generation && !!tokens, authorizationUrl: this.pending && this.pending.expiresAt > Date.now() ? this.pending.url : undefined };
	}
	async beginSignIn(): Promise<VoiceConnection> {
		if (!await this.encryption.isEncryptionAvailable() || await this.encryption.getKeyStorageProvider() === KnownStorageProvider.basicText) { throw new Error('Unlock the system credential store before connecting Voice.'); }
		const generation = ++this.generation;
		this.pending = undefined;
		const response = await this.request('/api/native-auth/configuration?platform=vectorcode');
		if (!response.ok) { throw new Error('Voice sign-in for Vector Code is not configured on the service yet.'); }
		const config = await response.json() as { platform?: string; clientId?: string; redirectUri?: string };
		if (config.platform !== 'vectorcode' || config.redirectUri !== callback || typeof config.clientId !== 'string' || !/^client_[A-Za-z0-9]{8,100}$/.test(config.clientId)) { throw new Error('Voice returned invalid sign-in configuration.'); }
		const verifier = randomBytes(32).toString('base64url'); const state = randomBytes(32).toString('base64url');
		const url = new URL('https://api.workos.com/user_management/authorize');
		url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: callback, provider: 'authkit', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), state, screen_hint: 'sign-in' }).toString();
		if (generation === this.generation) { this.pending = { state, verifier, expiresAt: Date.now() + 600000, url: url.toString() }; this.changed.fire(); }
		return this.connection();
	}
	async handleURL(uri: URI): Promise<boolean> {
		if (uri.scheme !== 'vector-code' || uri.authority !== 'vectorvoice' || uri.path !== '/auth/callback') { return false; }
		const pending = this.pending; const query = new URLSearchParams(uri.query);
		if (!pending || pending.expiresAt <= Date.now() || query.get('state') !== pending.state) { return true; }
		this.pending = undefined;
		const generation = this.generation;
		const code = query.get('code');
		if (!code || code.length < 8 || code.length > 2000 || query.has('error')) { this.changed.fire(); return true; }
		const response = await this.request('/api/native-auth/exchange', { platform: 'vectorcode', code, codeVerifier: pending.verifier, redirectUri: callback });
		if (!response.ok) { this.changed.fire(); throw new Error('Voice sign-in failed. Connect Voice again.'); }
		await this.save(this.tokens(await response.json()), generation);
		return true;
	}
	private async save(tokens: Tokens, generation: number): Promise<void> {
		if (!await this.encryption.isEncryptionAvailable() || await this.encryption.getKeyStorageProvider() === KnownStorageProvider.basicText) { throw new Error('The secure credential store is unavailable.'); }
		const encrypted = await this.encryption.encrypt(JSON.stringify(tokens));
		if (generation !== this.generation) { throw new Error('Voice session changed. Try again.'); }
		this.state.setItem(sessionKey, encrypted); this.changed.fire();
	}
	async signOut(): Promise<void> { this.generation++; this.pending = undefined; this.state.removeItem(sessionKey); this.changed.fire(); }
	private account(tokens: Tokens): string {
		try {
			const claims = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1], 'base64url').toString('utf8'));
			if (typeof claims.sub !== 'string' || typeof claims.iss !== 'string') { throw new Error(); }
			return createHash('sha256').update(JSON.stringify([claims.iss, claims.sub, claims.org_id ?? null])).digest('hex');
		} catch { throw new Error('Voice returned an unrecognized account identity.'); }
	}
	async accountKey(): Promise<string> { const tokens = await this.load(); if (!tokens) { throw new Error('Connect Voice first.'); } return this.account(tokens); }
	async authorized(path: string, init: RequestInit = {}, expectedAccount?: string): Promise<Response> {
		if (!path.startsWith('/api/v1/') || path.includes('..')) { throw new Error('Unsupported Voice API path.'); }
		const generation = this.generation;
		let tokens = await this.load();
		if (!tokens || generation !== this.generation || (expectedAccount && this.account(tokens) !== expectedAccount)) { throw new Error('Connect Voice before processing a recording.'); }
		const send = (value: Tokens) => this.fetcher(VECTOR_VOICE_ORIGIN + path, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: 'Bearer ' + value.accessToken, 'x-vectorvoice-client': 'vectorcode' }, redirect: 'error', signal: AbortSignal.timeout(60000) });
		let response = await send(tokens);
		if (response.status === 401) {
			if (!this.refreshing) {
				const current = tokens;
				this.refreshing = (async () => {
					const refresh = await this.request('/api/native-auth/refresh', { platform: 'vectorcode', refreshToken: current.refreshToken });
					if (!refresh.ok) { if (refresh.status === 401 && generation === this.generation) { await this.signOut(); throw new Error('Voice session expired. Connect Voice again.'); } throw new Error('Voice could not refresh the connection. Try again.'); }
					const next = this.tokens(await refresh.json()); if (this.account(next) !== this.account(current)) { throw new Error('Voice returned a different account.'); } await this.save(next, generation); return next;
				})().finally(() => { this.refreshing = undefined; });
			}
			tokens = await this.refreshing;
			if (generation !== this.generation) { throw new Error('Voice session changed. Try again.'); }
			response = await send(tokens);
		}
		if (generation !== this.generation) { throw new Error('Voice session changed. Try again.'); }
		return response;
	}
	private request(path: string, body?: object): Promise<Response> {
		return this.fetcher(VECTOR_VOICE_ORIGIN + path, { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
	}
}
