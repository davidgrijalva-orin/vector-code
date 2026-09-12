/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IVectorCodeRecordingsService, LocalRecording } from '../common/vectorCodeRecordings.js';

export interface AudioCaptureEnvironment {
	getStream(): Promise<MediaStream>;
	createRecorder(stream: MediaStream): MediaRecorder;
	now(): number;
}
const environment: AudioCaptureEnvironment = {
	getStream: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
	createRecorder: stream => {
		const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
		if (!mimeType) { throw new Error('This app cannot record WebM audio on this device.'); }
		return new MediaRecorder(stream, { mimeType });
	},
	now: () => performance.now()
};
export interface AudioCaptureFinished { recording?: LocalRecording; error?: Error }
export const IVectorCodeAudioService = createDecorator<IVectorCodeAudioService>('vectorCodeAudioService');
export interface IVectorCodeAudioService {
	readonly _serviceBrand: undefined;
	readonly onDidFinish: Event<AudioCaptureFinished>;
	readonly isRecording: boolean;
	start(noteId: string): Promise<void>;
	stop(): Promise<LocalRecording | undefined>;
	play(id: string): Promise<void>;
	stopPlayback(): void;
}
/** Device capability adapter. Recording identity, durable bytes and receipts belong to the service API. */
export class LocalAudioCapture extends Disposable implements IVectorCodeAudioService {
	declare readonly _serviceBrand: undefined;
	private readonly finishedEmitter = this._register(new Emitter<AudioCaptureFinished>());
	readonly onDidFinish = this.finishedEmitter.event;
	private recorder: MediaRecorder | undefined;
	private stream: MediaStream | undefined;
	private initializing = false;
	private completion: Promise<LocalRecording> | undefined;
	private playbackGeneration = 0;
	private player: HTMLAudioElement | undefined;
	private playerUrl: string | undefined;
	get isRecording(): boolean { return this.initializing || !!this.recorder; }
	constructor(private readonly recordings: IVectorCodeRecordingsService, private readonly device: AudioCaptureEnvironment = environment) { super(); }
	async start(noteId: string): Promise<void> {
		if (this.isRecording) { throw new Error('Stop the current recording first.'); }
		this.stopPlayback();
		this.initializing = true;
		let stream: MediaStream | undefined;
		try {
			stream = await this.device.getStream();
			if (this._store.isDisposed) { throw new Error('The recording window closed.'); }
			const recorder = this.device.createRecorder(stream);
			const request = { version: 1 as const, id: generateUuid(), noteId, mimeType: recorder.mimeType };
			try { await this.recordings.begin(request); } catch { await this.recordings.begin(request); }
			if (this._store.isDisposed) { throw new Error('The recording window closed.'); }
			this.recorder = recorder; this.stream = stream;
			let sequence = 0; let queuedBytes = 0; let failure: Error | undefined;
			let pending = Promise.resolve();
			const started = this.device.now();
			let resolve!: (recording: LocalRecording) => void; let reject!: (error: Error) => void;
			this.completion = new Promise<LocalRecording>((done, failed) => { resolve = done; reject = failed; });
			void this.completion.catch(() => undefined);
			const fail = (error: unknown) => {
				failure ??= error instanceof Error ? error : new Error('Audio could not be saved.');
				if (recorder.state !== 'inactive') { recorder.stop(); }
			};
			recorder.addEventListener('dataavailable', event => {
				if (!event.data.size || failure) { return; }
				queuedBytes += event.data.size;
				if (queuedBytes > 8 * 1024 * 1024) { fail(new Error('Recording stopped because storage could not keep up. Previously saved audio is available.')); return; }
				pending = pending.then(async () => {
					const data = VSBuffer.wrap(new Uint8Array(await event.data.arrayBuffer()));
					try { await this.recordings.append(request.id, sequence, data); } catch { await this.recordings.append(request.id, sequence, data); }
					sequence++; queuedBytes -= event.data.size;
				});
				void pending.catch(fail);
			});
			recorder.addEventListener('error', () => fail(new Error('The microphone stopped unexpectedly. Previously saved audio is available.')));
			recorder.addEventListener('stop', () => {
				for (const track of stream!.getTracks()) { track.stop(); }
				const duration = Math.max(0, Math.round(this.device.now() - started));
				void pending.then(async () => {
					if (failure) { throw failure; }
					try { return await this.recordings.finish(request.id, sequence, duration); } catch { return await this.recordings.finish(request.id, sequence, duration); }
				}).then(recording => {
					this.recorder = undefined; this.stream = undefined;
					resolve(recording); this.finishedEmitter.fire({ recording });
				}, error => {
					this.recorder = undefined; this.stream = undefined;
					reject(error); this.finishedEmitter.fire({ error: error instanceof Error ? error : new Error('Recording could not finish.') });
				});
			}, { once: true });
			for (const track of stream.getTracks()) { track.addEventListener('ended', () => { if (recorder.state !== 'inactive') { recorder.stop(); } }, { once: true }); }
			recorder.start(1000);
		} catch (error) {
			for (const track of stream?.getTracks() ?? []) { track.stop(); }
			this.recorder = undefined; this.stream = undefined;
			throw error;
		} finally { this.initializing = false; }
	}
	async stop(): Promise<LocalRecording | undefined> {
		if (!this.recorder) { return undefined; }
		if (this.recorder.state !== 'inactive') { this.recorder.stop(); }
		return this.completion;
	}
	async play(id: string): Promise<void> {
		if (this.isRecording) { throw new Error('Stop recording before playing audio.'); }
		this.stopPlayback();
		const generation = this.playbackGeneration;
		const { recording, data } = await this.recordings.read(id);
		if (this._store.isDisposed || generation !== this.playbackGeneration || this.isRecording) { return; }
		const bytes = new Uint8Array(data.byteLength); bytes.set(data.buffer);
		const url = URL.createObjectURL(new Blob([bytes], { type: recording.mimeType }));
		const audio = new Audio(url); this.player = audio; this.playerUrl = url;
		audio.addEventListener('ended', () => { if (this.player === audio) { this.stopPlayback(); } }, { once: true });
		audio.addEventListener('error', () => { if (this.player === audio) { this.stopPlayback(); } }, { once: true });
		try { await audio.play(); } catch (error) { if (this.player !== audio) { return; } this.stopPlayback(); throw error; }
	}
	stopPlayback(): void { this.playbackGeneration++; this.player?.pause(); this.player?.removeAttribute('src'); this.player = undefined; if (this.playerUrl) { URL.revokeObjectURL(this.playerUrl); this.playerUrl = undefined; } }
	override dispose(): void {
		if (this.recorder?.state !== 'inactive') { this.recorder?.stop(); }
		for (const track of this.stream?.getTracks() ?? []) { track.stop(); }
		this.stopPlayback(); super.dispose();
	}
}
class VectorCodeAudioService extends LocalAudioCapture {
	constructor(@IVectorCodeRecordingsService recordings: IVectorCodeRecordingsService) { super(recordings); }
}
registerSingleton(IVectorCodeAudioService, VectorCodeAudioService, InstantiationType.Delayed);
