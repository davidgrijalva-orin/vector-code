/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IVectorVoiceService } from '../../../../platform/vectorVoice/common/vectorVoice.js';
import { LocalRecording } from '../../../../platform/vectorCode/common/vectorCodeRecordings.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.connectVoice', title: localize2('connectVoice', 'Work: Connect Voice'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const voice = accessor.get(IVectorVoiceService); const notifications = accessor.get(INotificationService); const opener = accessor.get(IOpenerService);
		if ((await voice.connection()).connected) { notifications.info('Voice is connected. Choose a saved recording to process.'); return; }
		const connection = await voice.beginSignIn();
		if (connection.authorizationUrl) { await opener.open(URI.parse(connection.authorizationUrl), { openExternal: true }); }
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.disconnectVoice', title: localize2('disconnectVoice', 'Work: Disconnect Voice'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IVectorVoiceService).signOut(); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.voiceRecording', title: localize2('voiceRecording', 'Work: Process Saved Recording with Voice'), f1: false }); }
	async run(accessor: ServicesAccessor, recording: LocalRecording, refresh = false): Promise<void> {
		const voice = accessor.get(IVectorVoiceService); const commands = accessor.get(ICommandService);
		const dialogs = accessor.get(IDialogService); const quick = accessor.get(IQuickInputService); const notifications = accessor.get(INotificationService);
		if (!(await voice.connection()).connected) { await commands.executeCommand('vectorCode.connectVoice'); return; }
		if (!refresh) {
			const consent = await dialogs.confirm({ message: 'Upload this recording to Voice for processing?', detail: 'The saved audio will be sent to your Voice account and its transcription provider to generate meeting notes. Your local recording remains on this computer.', primaryButton: 'Upload and Process' });
			if (!consent.confirmed) { return; }
		}
		const job = refresh ? await voice.refreshRecording(recording.id) : await voice.processRecording(recording.id);
		if (job.resultReady) {
			const action = await quick.pick([{ label: 'File generated notes and recording…', file: true }, { label: 'Keep the result for later', file: false }], { placeHolder: 'Voice generated meeting notes. The complete transcript is not included.' });
			if (action?.file) { await commands.executeCommand('vectorCode.fileLocalRecording', recording, true); }
		} else {
			notifications.info('Voice status: ' + job.status.replaceAll('_', ' ') + '. Use Check Voice Processing on this recording to retrieve its result.');
		}
	}
});
