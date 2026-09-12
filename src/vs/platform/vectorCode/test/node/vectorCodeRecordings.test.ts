/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { FileRecordingRequest, VectorCodeLibraryChannel, IVectorCodeLibraryService, LibraryMutation } from '../../common/vectorCodeLibrary.js';
import { VectorCodeLibrary } from '../../node/vectorCodeLibrary.js';
import { VectorCodeRecordings } from '../../node/vectorCodeRecordings.js';
import { RecordingStart, VectorCodeRecordingsChannel } from '../../common/vectorCodeRecordings.js';

suite('VectorCode durable local recordings', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let directory: string; let library: VectorCodeLibrary; let service: VectorCodeRecordings; let request: RecordingStart;
	setup(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'vectorcode-recordings-'));
		library = new VectorCodeLibrary(join(directory, 'library'));
		const note = await library.mutate({ version: 1, requestId: generateUuid(), kind: 'createNote', title: 'Recording', projectIds: [] });
		service = new VectorCodeRecordings(join(directory, 'audio'), library);
		request = { version: 1, id: generateUuid(), noteId: note.id, mimeType: 'audio/webm;codecs=opus' };
	});
	teardown(async () => { await fs.rm(directory, { recursive: true, force: true }); });
	test('filing during capture atomically creates a destination and preserves original audio and provenance', async () => {
		const started = await service.begin(request); await service.append(request.id, 0, VSBuffer.fromString('before'));
		const filing: FileRecordingRequest = { version: 1, requestId: generateUuid(), recordingId: request.id, expectedPlacementRevision: 0, destination: { kind: 'createNote', title: 'Filed recording', projectIds: [] } };
		const placed = await service.file(filing);
		await service.append(request.id, 1, VSBuffer.fromString('after')); await service.finish(request.id, 2, 2000);
		service = new VectorCodeRecordings(join(directory, 'audio'), new VectorCodeLibrary(join(directory, 'library')));
		deepStrictEqual(await service.file(filing), placed);
		strictEqual((await service.list(request.noteId)).length, 0);
		strictEqual((await service.list(placed.noteId)).length, 1);
		const result = await service.read(request.id);
		strictEqual(result.recording.noteId, request.noteId); strictEqual(result.recording.createdAt, started.createdAt);
		strictEqual(result.data.toString(), 'beforeafter'); deepStrictEqual(result.recording.placement, placed);
		strictEqual((await new VectorCodeLibrary(join(directory, 'library')).read()).notes.length, 2);
	});
	test('a lost reply after filing commits reconciles to the original receipt after restart', async () => {
		await service.begin(request);
		const filing: FileRecordingRequest = { version: 1, requestId: generateUuid(), recordingId: request.id, expectedPlacementRevision: 0, destination: { kind: 'createNote', title: 'Only once', projectIds: [] } };
		const uncertain = new VectorCodeRecordings(join(directory, 'audio'), { read: () => library.read(), mutate: async (request: LibraryMutation) => { await library.mutate(request); throw new Error('Reply lost after commit'); } } as unknown as IVectorCodeLibraryService);
		await rejects(uncertain.file(filing), /Reply lost/);
		service = new VectorCodeRecordings(join(directory, 'audio'), new VectorCodeLibrary(join(directory, 'library')));
		const receipt = await service.file(filing);
		strictEqual(receipt.noteId, filing.requestId); strictEqual((await service.list(receipt.noteId)).length, 1);
		strictEqual((await new VectorCodeLibrary(join(directory, 'library')).read()).notes.length, 2);
		deepStrictEqual((await service.begin(request)).placement, receipt);
	});
	test('page/tab filing rejects stale placement and target revisions without creating duplicate destinations', async () => {
		await service.begin(request);
		const first: FileRecordingRequest = { version: 1, requestId: generateUuid(), recordingId: request.id, expectedPlacementRevision: 0, destination: { kind: 'createTab', id: request.noteId, expectedRevision: 1, title: 'Meetings' } };
		const placed = await service.file(first);
		const page: FileRecordingRequest = { version: 1, requestId: generateUuid(), recordingId: request.id, expectedPlacementRevision: 1, destination: { kind: 'appendPage', id: placed.noteId, tabId: placed.tabId, expectedRevision: 1 } };
		const second = await service.file(page);
		deepStrictEqual(await service.file(first), placed); deepStrictEqual(await service.file(page), second);
		await rejects(service.file({ ...first, requestId: generateUuid() }), /filed elsewhere/);
		await rejects(service.file({ ...page, requestId: generateUuid(), expectedPlacementRevision: 2 }), /changed in another window/);
		await rejects(service.file({ ...first, destination: { ...first.destination, kind: 'createNote', title: 'Different', projectIds: [] } }), /different change/);
		const saved = await library.read(); strictEqual(saved.notes.length, 1); strictEqual(saved.notes[0].additionalTabs?.length, 1);
		deepStrictEqual(saved.recordingPlacements, [second]);
	});
	test('failed compound commit preserves both destination and placement, and the same request can retry', async () => {
		await service.begin(request);
		const filing: FileRecordingRequest = { version: 1, requestId: generateUuid(), recordingId: request.id, expectedPlacementRevision: 0, destination: { kind: 'createNote', title: 'Destination', projectIds: [] } };
		const before = await library.read();
		await fs.mkdir(join(directory, 'library', 'library-v1.json.pending'));
		await rejects(service.file(filing)); deepStrictEqual(await library.read(), before);
		await fs.rmdir(join(directory, 'library', 'library-v1.json.pending'));
		const placed = await service.file(filing);
		strictEqual(placed.noteId, filing.requestId); strictEqual((await library.read()).notes.length, 2);
	});
	test('filing validates capture identity through the recordings API and cannot bypass it through library IPC', async () => {
		const filing: FileRecordingRequest = { version: 1, requestId: generateUuid(), recordingId: request.id, expectedPlacementRevision: 0, destination: { kind: 'createNote', title: 'Destination', projectIds: [] } };
		await rejects(service.file(filing));
		await rejects(new VectorCodeLibraryChannel(library).call(undefined, 'mutate', [{ ...filing, kind: 'fileRecording', sourceNoteId: request.noteId }]), /recording API/);
		strictEqual((await library.read()).notes.length, 1);
		await service.begin(request);
		const channel = new VectorCodeRecordingsChannel(service);
		const placed = await channel.call(undefined, 'file', [filing]); deepStrictEqual(placed, await service.file(filing));
	});
	test('recordings retain their tab and page destination across restart without duplicating capture', async () => {
		const tab = await library.mutate({ version: 1, requestId: generateUuid(), kind: 'createTab', id: request.noteId, expectedRevision: 1, title: 'Meetings' });
		const page = await library.mutate({ version: 1, requestId: generateUuid(), kind: 'appendPage', id: request.noteId, tabId: tab.tabId!, expectedRevision: 1, body: '' });
		request = { ...request, tabId: tab.tabId, pageId: page.pageId };
		const started = await service.begin(request);
		await service.append(request.id, 0, VSBuffer.fromString('audio'));
		service = new VectorCodeRecordings(join(directory, 'audio'), new VectorCodeLibrary(join(directory, 'library')));
		const restored = await service.read(request.id);
		strictEqual(restored.recording.tabId, tab.tabId); strictEqual(restored.recording.pageId, page.pageId); strictEqual(restored.data.toString(), 'audio');
		strictEqual((await service.begin(request)).createdAt, started.createdAt);
		await rejects(service.begin({ ...request, tabId: request.noteId }), /different capture/);
		await rejects(service.begin({ ...request, id: generateUuid(), pageId: generateUuid() }), /no longer exists/);
		await rejects(service.begin({ ...request, id: generateUuid(), tabId: generateUuid() }), /no longer exists/);
		strictEqual((await service.list(request.noteId)).length, 1);
	});
	test('saved and unfinished audio survive restart and filing the note into a project', async () => {
		await service.begin(request);
		await service.append(request.id, 0, VSBuffer.fromString('first'));
		await service.append(request.id, 1, VSBuffer.fromString('second'));
		service = new VectorCodeRecordings(join(directory, 'audio'), library);
		strictEqual((await service.read(request.id)).data.toString(), 'firstsecond');
		strictEqual((await service.list(request.noteId))[0].status, 'capturing');
		const project = await library.mutate({ version: 1, requestId: generateUuid(), kind: 'createProject', title: 'Research' });
		await library.mutate({ version: 1, requestId: generateUuid(), kind: 'assignNote', id: request.noteId, expectedRevision: 1, projectIds: [project.id] });
		await service.finish(request.id, 2, 2000);
		const result = await new VectorCodeRecordings(join(directory, 'audio'), library).read(request.id);
		strictEqual(result.recording.noteId, request.noteId); strictEqual(result.recording.status, 'stopped'); strictEqual(result.recording.durationMs, 2000);
		strictEqual(result.data.toString(), 'firstsecond'); strictEqual((await service.list(request.noteId)).length, 1);
	});
	test('begin, chunk and finish retries preserve identities and do not duplicate audio', async () => {
		const original = await service.begin(request); deepStrictEqual(await service.begin(request), original);
		await service.append(request.id, 0, VSBuffer.fromString('audio'));
		service = new VectorCodeRecordings(join(directory, 'audio'), library);
		strictEqual(await service.append(request.id, 0, VSBuffer.fromString('audio')), 1);
		await rejects(service.append(request.id, 0, VSBuffer.fromString('other')), /different data/);
		const finished = await service.finish(request.id, 1, 1000);
		deepStrictEqual(await service.finish(request.id, 1, 1000), finished);
		strictEqual((await service.read(request.id)).data.toString(), 'audio');
		await rejects(service.append(request.id, 1, VSBuffer.fromString('late')), /closed/);
	});
	test('out-of-order audio and premature finish cannot create a successful receipt', async () => {
		await service.begin(request);
		await rejects(service.append(request.id, 1, VSBuffer.fromString('gap')), /missing/);
		await rejects(service.finish(request.id, 1, 1000), /not been saved/);
		await rejects(service.finish(request.id, 0, 0), /No audio/);
		strictEqual((await service.list(request.noteId))[0].bytes, 0);
		await rejects(service.read(request.id), /No audio/);
	});
	test('corrupted saved chunks are detected and preserved', async () => {
		await service.begin(request); await service.append(request.id, 0, VSBuffer.fromString('original'));
		const path = join(directory, 'audio', request.id, '0.webm');
		await fs.writeFile(path, 'changed');
		await rejects(service.read(request.id), /damaged/);
		strictEqual(await fs.readFile(path, 'utf8'), 'changed');
	});
	test('failed chunk manifest commit can be retried without duplicate bytes', async () => {
		await service.begin(request);
		const blocked = join(directory, 'audio', request.id, 'recording.json.pending'); await fs.mkdir(blocked);
		await rejects(service.append(request.id, 0, VSBuffer.fromString('audio')));
		strictEqual((await service.list(request.noteId))[0].bytes, 0);
		await fs.rmdir(blocked);
		await service.append(request.id, 0, VSBuffer.fromString('audio'));
		strictEqual((await service.read(request.id)).data.toString(), 'audio');
	});
	test('queued audio owns its bytes independently of the caller buffer', async () => {
		await service.begin(request);
		const buffer = VSBuffer.fromString('original');
		const pending = service.append(request.id, 0, buffer); buffer.buffer.fill(0);
		await pending; strictEqual((await service.read(request.id)).data.toString(), 'original');
	});

	test('versioned IPC rejects arbitrary paths, methods, formats and oversized chunks', async () => {
		const channel = new VectorCodeRecordingsChannel(service);
		await rejects(channel.call(undefined, 'read', ['../../private']));
		await rejects(channel.call(undefined, 'delete', [request.id]));
		await rejects(channel.call(undefined, 'begin', [{ ...request, mimeType: 'text/html' }]));
		await rejects(channel.call(undefined, 'begin', [{ ...request, noteId: generateUuid() }]));
		await rejects(channel.call(undefined, 'append', [request.id, 0, 'not a buffer']));
		await rejects(async () => service.append(request.id, 0, VSBuffer.alloc(4 * 1024 * 1024 + 1)));
		await rejects(async () => service.finish(request.id, 0, -1));
		deepStrictEqual(await service.list(request.noteId), []);
	});
});
