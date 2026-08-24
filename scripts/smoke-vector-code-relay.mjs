/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import WebSocket from 'ws';

const FIXTURE_PATH = new URL('../src/vs/workbench/contrib/vectorCode/common/vectorCodeMobileProtocolFixtures.json', import.meta.url);
const DEFAULT_TIMEOUT_MS = 10_000;

class RelaySocketInbox {
	constructor(socket) {
		this.socket = socket;
		this.messages = [];
		this.waiters = [];
		this.received = data => {
			try {
				this.receive(JSON.parse(data.toString()));
			} catch (error) {
				this.rejectAll(error);
			}
		};
		this.failed = error => this.rejectAll(error);
		this.closed = () => this.rejectAll(new Error('Relay socket closed'));
		socket.on('message', this.received);
		socket.once('error', this.failed);
		socket.once('close', this.closed);
	}

	waitFor(predicate, description, signal) {
		const existingIndex = this.messages.findIndex(predicate);
		if (existingIndex >= 0) {
			const [message] = this.messages.splice(existingIndex, 1);
			return Promise.resolve(message);
		}

		return new Promise((resolve, reject) => {
			const cleanupAbortListener = () => signal.removeEventListener('abort', waiter.abort);
			const settle = (callback, value) => {
				cleanupAbortListener();
				callback(value);
			};
			const waiter = {
				predicate,
				resolve: message => settle(resolve, message),
				reject: error => settle(reject, error),
				abort: () => {
					this.waiters = this.waiters.filter(candidate => candidate !== waiter);
					settle(reject, signal.reason ?? new Error(`Timed out waiting for ${description}`));
				}
			};
			if (signal.aborted) {
				waiter.abort();
				return;
			}
			signal.addEventListener('abort', waiter.abort, { once: true });
			this.waiters.push(waiter);
		});
	}

	receive(message) {
		const waiter = this.waiters.find(candidate => candidate.predicate(message));
		if (!waiter) {
			this.messages.push(message);
			return;
		}
		this.waiters = this.waiters.filter(candidate => candidate !== waiter);
		waiter.resolve(message);
	}

	rejectAll(error) {
		for (const waiter of this.waiters) {
			waiter.reject(error);
		}
		this.waiters = [];
	}

	dispose() {
		this.socket.off('message', this.received);
		this.socket.off('error', this.failed);
		this.socket.off('close', this.closed);
		this.rejectAll(new Error('Relay socket inbox disposed'));
	}
}

const args = parseArgs(process.argv.slice(2));
const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
const relayHost = normalizeRelayHost(args.relayHost ?? process.env.VECTOR_CODE_RELAY_HOST ?? fixture.hosts.canonicalRelayHost, fixture);
const issuerToken = args.issuerToken ?? process.env.VECTOR_CODE_RELAY_ISSUER_TOKEN;
const userId = args.userId ?? process.env.VECTOR_CODE_RELAY_USER_ID ?? fixture.hosts.defaultUserId;
const ttlSeconds = Number.parseInt(args.ttlSeconds ?? process.env.VECTOR_CODE_RELAY_SMOKE_TTL_SECONDS ?? '300', 10);
const timeoutMs = Number.parseInt(args.timeoutMs ?? process.env.VECTOR_CODE_RELAY_SMOKE_TIMEOUT_MS ?? `${DEFAULT_TIMEOUT_MS}`, 10);
const desktopId = args.desktopId ?? `desktop-smoke-${randomUUID()}`;
const phoneId = args.phoneId ?? `phone-smoke-${randomUUID()}`;
const pairingId = args.pairingId ?? `pairing-smoke-${randomUUID()}`;
const pairingToken = encodeBase64Url(randomBytes(fixture.frameCrypto.keyBytes));

if (!relayHost) {
	fail('Invalid relay host. Set VECTOR_CODE_RELAY_HOST or pass --relay-host.');
}

if (args.selfTest) {
	await runSelfTest(fixture);
	console.log(JSON.stringify({ ok: true, selfTest: true, protocolVersion: fixture.protocolVersion }, null, 2));
	process.exit(0);
}

