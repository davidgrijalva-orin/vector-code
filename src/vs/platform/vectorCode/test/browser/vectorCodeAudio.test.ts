/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { AudioCaptureEnvironment, LocalAudioCapture } from '../../browser/vectorCodeAudio.js';
import { IVectorCodeRecordingsService, LocalRecording, RecordingStart } from '../../common/vectorCodeRecordings.js';

class Recorder extends EventTarget {
	state: RecordingState = 'inactive'; readonly mimeType = 'audio/webm';
	start() { this.state = 'recording'; }
	chunk(text: string) { this.dispatchEvent(new BlobEvent('dataavailable', { data: new Blob([text]) })); }
	stop() { this.state = 'inactive'; this.chunk('final'); this.dispatchEvent(new Event('stop')); }
}
suite('VectorCode local audio capability', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const recorder = new Recorder(); let stopped = 0; let failAppend = 0; let denied = false;
		const calls: { sequence: number; body: string }[] = [];
		const saved = new Map<number, string>(); let record: LocalRecording;
		const track = new EventTarget(); Object.assign(track, { stop: () => { stopped++; } });
		const device: AudioCaptureEnvironment = {
			getStream: async () => { if (denied) { throw new Error('Microphone denied'); } return { getTracks: () => [track] } as unknown as MediaStream; },
			createRecorder: () => recorder as unknown as MediaRecorder, now: () => 1000
		};
		const backend = {
			begin: async (request: RecordingStart) => { record = { ...request, createdAt: 1, status: 'capturing', chunks: 0, bytes: 0 }; return record; },
			append: async (_id: string, sequence: number, data: VSBuffer) => { calls.push({ sequence, body: data.toString() }); saved.set(sequence, data.toString()); if (failAppend-- > 0) { throw new Error('Lost storage reply'); } return sequence + 1; },
			finish: async (_id: string, chunks: number, durationMs: number) => ({ ...record, chunks, durationMs, status: 'stopped' as const })
		} as unknown as IVectorCodeRecordingsService;
		const capture = store.add(new LocalAudioCapture(backend, device));
		return { capture, recorder, calls, saved, stopped: () => stopped, fail: (count: number) => { failAppend = count; }, deny: () => { denied = true; } };
	}
	test('explicit start and stop flush the final audio chunk before completion and release the microphone', async () => {
		const f = fixture(); strictEqual(f.capture.isRecording, false);
		await f.capture.start('note'); f.recorder.chunk('first');
		const result = await f.capture.stop();
		deepStrictEqual(f.calls, [{ sequence: 0, body: 'first' }, { sequence: 1, body: 'final' }]);
		strictEqual(result?.chunks, 2); strictEqual(f.stopped(), 1); strictEqual(f.capture.isRecording, false);
	});
	test('a lost append reply retries the same sequence and bytes', async () => {
		const f = fixture(); f.fail(1); await f.capture.start('note'); await f.capture.stop();
		deepStrictEqual(f.calls[0], f.calls[1]); strictEqual(f.saved.size, 1);
	});
	test('repeated storage failure stops capture and exposes failure instead of claiming a complete recording', async () => {
		const f = fixture(); f.fail(2); await f.capture.start('note');
		await rejects(f.capture.stop(), /Lost storage reply/);
		strictEqual(f.stopped(), 1); strictEqual(f.capture.isRecording, false);
	});
	test('permission denial creates no recorder and a second active start is rejected', async () => {
		const denied = fixture(); denied.deny(); await rejects(denied.capture.start('note'), /denied/);
		strictEqual(denied.capture.isRecording, false); strictEqual(denied.calls.length, 0);
		const f = fixture(); await f.capture.start('note'); await rejects(f.capture.start('other'), /Stop/); await f.capture.stop();
	});

	test('real browser encoding produces decodable WebM from a synthetic audio source', async function () {
		this.timeout(10000);
		const context = new AudioContext(); const destination = context.createMediaStreamDestination();
		const oscillator = context.createOscillator(); oscillator.connect(destination);
		const chunks: VSBuffer[] = []; let record: LocalRecording; let received!: () => void;
		const firstChunk = new Promise<void>(resolve => { received = resolve; });
		const backend = {
			begin: async (request: RecordingStart) => { record = { ...request, createdAt: 1, status: 'capturing', chunks: 0, bytes: 0 }; return record; },
			append: async (_id: string, sequence: number, data: VSBuffer) => { chunks.push(data); received(); return sequence + 1; },
			finish: async (_id: string, count: number, durationMs: number) => ({ ...record, chunks: count, durationMs, status: 'stopped' as const })
		} as unknown as IVectorCodeRecordingsService;
		const capture = store.add(new LocalAudioCapture(backend, {
			getStream: async () => destination.stream,
			createRecorder: stream => new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }),
			now: () => performance.now()
		}));
		try {
			const running = await raceTimeout(context.resume().then(() => true), 1000);
			if (!running) { this.skip(); }
			oscillator.start(); await capture.start('synthetic-note');
			const captured = await raceTimeout(firstChunk.then(() => true), 3000);
			if (!captured) { throw new Error('Synthetic audio did not produce a chunk: state=' + context.state + ', time=' + context.currentTime); }
			await capture.stop();
			const bytes = VSBuffer.concat(chunks); strictEqual(bytes.byteLength > 0, true);
			const copy = new Uint8Array(bytes.byteLength); copy.set(bytes.buffer);
			const decoded = await context.decodeAudioData(copy.buffer);
			strictEqual(decoded.length > 0, true); strictEqual(decoded.numberOfChannels > 0, true);
		} finally { capture.dispose(); oscillator.disconnect(); await context.close(); }
	});

	test('disposal releases microphone tracks even when the window closes before storage finishes', async () => {
		const f = fixture(); await f.capture.start('note'); f.capture.dispose();
		strictEqual(f.stopped() > 0, true);
		await f.capture.stop();
	});
});
