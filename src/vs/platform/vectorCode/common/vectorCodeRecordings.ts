/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { localLibraryId } from './vectorCodeLibrary.js';

export const VECTOR_CODE_RECORDINGS_CHANNEL = 'vectorCodeRecordingsV1';
export const IVectorCodeRecordingsService = createDecorator<IVectorCodeRecordingsService>('vectorCodeRecordingsService');
export interface RecordingStart { version: 1; id: string; noteId: string; mimeType: string }
export interface LocalRecording extends RecordingStart { createdAt: number; status: 'capturing' | 'stopped'; chunks: number; bytes: number; durationMs?: number }
export interface IVectorCodeRecordingsService {
	readonly _serviceBrand: undefined;
	begin(request: RecordingStart): Promise<LocalRecording>;
	append(id: string, sequence: number, data: VSBuffer): Promise<number>;
	finish(id: string, chunks: number, durationMs: number): Promise<LocalRecording>;
	list(noteId: string): Promise<LocalRecording[]>;
	read(id: string): Promise<{ recording: LocalRecording; data: VSBuffer }>;
}
export function validateRecordingStart(value: unknown): RecordingStart {
	if (!value || typeof value !== 'object') { throw new Error('Invalid recording request.'); }
	const request = value as RecordingStart;
	if (request.version !== 1 || !['audio/webm', 'audio/webm;codecs=opus'].includes(request.mimeType)) { throw new Error('Unsupported recording format.'); }
	return { version: 1, id: localLibraryId(request.id), noteId: localLibraryId(request.noteId), mimeType: request.mimeType };
}
export function recordingSequence(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 86400) { throw new Error('Invalid recording sequence.'); }
	return value;
}
export class VectorCodeRecordingsChannel implements IServerChannel {
	constructor(private readonly service: IVectorCodeRecordingsService) { }
	listen<T>(): Event<T> { throw new Error('Unsupported recording event.'); }
	async call<T>(_context: unknown, command: string, args: unknown): Promise<T> {
		if (!Array.isArray(args)) { throw new Error('Invalid recording arguments.'); }
		if (command === 'begin' && args.length === 1) { return await this.service.begin(validateRecordingStart(args[0])) as T; }
		if (command === 'append' && args.length === 3 && args[2] instanceof VSBuffer) { return await this.service.append(localLibraryId(args[0]), recordingSequence(args[1]), args[2]) as T; }
		if (command === 'finish' && args.length === 3) { return await this.service.finish(localLibraryId(args[0]), recordingSequence(args[1]), args[2]) as T; }
		if (command === 'list' && args.length === 1) { return await this.service.list(localLibraryId(args[0])) as T; }
		if (command === 'read' && args.length === 1) { return await this.service.read(localLibraryId(args[0])) as T; }
		throw new Error('Unsupported recording operation.');
	}
}