if (args.dryRun) {
	console.log(JSON.stringify({
		ok: true,
		dryRun: true,
		relayHost,
		tokenUrl: relayHttpUrl(relayHost, '/relay/token'),
		desktopWebSocketUrl: relayWebSocketUrl(relayHost, { role: 'desktop', userId, desktopId, deviceId: desktopId, pairingId }),
		phoneWebSocketUrl: relayWebSocketUrl(relayHost, { role: 'phone', userId, desktopId, deviceId: phoneId, pairingId }),
		protocolVersion: fixture.protocolVersion
	}, null, 2));
	process.exit(0);
}

if (args.pairedDesktop) {
	try {
		const payload = JSON.parse(await readStandardInput());
		const result = await runPairedDesktopSmoke({
			fixture,
			payload,
			timeoutMs,
			holdMs: Number.parseInt(args.holdMs ?? '0', 10)
		});
		console.log(JSON.stringify(result, null, 2));
		process.exit(0);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}
}

if (!issuerToken) {
	fail('Missing VECTOR_CODE_RELAY_ISSUER_TOKEN. Use --dry-run to validate URLs without contacting the relay.');
}

const abortController = new AbortController();
const timeout = setTimeout(() => abortController.abort(new Error(`Relay smoke timed out after ${timeoutMs}ms`)), timeoutMs);
let desktopSocket;
let phoneSocket;
let desktopInbox;
let phoneInbox;

try {
	const [desktopToken, phoneToken] = await Promise.all([
		createRelayToken({ relayHost, issuerToken, role: 'desktop', userId, desktopId, ttlSeconds, signal: abortController.signal }),
		createRelayToken({ relayHost, issuerToken, role: 'phone', userId, desktopId, pairingId, ttlSeconds, signal: abortController.signal })
	]);

	const desktopRelay = await openRelaySocket({
		url: relayWebSocketUrl(relayHost, { role: 'desktop', userId, desktopId, deviceId: desktopId, pairingId }),
		token: desktopToken.relayToken,
		signal: abortController.signal
	});
	const phoneRelay = await openRelaySocket({
		url: relayWebSocketUrl(relayHost, { role: 'phone', userId, desktopId, deviceId: phoneId, pairingId }),
		token: phoneToken.relayToken,
		signal: abortController.signal
	});
	desktopSocket = desktopRelay.socket;
	phoneSocket = phoneRelay.socket;
	desktopInbox = desktopRelay.inbox;
	phoneInbox = phoneRelay.inbox;

	await Promise.all([
		desktopInbox.waitFor(message => message.type === 'relay.ready', 'desktop ready', abortController.signal),
		phoneInbox.waitFor(message => message.type === 'relay.ready', 'phone ready', abortController.signal)
	]);
	await desktopInbox.waitFor(message => message.type === 'relay.peer_online' && message.role === 'phone', 'phone online event', abortController.signal);

	const requestId = `relay-smoke-${randomUUID()}`;
	const requestEnvelope = {
		kind: 'request',
		protocolVersion: fixture.protocolVersion,
		requestId,
		action: 'state.read',
		payload: {}
	};
	const phoneFrame = encryptRelayFrame({
		fixture,
		pairingToken,
		header: relayFrameHeader({ fixture, desktopId, phoneId, pairingId, direction: 'phone_to_desktop', seq: 1, action: requestEnvelope.action }),
		payload: requestEnvelope
	});
	phoneSocket.send(JSON.stringify({ type: 'relay.frame', frame: phoneFrame }));

	const desktopRelayFrame = await desktopInbox.waitFor(message => message.type === 'relay.frame', 'desktop receives phone frame', abortController.signal);
	const desktopEnvelope = decryptRelayFrame({ fixture, pairingToken, frame: desktopRelayFrame.frame });
	assert.equal(desktopEnvelope.requestId, requestId);
	assert.equal(desktopEnvelope.action, 'state.read');

	const responseEnvelope = {
		kind: 'response',
		protocolVersion: fixture.protocolVersion,
		requestId,
		action: 'state.read',
		payload: fixture.workspaceSnapshot
	};
	const desktopFrame = encryptRelayFrame({
		fixture,
		pairingToken,
		header: relayFrameHeader({ fixture, desktopId, phoneId, pairingId, direction: 'desktop_to_phone', seq: 1, action: responseEnvelope.action }),
		payload: responseEnvelope
	});
	desktopSocket.send(JSON.stringify({ type: 'relay.frame', frame: desktopFrame }));

	const phoneRelayFrame = await phoneInbox.waitFor(message => message.type === 'relay.frame', 'phone receives desktop frame', abortController.signal);
	const phoneEnvelope = decryptRelayFrame({ fixture, pairingToken, frame: phoneRelayFrame.frame });
	assert.equal(phoneEnvelope.kind, 'response');
	assert.equal(phoneEnvelope.requestId, requestId);
	assert.equal(phoneEnvelope.payload.projects[0].id, fixture.workspaceSnapshot.projects[0].id);

	console.log(JSON.stringify({
		ok: true,
		relayHost,
		desktopId,
		phoneId,
		pairingId,
		phoneRelayTokenExpiresAt: phoneToken.relayTokenExpiresAt,
		desktopRelayTokenExpiresAt: desktopToken.relayTokenExpiresAt
	}, null, 2));
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
} finally {
	clearTimeout(timeout);
	desktopInbox?.dispose();
	phoneInbox?.dispose();
	desktopSocket?.close();
	phoneSocket?.close();
}

