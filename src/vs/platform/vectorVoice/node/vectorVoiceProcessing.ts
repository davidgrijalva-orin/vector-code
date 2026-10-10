/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { generateUuid } from '../../../base/common/uuid.js';
import { join } from '../../../base/common/path.js';
import { FileRecordingRequest, RecordingPlacement, IVectorCodeLibraryService, localLibraryId } from '../../vectorCode/common/vectorCodeLibrary.js';
import { IVectorCodeRecordingsService } from '../../vectorCode/common/vectorCodeRecordings.js';
import { writeLocalWorkFile } from '../../vectorCode/node/vectorCodeLocalFile.js';
import { VoiceJob } from '../common/vectorVoice.js';
import { VectorVoiceAuth } from './vectorVoiceAuth.js';

interface SavedJob extends VoiceJob { account: string; requestId: string; title: string; transcriptionId?: string; body?: string }
const statuses = ['queued', 'capturing', 'processing', 'purging_audio', 'ready', 'awaiting_transcription_provider', 'failed', 'deleted'];
export class VectorVoiceProcessing {
	private queue: Promise<unknown> = Promise.resolve();
	constructor(private readonly directory: string, private readonly auth: VectorVoiceAuth, private readonly recordings: IVectorCodeRecordingsService, private readonly library: IVectorCodeLibraryService) { }
	private serial<T>(operation: () => Promise<T>): Promise<T> { const result = this.queue.then(operation); this.queue = result.catch(() => undefined); return result; }
	private path(id: string): string { return join(this.directory, localLibraryId(id) + '.json'); }
	private async load(id: string): Promise<SavedJob | undefined> {
		try {
			const job = JSON.parse(await fs.readFile(this.path(id), 'utf8')) as SavedJob;
			if (job.recordingId !== id || typeof job.account !== 'string' || !/^[a-f0-9]{64}$/.test(job.account) || typeof job.title !== 'string' || typeof job.status !== 'string') { throw new Error('Invalid saved Voice job.'); }
			localLibraryId(job.requestId); if (job.transcriptionId) { localLibraryId(job.transcriptionId); } if (job.meetingId) { localLibraryId(job.meetingId); }
			if (job.body !== undefined && (typeof job.body !== 'string' || job.body.length > 1000000)) { throw new Error('Invalid saved Voice result.'); }
			return job;
		} catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; } throw error; }
	}
	private save(job: SavedJob): Promise<void> { return writeLocalWorkFile(this.path(job.recordingId), JSON.stringify(job)); }
	private summary(job: SavedJob): VoiceJob { return { recordingId: job.recordingId, status: job.status, meetingId: job.meetingId, resultReady: typeof job.body === 'string' }; }
	private async readResponse(response: Response): Promise<Record<string, unknown>> {
		if (!response.ok) { throw new Error('Voice could not complete this request (' + response.status + '). Your local recording is preserved.'); }
		const text = await response.text(); if (text.length > 2000000) { throw new Error('Voice returned an oversized result.'); }
		const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('Invalid Voice response.'); } return value as Record<string, unknown>;
	}
	private update(job: SavedJob, response: Record<string, unknown>): void {
		const value = response.transcription as Record<string, unknown> | undefined;
		if (!value || typeof value.status !== 'string' || !statuses.includes(value.status)) { throw new Error('Invalid Voice processing state.'); }
		const id = localLibraryId(value.id); const meetingId = localLibraryId(value.meetingId);
		if ((job.transcriptionId && job.transcriptionId !== id) || (job.meetingId && job.meetingId !== meetingId)) { throw new Error('Voice returned a different recording result.'); }
		job.transcriptionId = id; job.meetingId = meetingId; job.status = value.status;
	}
	processRecording(id: string): Promise<VoiceJob> {
		return this.serial(async () => {
			const account = await this.auth.accountKey();
			let job = await this.load(id);
			if (job && job.account !== account) { throw new Error('Reconnect the Voice account that started this recording request.'); }
			if (job?.transcriptionId) { return this.refresh(job); }
			const { recording, data } = await this.recordings.read(id);
			if (recording.status !== 'stopped' || !recording.bytes || !recording.durationMs) { throw new Error('Finish and save the recording before processing it.'); }
			if (!job) {
				const note = (await this.library.read()).notes.find(note => note.id === recording.noteId);
				job = { recordingId: id, account, requestId: generateUuid(), title: note?.title ?? 'Recording', status: 'upload_pending', resultReady: false };
				await this.save(job);
			}
			const body = new FormData(); body.set('source', 'upload'); body.set('title', job.title); body.set('durationSeconds', String(Math.ceil(recording.durationMs / 1000))); body.set('file', new Blob([Uint8Array.from(data.buffer).buffer], { type: recording.mimeType }), 'recording.webm');
			this.update(job, await this.readResponse(await this.auth.authorized('/api/v1/transcriptions', { method: 'POST', headers: { 'idempotency-key': job.requestId }, body }, job.account)));
			await this.save(job); return this.summary(job);
		});
	}
	refreshRecording(id: string): Promise<VoiceJob> { return this.serial(async () => { const job = await this.load(id); if (!job?.transcriptionId) { throw new Error('This recording has no confirmed Voice upload. Choose Process with Voice to retry.'); } return this.refresh(job); }); }
	private async refresh(job: SavedJob): Promise<VoiceJob> {
		if (job.account !== await this.auth.accountKey()) { throw new Error('Reconnect the Voice account that started this recording request.'); }
		this.update(job, await this.readResponse(await this.auth.authorized('/api/v1/transcriptions/' + localLibraryId(job.transcriptionId), {}, job.account)));
		if (job.status === 'ready' && !job.body) {
			const result = await this.readResponse(await this.auth.authorized('/api/v1/meetings/' + localLibraryId(job.meetingId), {}, job.account));
			const meeting = result.meeting as Record<string, unknown> | undefined;
			if (!meeting || meeting.id !== job.meetingId || typeof meeting.summary !== 'string' || typeof meeting.title !== 'string') { throw new Error('Invalid Voice meeting notes.'); }
			const items = (value: unknown) => Array.isArray(value) ? value.map(item => { if (!item || typeof item.text !== 'string') { throw new Error('Invalid Voice note item.'); } return '- ' + item.text; }).join('\n') : '';
			job.body = '# ' + meeting.title + '\n\n' + meeting.summary + '\n\n## Decisions\n' + items(meeting.decisions) + '\n\n## Actions\n' + items(meeting.actions) + '\n\nGenerated meeting notes from Voice. This is not the complete transcript.\nVoice meeting: ' + job.meetingId + '\nLocal recording: ' + job.recordingId;
			if (job.body.length > 1000000) { throw new Error('Voice notes are too large to file.'); }
		}
		await this.save(job); return this.summary(job);
	}
	fileResult(request: FileRecordingRequest): Promise<RecordingPlacement> {
		return this.serial(async () => {
			const job = await this.load(request.recordingId);
			if (!job?.body || job.account !== await this.auth.accountKey()) { throw new Error('Refresh the completed Voice result before filing it.'); }
			return this.recordings.file({ ...request, body: job.body });
		});
	}
}
