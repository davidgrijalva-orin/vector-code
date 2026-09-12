/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hostname } from 'os';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IEncryptionMainService, KnownStorageProvider } from '../../encryption/common/encryptionService.js';
import { IStateService } from '../../state/node/state.js';
import { IVectorGraphSession, IVectorGraphWorkspace, vectorGraphArray, vectorGraphRecord, vectorGraphText, VectorGraphConnectionError, isVectorGraphConnectionError } from '../common/vectorGraph.js';

const origin = 'https://vectorgraph.app';
const sessionKey = 'vectorGraph.session.v1';
interface Profile { readonly workspace: IVectorGraphWorkspace; readonly token: string }
interface Pending {
	readonly deviceCode: string;
	readonly authorization: NonNullable<IVectorGraphSession['authorization']>;
	readonly interval: number;
	nextPoll: number;
}

/** Device authorization and encrypted credentials never leave the main process. */
export class VectorGraphAuth extends Disposable {
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChangeSession = this.changed.event;
	private profiles: readonly Profile[] | undefined;
	private pending: Pending | undefined;
	private generation = 0;
	private polling: Promise<IVectorGraphSession> | undefined;
	constructor(private readonly encryption: IEncryptionMainService, private readonly state: IStateService, private readonly fetcher: (input: string, init: RequestInit) => Promise<Response>) { super(); }