function parseArgs(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		if (value === '--dry-run') {
			parsed.dryRun = true;
			continue;
		}
		if (value === '--self-test') {
			parsed.selfTest = true;
			continue;
		}
		if (value === '--paired-desktop') {
			parsed.pairedDesktop = true;
			continue;
		}
		if (!value.startsWith('--')) {
			fail(`Unexpected argument: ${value}`);
		}
		const key = value.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
		const nextValue = values[index + 1];
		if (!nextValue || nextValue.startsWith('--')) {
			fail(`Missing value for ${value}`);
		}
		parsed[key] = nextValue;
		index++;
	}
	return parsed;
}

async function readStandardInput() {
	let input = '';
	for await (const chunk of process.stdin) {
		input += chunk;
	}
	return input;
}

async function runPairedDesktopSmoke({ fixture, payload, timeoutMs, holdMs }) {
	assert.equal(payload?.protocolVersion, fixture.protocolVersion, 'Pairing payload protocol version is invalid');
	for (const field of ['desktopId', 'pairingId', 'pairingToken', 'relayHost', 'relayToken', 'relayTokenExpiresAt']) {
		assert.equal(typeof payload[field], 'string', `Pairing payload ${field} is missing`);
		assert.ok(payload[field].length > 0, `Pairing payload ${field} is empty`);
	}
	assert.ok(Date.parse(payload.relayTokenExpiresAt) > Date.now(), 'Pairing relay token is expired');
	const pairedRelayHost = normalizeRelayHost(payload.relayHost, fixture);
	assert.ok(pairedRelayHost, 'Pairing relay host is invalid');
	assert.ok(Number.isSafeInteger(holdMs) && holdMs >= 0, 'Hold duration must be a non-negative integer');

	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(new Error(`Paired desktop smoke timed out after ${timeoutMs}ms`)), timeoutMs);
	const phoneId = `phone-paired-smoke-${randomUUID()}`;
	let phoneSocket;
	let phoneInbox;
	try {
		const phoneRelay = await openRelaySocket({
			url: relayWebSocketUrl(pairedRelayHost, {
				role: 'phone',
				userId: payload.userId ?? fixture.hosts.defaultUserId,
				desktopId: payload.desktopId,
				deviceId: phoneId,
				pairingId: payload.pairingId
			}),
			token: payload.relayToken,
			signal: abortController.signal
		});
		phoneSocket = phoneRelay.socket;
		phoneInbox = phoneRelay.inbox;
		await phoneInbox.waitFor(message => message.type === 'relay.ready', 'paired phone ready', abortController.signal);

		const requestId = `paired-desktop-smoke-${randomUUID()}`;
		const requestEnvelope = {
			kind: 'request',
			protocolVersion: fixture.protocolVersion,
			requestId,
			action: 'state.read',
			payload: {}
		};
		const phoneFrame = encryptRelayFrame({
			fixture,
			pairingToken: payload.pairingToken,
			header: relayFrameHeader({
				fixture,
				desktopId: payload.desktopId,
				phoneId,
				pairingId: payload.pairingId,
				direction: 'phone_to_desktop',
				seq: 1,
				action: requestEnvelope.action
			}),
			payload: requestEnvelope
		});
		phoneSocket.send(JSON.stringify({ type: 'relay.frame', frame: phoneFrame }));

		const responseMessage = await phoneInbox.waitFor(
			message => message.type === 'relay.frame' && message.frame?.header?.direction === 'desktop_to_phone',
			'paired desktop response',
			abortController.signal
		);
		assert.equal(responseMessage.frame.header.protocolVersion, fixture.protocolVersion);
		assert.equal(responseMessage.frame.header.desktopId, payload.desktopId);
		assert.equal(responseMessage.frame.header.phoneId, phoneId);
		assert.equal(responseMessage.frame.header.sessionId, payload.pairingId);
		assert.equal(responseMessage.frame.header.action, requestEnvelope.action);
		const responseEnvelope = decryptRelayFrame({ fixture, pairingToken: payload.pairingToken, frame: responseMessage.frame });
		assert.equal(responseEnvelope.kind, 'response');
		assert.equal(responseEnvelope.protocolVersion, fixture.protocolVersion);
		assert.equal(responseEnvelope.requestId, requestId);
		assert.equal(responseEnvelope.action, requestEnvelope.action);
		assert.ok(Array.isArray(responseEnvelope.payload?.projects), 'Desktop response did not include workspace projects');

		phoneSocket.send(JSON.stringify({ type: 'relay.frame', frame: phoneFrame }));
		const replayController = new AbortController();
		const replayTimeout = setTimeout(() => replayController.abort(new Error('Replay correctly ignored')), 1_500);
		try {
			await assert.rejects(
				phoneInbox.waitFor(
					message => message.type === 'relay.frame' && message.frame?.header?.direction === 'desktop_to_phone',
					'replayed desktop response',
					replayController.signal
				),
				/Replay correctly ignored/
			);
		} finally {
			clearTimeout(replayTimeout);
		}

		if (holdMs > 0) {
			await new Promise((resolve, reject) => {
				const holdTimeout = setTimeout(resolve, holdMs);
				abortController.signal.addEventListener('abort', () => {
					clearTimeout(holdTimeout);
					reject(abortController.signal.reason);
				}, { once: true });
			});
		}

		return {
			ok: true,
			pairedDesktop: true,
			relayHost: pairedRelayHost,
			desktopId: payload.desktopId,
			phoneId,
			pairingId: payload.pairingId,
			protocolVersion: fixture.protocolVersion,
			replayRejected: true
		};
	} finally {
		clearTimeout(timeout);
		phoneInbox?.dispose();
		phoneSocket?.close();
	}
}

