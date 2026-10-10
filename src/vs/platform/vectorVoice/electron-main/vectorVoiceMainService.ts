/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { net } from 'electron';
import { Disposable } from '../../../base/common/lifecycle.js';
import { join } from '../../../base/common/path.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IEncryptionMainService } from '../../encryption/common/encryptionService.js';
import { IStateService } from '../../state/node/state.js';
import { IURLService } from '../../url/common/url.js';
import { IVectorCodeRecordingsService } from '../../vectorCode/common/vectorCodeRecordings.js';
import { IVectorCodeLibraryService, FileRecordingRequest } from '../../vectorCode/common/vectorCodeLibrary.js';
import { IVectorVoiceService } from '../common/vectorVoice.js';
import { VectorVoiceAuth } from '../node/vectorVoiceAuth.js';
import { VectorVoiceProcessing } from '../node/vectorVoiceProcessing.js';

export class VectorVoiceMainService extends Disposable implements IVectorVoiceService {
	declare readonly _serviceBrand: undefined;
	private readonly auth: VectorVoiceAuth;
	private readonly processing: VectorVoiceProcessing;
	readonly onDidChange;
	constructor(@IEnvironmentMainService environment: IEnvironmentMainService, @IEncryptionMainService encryption: IEncryptionMainService, @IStateService state: IStateService, @IURLService urls: IURLService, @IVectorCodeRecordingsService recordings: IVectorCodeRecordingsService, @IVectorCodeLibraryService library: IVectorCodeLibraryService) {
		super(); this.auth = this._register(new VectorVoiceAuth(encryption, state, net.fetch)); this.onDidChange = this.auth.onDidChange;
		this._register(urls.registerHandler(this.auth));
		this.processing = new VectorVoiceProcessing(join(environment.userDataPath, 'VectorCode', 'VoiceJobs'), this.auth, recordings, library);
	}
	connection() { return this.auth.connection(); }
	beginSignIn() { return this.auth.beginSignIn(); }
	signOut() { return this.auth.signOut(); }
	processRecording(id: string) { return this.processing.processRecording(id); }
	refreshRecording(id: string) { return this.processing.refreshRecording(id); }
	fileResult(request: FileRecordingRequest) { return this.processing.fileResult(request); }
}
