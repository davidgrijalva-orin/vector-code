/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual, deepStrictEqual, rejects, ok } from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { VectorCodeLibrary } from '../../../vectorCode/node/vectorCodeLibrary.js';
import { VectorCodeRecordings } from '../../../vectorCode/node/vectorCodeRecordings.js';
import { localDocumentTabs } from '../../../vectorCode/common/vectorCodeLibrary.js';
import { VectorVoiceAuth } from '../../node/vectorVoiceAuth.js';
import { VectorVoiceProcessing } from '../../node/vectorVoiceProcessing.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('Voice recording API and atomic document handoff', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let directory: string; let library: VectorCodeLibrary; let recordings: VectorCodeRecordings; let recordingId: string; let account: string;
	const transcriptionId = '11111111-1111-4111-8111-111111111111'; const meetingId = '22222222-2222-4222-8222-222222222222';
	let calls: { path: string; init?: RequestInit; expectedAccount?: string }[]; let failUpload: boolean;
	setup(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'voice-client-test-')); library = new VectorCodeLibrary(join(directory, 'library')); recordings = new VectorCodeRecordings(join(directory, 'audio'), library);
		const noteId = generateUuid(); recordingId = generateUuid(); account = 'a'.repeat(64); calls = []; failUpload = false;
		await library.mutate({ version: 1, kind: 'createNote', requestId: noteId, title: 'Recorded discussion', projectIds: [] });
		await recordings.begin({ version: 1, id: recordingId, noteId, mimeType: 'audio/webm' });
		await recordings.append(recordingId, 0, VSBuffer.fromString('synthetic audio')); await recordings.finish(recordingId, 1, 1000);
	});
	teardown(async () => { await fs.rm(directory, { recursive: true, force: true }); });
	function client() {
		const auth = {
			accountKey: async () => account, authorized: async (path: string, init?: RequestInit, expectedAccount?: string) => {
				calls.push({ path, init, expectedAccount });
				if (path === '/api/v1/transcriptions') {
					if (failUpload) { throw new Error('network interrupted'); }
					return Response.json({ transcription: { id: transcriptionId, meetingId, status: 'processing' } });
				}
				if (path.startsWith('/api/v1/transcriptions/')) { return Response.json({ transcription: { id: transcriptionId, meetingId, status: 'ready' } }); }
				return Response.json({ meeting: { id: meetingId, title: 'Discussion', summary: 'Generated summary', decisions: [{ text: 'Keep the document' }], actions: [{ text: 'Review the notes' }] } });
			}
		} as unknown as VectorVoiceAuth;
		return new VectorVoiceProcessing(join(directory, 'jobs'), auth, recordings, library);
	}
	test('uncertain upload reuses its durable request and payload after restart', async () => {
		failUpload = true; await rejects(client().processRecording(recordingId), /network interrupted/);
		const key = new Headers(calls[0].init?.headers).get('idempotency-key'); ok(key);
		failUpload = false; const result = await client().processRecording(recordingId);
		strictEqual(result.status, 'processing'); strictEqual(new Headers(calls[1].init?.headers).get('idempotency-key'), key);
		for (const call of calls) { strictEqual(call.expectedAccount, account); strictEqual((call.init?.body as FormData).get('title'), 'Recorded discussion'); strictEqual(((call.init?.body as FormData).get('file') as Blob).size, 15); }
	});
	test('account changes cannot upload or file a previous account result', async () => {
		await client().processRecording(recordingId); account = 'b'.repeat(64);
		await rejects(client().processRecording(recordingId), /account that started/);
		await rejects(client().refreshRecording(recordingId), /account that started/);
		strictEqual(calls.length, 1);
	});
	test('files generated notes into a new document, new tab, and next page without replacing audio', async () => {
		const service = client(); await service.processRecording(recordingId); strictEqual((await service.refreshRecording(recordingId)).resultReady, true);
		const request = { version: 1 as const, requestId: generateUuid(), recordingId, expectedPlacementRevision: 0, destination: { kind: 'createNote' as const, title: 'Voice notes', projectIds: [] } };
		const placed = await service.fileResult(request); deepStrictEqual(await service.fileResult(request), placed);
		let state = await library.read(); strictEqual(state.notes.length, 2); let note = state.notes.find(note => note.id === placed.noteId)!;
		ok(note.body.includes('Generated summary')); ok(note.body.includes('not the complete transcript')); ok(note.body.includes(recordingId));
		const tab = await service.fileResult({ ...request, requestId: generateUuid(), expectedPlacementRevision: 1, destination: { kind: 'createTab', id: note.id, expectedRevision: note.revision, title: 'Another discussion' } });
		state = await library.read(); note = state.notes.find(note => note.id === placed.noteId)!; const content = localDocumentTabs(note).find(item => item.id === tab.tabId)!;
		ok(content.body.includes('Generated summary'));
		await service.fileResult({ ...request, requestId: generateUuid(), expectedPlacementRevision: 2, destination: { kind: 'appendPage', id: note.id, tabId: tab.tabId, expectedRevision: content.contentRevision } });
		const finalNote = (await library.read()).notes.find(item => item.id === note.id)!;
		ok(localDocumentTabs(finalNote).find(item => item.id === tab.tabId)!.body.includes('<!-- vector-page:'));
		strictEqual((await recordings.read(recordingId)).data.toString(), 'synthetic audio');
	});
});