async function createRelayToken({ relayHost, issuerToken, role, userId, desktopId, pairingId, ttlSeconds, signal }) {
	const response = await fetch(relayHttpUrl(relayHost, '/relay/token'), {
		method: 'POST',
		headers: {
			authorization: `Bearer ${issuerToken}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			role,
			userId,
			desktopId,
			...(role === 'phone' ? { pairingId } : {}),
			ttlSeconds
		}),
		signal
	});

	if (!response.ok) {
		throw new Error(`Relay token request for ${role} failed: ${response.status} ${response.statusText}`);
	}

	return normalizeRelayTokenResponse(await response.json());
}

function normalizeRelayTokenResponse(body) {
	const relayToken = stringField(body, 'relayToken') ?? stringField(body, 'token');
	const relayTokenExpiresAt = stringField(body, 'relayTokenExpiresAt') ?? stringField(body, 'expiresAt');
	assert.equal(typeof relayToken, 'string');
	assert.equal(typeof relayTokenExpiresAt, 'string');
	return {
		relayToken,
		relayTokenExpiresAt
	};
}

function stringField(value, key) {
	const field = value?.[key];
	if (typeof field !== 'string') {
		return undefined;
	}
	return field.trim() || undefined;
}

function openRelaySocket({ url, token, signal }) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, {
			headers: {
				authorization: `Bearer ${token}`
			}
		});
		const inbox = new RelaySocketInbox(socket);
		const abort = () => {
			inbox.dispose();
			socket.close();
			reject(signal.reason ?? new Error('Relay socket open aborted'));
		};
		const cleanup = () => {
			signal.removeEventListener('abort', abort);
			socket.off('open', opened);
			socket.off('error', failed);
		};
		const opened = () => {
			cleanup();
			resolve({ socket, inbox });
		};
		const failed = error => {
			inbox.dispose();
			cleanup();
			reject(error);
		};
		signal.addEventListener('abort', abort, { once: true });
		socket.once('open', opened);
		socket.once('error', failed);
	});
}

function relayFrameHeader({ fixture, desktopId, phoneId, pairingId, direction, seq, action }) {
	return {
		protocolVersion: fixture.protocolVersion,
		frameId: `frame-${randomUUID()}`,
		desktopId,
		phoneId,
		sessionId: pairingId,
		streamId: 'state',
		channel: 'control',
		direction,
		seq,
		issuedAt: new Date().toISOString(),
		action
	};
}

async function runSelfTest(fixture) {
	for (const testCase of fixture.frameCrypto.base64UrlCases) {
		assert.equal(encodeBase64Url(Buffer.from(testCase.bytes)), testCase.encoded);
		assert.deepEqual([...decodeBase64Url(testCase.encoded)], testCase.bytes);
	}
	const authenticationCase = fixture.frameCrypto.authenticationCase;
	assert.deepEqual(decryptRelayFrame({
		fixture,
		pairingToken: authenticationCase.pairingToken,
		frame: {
			header: authenticationCase.header,
			nonce: authenticationCase.nonce,
			ciphertext: authenticationCase.ciphertext,
			tag: authenticationCase.tag
		}
	}), authenticationCase.payload);

	assert.deepEqual(
		normalizeRelayTokenResponse({ token: 'relay-token', expiresAt: '2026-05-27T17:13:04.000Z' }),
		{ relayToken: 'relay-token', relayTokenExpiresAt: '2026-05-27T17:13:04.000Z' }
	);
	assert.deepEqual(
		normalizeRelayTokenResponse({ relayToken: ' relay-token ', relayTokenExpiresAt: ' 2026-05-27T17:13:04.000Z ' }),
		{ relayToken: 'relay-token', relayTokenExpiresAt: '2026-05-27T17:13:04.000Z' }
	);

	const token = encodeBase64Url(randomBytes(fixture.frameCrypto.keyBytes));
	const envelope = {
		kind: 'request',
		protocolVersion: fixture.protocolVersion,
		requestId: 'self-test',
		action: 'state.read',
		payload: {}
	};
	const frame = encryptRelayFrame({
		fixture,
		pairingToken: token,
		header: relayFrameHeader({
			fixture,
			desktopId: 'desktop-self-test',
			phoneId: 'phone-self-test',
			pairingId: 'pairing-self-test',
			direction: 'phone_to_desktop',
			seq: 1,
			action: envelope.action
		}),
		payload: envelope
	});
	const decoded = decryptRelayFrame({ fixture, pairingToken: token, frame });
	assert.deepEqual(decoded, envelope);
	assert.throws(() => decryptRelayFrame({
		fixture,
		pairingToken: token,
		frame: {
			...frame,
			header: { ...frame.header, issuedAt: new Date(Date.now() + 1_000).toISOString() }
		}
	}), /authenticate|Unsupported state/i);

	const inbox = new RelaySocketInbox(new EventEmitter());
	const matchedController = new AbortController();
	const matched = inbox.waitFor(message => message.type === 'matched', 'matched self-test message', matchedController.signal);
	inbox.receive({ type: 'matched' });
	assert.deepEqual(await matched, { type: 'matched' });
	matchedController.abort(new Error('resolved wait should already be settled'));
	assert.equal(inbox.waiters.length, 0);

	const abortedController = new AbortController();
	const aborted = inbox.waitFor(message => message.type === 'never', 'aborted self-test message', abortedController.signal);
	abortedController.abort(new Error('self-test abort'));
	await assert.rejects(aborted, /self-test abort/);
	assert.equal(inbox.waiters.length, 0);
	inbox.dispose();
}

function encryptRelayFrame({ fixture, pairingToken, header, payload }) {
	const nonce = randomBytes(fixture.frameCrypto.nonceBytes);
	const cipher = cryptoCipher('encrypt', pairingToken, nonce);
	cipher.setAAD(authenticatedHeaderBytes(header));
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		header,
		nonce: encodeBase64Url(nonce),
		ciphertext: encodeBase64Url(ciphertext),
		tag: encodeBase64Url(tag)
	};
}

function decryptRelayFrame({ fixture, pairingToken, frame }) {
	const decipher = cryptoCipher('decrypt', pairingToken, decodeBase64Url(frame.nonce));
	decipher.setAAD(authenticatedHeaderBytes(frame.header));
	decipher.setAuthTag(decodeBase64Url(frame.tag));
	const plaintext = Buffer.concat([
		decipher.update(decodeBase64Url(frame.ciphertext)),
		decipher.final()
	]);
	assert.equal(decodeBase64Url(frame.tag).byteLength, fixture.frameCrypto.tagBytes);
	return JSON.parse(plaintext.toString('utf8'));
}

function authenticatedHeaderBytes(header) {
	const fields = [
		String(header.protocolVersion),
		header.frameId,
		header.desktopId,
		header.phoneId,
		header.sessionId,
		header.streamId,
		header.channel,
		header.direction,
		String(header.seq),
		header.issuedAt,
		header.action
	];
	return Buffer.concat(fields.map(field => {
		assert.equal(typeof field, 'string', 'Authenticated relay header fields must be strings');
		const bytes = Buffer.from(field, 'utf8');
		return Buffer.concat([Buffer.from(`${bytes.byteLength}:`, 'utf8'), bytes]);
	}));
}

function cryptoCipher(mode, pairingToken, nonce) {
	const key = decodeBase64Url(pairingToken);
	if (mode === 'encrypt') {
		return createCipheriv('aes-256-gcm', key, nonce);
	}
	return createDecipheriv('aes-256-gcm', key, nonce);
}

function normalizeRelayHost(value, fixture) {
	const rawValue = value?.trim();
	if (!rawValue) {
		return undefined;
	}
	try {
		const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue) ? rawValue : `wss://${rawValue}`);
		const hostname = url.hostname.toLowerCase();
		const relayHost = url.port ? `${hostname}:${url.port}` : hostname;
		if (fixture.hosts.legacyRelayHosts.includes(hostname)) {
			return fixture.hosts.canonicalRelayHost;
		}
		return new RegExp(fixture.hosts.relayHostPattern).test(relayHost) ? relayHost : undefined;
	} catch {
		return undefined;
	}
}

function relayHttpUrl(relayHost, pathname) {
	const scheme = /^(localhost|127\.0\.0\.1)(?::|$)/.test(relayHost) ? 'http' : 'https';
	return `${scheme}://${relayHost}${pathname}`;
}

function relayWebSocketUrl(relayHost, query) {
	const scheme = /^(localhost|127\.0\.0\.1)(?::|$)/.test(relayHost) ? 'ws' : 'wss';
	const params = new URLSearchParams(query);
	return `${scheme}://${relayHost}/relay?${params.toString()}`;
}

function encodeBase64Url(bytes) {
	return Buffer.from(bytes).toString('base64url');
}

function decodeBase64Url(value) {
	return Buffer.from(value, 'base64url');
}

function fail(message) {
	console.error(`VectorCode relay smoke failed: ${message}`);
	process.exit(1);
}
