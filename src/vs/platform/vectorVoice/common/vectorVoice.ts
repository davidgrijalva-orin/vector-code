/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { FileRecordingRequest, RecordingPlacement, localLibraryId, validateFileRecordingRequest } from '../../vectorCode/common/vectorCodeLibrary.js';

export const VECTOR_VOICE_CHANNEL = 'vectorVoiceV1';
export const IVectorVoiceService = createDecorator<IVectorVoiceService>('vectorVoiceService');
export interface VoiceConnection { connected: boolean; authorizationUrl?: string }
export interface VoiceJob { recordingId: string; status: string; meetingId?: string; resultReady: boolean }
export interface IVectorVoiceService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	connection(): Promise<VoiceConnection>;
	beginSignIn(): Promise<VoiceConnection>;
	signOut(): Promise<void>;
	processRecording(id: string): Promise<VoiceJob>;
	refreshRecording(id: string): Promise<VoiceJob>;
	fileResult(request: FileRecordingRequest): Promise<RecordingPlacement>;
}
export class VectorVoiceChannel implements IServerChannel {
	constructor(private readonly service: IVectorVoiceService) { }
	listen<T>(_context: unknown, event: string): Event<T> { if (event === 'onDidChange') { return this.service.onDidChange as Event<T>; } throw new Error('Unsupported Voice event.'); }
	async call<T>(_context: unknown, command: string, args: unknown): Promise<T> {
		if (!Array.isArray(args)) { throw new Error('Invalid Voice request.'); }
		if (args.length === 0) {
			if (command === 'connection') { return await this.service.connection() as T; }
			if (command === 'beginSignIn') { return await this.service.beginSignIn() as T; }
			if (command === 'signOut') { return await this.service.signOut() as T; }
		}
		if (args.length === 1) {
			if (command === 'processRecording') { return await this.service.processRecording(localLibraryId(args[0])) as T; }
			if (command === 'refreshRecording') { return await this.service.refreshRecording(localLibraryId(args[0])) as T; }
			if (command === 'fileResult') { return await this.service.fileResult(validateFileRecordingRequest(args[0])) as T; }
		}
		throw new Error('Unsupported Voice request.');
	}
}