	private async load(): Promise<readonly Profile[]> {
		if (!this.profiles) {
			const generation = this.generation;
			const encrypted = this.state.getItem<string>(sessionKey);
			let profiles: readonly Profile[] = [];
			try { profiles = encrypted ? this.parseProfiles(JSON.parse(await this.encryption.decrypt(encrypted))) : []; }
			catch { throw new Error('Cannot unlock the saved VectorGraph account. Sign out and sign in again.'); }
			if (generation === this.generation) { this.profiles = profiles; }
			return this.profiles ?? profiles;
		}
		return this.profiles ?? [];
	}
	async getSession(): Promise<IVectorGraphSession> {
		return { workspaces: (await this.load()).map(profile => profile.workspace), authorization: this.pending?.authorization };
	}
	async beginSignIn(): Promise<IVectorGraphSession> {
		if (!await this.encryption.isEncryptionAvailable() || await this.encryption.getKeyStorageProvider() === KnownStorageProvider.basicText) {
			throw new Error('Unlock your system credential store, then sign in to VectorGraph again.');
		}
		const generation = ++this.generation;
		this.pending = undefined;
		const result = vectorGraphRecord((await this.request('/cli/v1/auth/device', { clientName: 'Vector Code', deviceName: hostname() })).body);
		const url = new URL(vectorGraphText(result.verificationUriComplete));
		const expiresAt = Date.parse(vectorGraphText(result.expiresAt));
		if (url.origin !== origin || url.username || url.password || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || result.apiUrl !== origin) { throw new Error('VectorGraph returned invalid authorization details.'); }
		if (generation === this.generation) {
			this.pending = { deviceCode: vectorGraphText(result.deviceCode), authorization: { url: url.toString(), code: vectorGraphText(result.userCode), expiresAt }, interval: Math.max(1000, Math.min(30000, typeof result.intervalSeconds === 'number' && Number.isFinite(result.intervalSeconds) ? result.intervalSeconds * 1000 : 5000)), nextPoll: 0 };
			this.changed.fire();
		}
		return this.getSession();
	}
	pollSignIn(): Promise<IVectorGraphSession> {
		if (!this.polling) {
			const generation = this.generation;
			this.polling = this.poll().catch(error => {
				if (generation === this.generation && this.pending && !isVectorGraphConnectionError(error)) {
					this.pending = undefined;
					this.changed.fire();
				}
				throw error;
			}).finally(() => { this.polling = undefined; });
		}
		return this.polling;
	}
	private async poll(): Promise<IVectorGraphSession> {
		const pending = this.pending;
		const generation = this.generation;
		if (!pending) { return this.getSession(); }
		if (Date.now() >= pending.authorization.expiresAt) {
			this.pending = undefined;
			this.changed.fire();
			throw new Error('VectorGraph sign-in expired. Sign in again.');
		}
		if (Date.now() < pending.nextPoll) { return this.getSession(); }
		pending.nextPoll = Date.now() + pending.interval;
		const response = await this.request('/cli/v1/auth/device/token', { deviceCode: pending.deviceCode });
		if (generation !== this.generation) { return this.getSession(); }
		if (response.status === 202) { return this.getSession(); }
		const result = vectorGraphRecord(response.body);
		if (result.apiUrl !== origin) { throw new Error('VectorGraph returned an unexpected API address.'); }
		const profiles = this.parseProfiles(result.profiles);
		if (!profiles.length || !profiles.some(profile => profile.workspace.id === result.activeWorkspaceId)) { throw new Error('VectorGraph did not authorize a workspace.'); }
		const encrypted = await this.encryption.encrypt(JSON.stringify(profiles));
		if (generation === this.generation) {
			this.state.setItem(sessionKey, encrypted);
			this.profiles = profiles;
			this.pending = undefined;
			this.changed.fire();
		}
		return this.getSession();
	}
	async cancelSignIn(): Promise<void> {
		this.generation++;
		this.pending = undefined;
		this.changed.fire();
	}
	async signOut(): Promise<void> {
		this.generation++;
		this.pending = undefined;
		this.profiles = [];
		this.state.removeItem(sessionKey);
		this.changed.fire();
	}
	async call(workspace: string, operation: string, query: object = {}, pathParameters: object = {}, body?: object, idempotencyKey?: string): Promise<unknown> {
		const generation = this.generation;
		const profile = (await this.load()).find(profile => profile.workspace.id === workspace);
		if (!profile) { throw new Error('Sign in to VectorGraph and authorize this workspace to continue.'); }
		const result = await this.request(`/cli/v1/workspaces/${encodeURIComponent(workspace)}/operations/${operation}`, { query, pathParameters, body, idempotencyKey }, profile.token);
		if (generation !== this.generation) { throw new Error('VectorGraph account changed. Refresh to continue.'); }
		return result.body;
	}
	private parseProfiles(value: unknown): readonly Profile[] {
		return vectorGraphArray(value).map(value => {
			const row = vectorGraphRecord(value);
			const workspace = vectorGraphRecord(row.workspace);
			const id = vectorGraphText(workspace.id);
			const token = vectorGraphText(row.token);
			if (!/^[a-f0-9-]{36}$/i.test(id) || !token) { throw new Error('VectorGraph returned an invalid workspace credential.'); }
			return { token, workspace: { id, name: typeof workspace.name === 'string' ? workspace.name : id } };
		});
	}
	private async request(path: string, body: object, token?: string): Promise<{ status: number; body: unknown }> {
		let response: Response;
		try {
			response = await this.fetcher(origin + path, {
				method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify(body), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000)
			});
		} catch {
			throw new VectorGraphConnectionError('Cannot connect to VectorGraph. Check your connection and retry.');
		}
		if (response.status === 429 || response.status >= 500) {
			throw new VectorGraphConnectionError('VectorGraph is temporarily unavailable. Retry shortly.');
		}
		if (response.status === 409) {
			throw new Error('VectorGraph rejected a conflicting change. Your edits are preserved. Compare or reload the latest version before saving.');
		}
		if (!response.ok) {
			throw new Error(response.status === 401 || response.status === 403 ? 'VectorGraph access expired or is not authorized. Sign in again and authorize the workspace.' : `VectorGraph could not complete the request (${response.status}).`);
		}
		try { return { status: response.status, body: await response.json() }; }
		catch { throw new Error('VectorGraph returned an invalid response. Sign in again.'); }
	}
}
