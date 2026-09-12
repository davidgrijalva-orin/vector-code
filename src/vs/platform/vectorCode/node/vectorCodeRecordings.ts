/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join } from '../../../base/common/path.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IVectorCodeLibraryService, localLibraryId, localDocumentTabs, localPageBreak } from '../common/vectorCodeLibrary.js';
import { IVectorCodeRecordingsService, LocalRecording, RecordingStart, recordingSequence, validateRecordingStart } from '../common/vectorCodeRecordings.js';
import { writeLocalWorkFile } from './vectorCodeLocalFile.js';

interface Chunk { bytes: number; hash: string }
interface Manifest { recording: LocalRecording; parts: Chunk[] }
const MAX_BYTES = 128 * 1024 * 1024;
function hash(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex'); }
/** Audio is stored separately from note text. A stable note relationship survives project moves. */
export class VectorCodeRecordings implements IVectorCodeRecordingsService {
	declare readonly _serviceBrand: undefined;
	private queue: Promise<unknown> = Promise.resolve();
	constructor(private readonly directory: string, private readonly library: IVectorCodeLibraryService) { }
	private serial<T>(operation: () => Promise<T>): Promise<T> { const result = this.queue.then(operation); this.queue = result.catch(() => undefined); return result; }
	private path(id: string, name: string): string { return join(this.directory, localLibraryId(id), name); }
	private async manifest(id: string): Promise<Manifest> {
		const value: Manifest = JSON.parse(await fs.readFile(this.path(id, 'recording.json'), 'utf8'));
		validateRecordingStart(value.recording);
		const recording = value.recording;
		if (recording.id !== id || !Array.isArray(value.parts) || !Number.isSafeInteger(recording.createdAt) || recording.createdAt < 0 || !['capturing', 'stopped'].includes(recording.status) || recordingSequence(recording.chunks) !== value.parts.length || !Number.isSafeInteger(recording.bytes) || recording.bytes < 0 || recording.bytes > MAX_BYTES || value.parts.some(part => !Number.isSafeInteger(part.bytes) || part.bytes <= 0 || part.bytes > 4 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(part.hash)) || value.parts.reduce((sum, part) => sum + part.bytes, 0) !== recording.bytes) { throw new Error('The recording metadata cannot be read. Saved audio has been preserved.'); }
		return value;
	}
	private async save(manifest: Manifest): Promise<void> { await writeLocalWorkFile(this.path(manifest.recording.id, 'recording.json'), JSON.stringify(manifest)); }
	begin(input: RecordingStart): Promise<LocalRecording> {
		const request = validateRecordingStart(input);
		return this.serial(async () => {
			const note = (await this.library.read()).notes.find(note => note.id === request.noteId);
			if (!note) { throw new Error('Choose a local document for this recording.'); }
			try {
				const { recording } = await this.manifest(request.id);
				if (recording.noteId !== request.noteId || recording.mimeType !== request.mimeType || recording.tabId !== request.tabId || recording.pageId !== request.pageId) { throw new Error('This recording identity was used for a different capture.'); }
				return recording;
			} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
			const tab = localDocumentTabs(note).find(tab => tab.id === (request.tabId ?? note.id));
			if (!tab || (request.pageId && !tab.body.includes(localPageBreak(request.pageId)))) { throw new Error('The recording destination tab or page no longer exists.'); }
			const recording: LocalRecording = { ...request, createdAt: Date.now(), status: 'capturing', chunks: 0, bytes: 0 };
			await this.save({ recording, parts: [] });
			return recording;
		});
	}
	append(id: string, sequence: number, content: VSBuffer): Promise<number> {
		localLibraryId(id); recordingSequence(sequence);
		if (sequence === 86400) { throw new Error('The recording reached its maximum number of audio chunks.'); }
		if (!(content instanceof VSBuffer) || content.byteLength < 1 || content.byteLength > 4 * 1024 * 1024) { throw new Error('Invalid recording chunk.'); }
		const data = new Uint8Array(content.buffer);
		return this.serial(async () => {
			const manifest = await this.manifest(id); const digest = hash(data);
			if (sequence < manifest.parts.length) {
				if (manifest.parts[sequence].hash !== digest || manifest.parts[sequence].bytes !== data.byteLength) { throw new Error('This audio sequence already contains different data.'); }
				return sequence + 1;
			}
			if (manifest.recording.status !== 'capturing' || sequence !== manifest.parts.length) { throw new Error('The recording is closed or an earlier audio chunk is missing.'); }
			if (manifest.recording.bytes + data.byteLength > MAX_BYTES) { throw new Error('Recording reached the 128 MB limit. Previously saved audio is preserved.'); }
			await writeLocalWorkFile(this.path(id, sequence + '.webm'), data);
			manifest.parts.push({ bytes: data.byteLength, hash: digest });
			manifest.recording.chunks++; manifest.recording.bytes += data.byteLength;
			await this.save(manifest);
			return sequence + 1;
		});
	}
	finish(id: string, chunks: number, durationMs: number): Promise<LocalRecording> {
		localLibraryId(id); recordingSequence(chunks);
		if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 24 * 60 * 60 * 1000) { throw new Error('Invalid recording duration.'); }
		return this.serial(async () => {
			const manifest = await this.manifest(id);
			if (!chunks) { throw new Error('No audio was captured. Try recording again.'); }
			if (manifest.recording.chunks !== chunks) { throw new Error('Some audio has not been saved. Keep the recording open and retry.'); }
			if (manifest.recording.status === 'stopped') { return manifest.recording; }
			manifest.recording.status = 'stopped'; manifest.recording.durationMs = durationMs;
			await this.save(manifest); return manifest.recording;
		});
	}
	list(noteId: string): Promise<LocalRecording[]> {
		localLibraryId(noteId);
		return this.serial(async () => {
			let entries;
			try { entries = await fs.readdir(this.directory, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return []; } throw error; }
			const recordings: LocalRecording[] = [];
			for (const entry of entries) {
				if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) { continue; }
				let recording: LocalRecording;
				try { recording = (await this.manifest(entry.name)).recording; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { continue; } throw error; }
				if (recording.noteId === noteId) { recordings.push(recording); }
			}
			return recordings.sort((a, b) => b.createdAt - a.createdAt);
		});
	}
	read(id: string): Promise<{ recording: LocalRecording; data: VSBuffer }> {
		localLibraryId(id);
		return this.serial(async () => {
			const manifest = await this.manifest(id);
			if (!manifest.parts.length) { throw new Error('No audio was saved in this recording.'); }
			const buffers: VSBuffer[] = [];
			for (let index = 0; index < manifest.parts.length; index++) {
				const bytes = await fs.readFile(this.path(id, index + '.webm'));
				if (bytes.byteLength !== manifest.parts[index].bytes || hash(bytes) !== manifest.parts[index].hash) { throw new Error('A saved audio chunk is damaged. The original files have been preserved.'); }
				buffers.push(VSBuffer.wrap(bytes));
			}
			return { recording: manifest.recording, data: VSBuffer.concat(buffers) };
		});
	}
}
