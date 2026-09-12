/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, INotificationHandle, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IVectorCodeAudioService } from '../../../../platform/vectorCode/browser/vectorCodeAudio.js';
import { IVectorCodeRecordingsService } from '../../../../platform/vectorCode/common/vectorCodeRecordings.js';

/** UI actions use only capability APIs. Microphone access starts only after the explicit recording action. */
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.recordLocalNote', title: localize2('recordLocalNote', 'Work: Record Audio in a Local Note'), f1: false }); }
	async run(accessor: ServicesAccessor, noteId: string, tabId?: string, pageId?: string): Promise<void> {
		const audio = accessor.get(IVectorCodeAudioService); const notifications = accessor.get(INotificationService);
		const listeners = new DisposableStore(); let notification: INotificationHandle | undefined;
		listeners.add(Event.once(audio.onDidFinish)(result => { listeners.dispose(); notification?.close(); notification = undefined; if (result.error) { notifications.error(result.error); } }));
		try { await audio.start(noteId, tabId, pageId); } catch (error) { listeners.dispose(); throw error; }
		if (!audio.isRecording) { listeners.dispose(); return; }
		notification = notifications.prompt(Severity.Info, 'Recording audio on this computer. Close this notice or choose Stop to finish.', [{ label: 'Stop recording', run: () => { void audio.stop().catch(() => undefined); } }], { sticky: true });
		listeners.add(Event.once(notification.onDidClose)(() => { void audio.stop().catch(() => undefined); }));
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.stopLocalRecording', title: localize2('stopLocalRecording', 'Work: Stop Local Recording'), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { const audio = accessor.get(IVectorCodeAudioService); await audio.stop(); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.stopLocalPlayback', title: localize2('stopLocalPlayback', 'Work: Stop Audio Playback'), f1: true }); }
	run(accessor: ServicesAccessor): void { accessor.get(IVectorCodeAudioService).stopPlayback(); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'vectorCode.localNoteRecordings', title: localize2('localNoteRecordings', 'Work: Open Recordings in a Local Note'), f1: false }); }
	async run(accessor: ServicesAccessor, noteId: string): Promise<void> {
		const commands = accessor.get(ICommandService); const recordings = accessor.get(IVectorCodeRecordingsService); const audio = accessor.get(IVectorCodeAudioService); const quick = accessor.get(IQuickInputService); const dialogs = accessor.get(IFileDialogService); const files = accessor.get(IFileService);
		const items = await recordings.list(noteId);
		const selected = await quick.pick(items.map(recording => ({ label: new Date(recording.createdAt).toLocaleString(), description: recording.status === 'stopped' ? 'Saved recording' : 'Unfinished recording · saved audio can be recovered', recording })), { placeHolder: 'Audio attached to this note' });
		if (!selected) { return; }
		const action = await quick.pick([{ label: 'Play saved audio', kind: 'play' }, { label: 'Export saved audio as WebM…', kind: 'export' }, { label: 'File in another document or tab…', kind: 'file' }], { placeHolder: 'An interrupted recording may contain only the successfully saved audio.' });
		if (!action) { return; }
		if (action.kind === 'file') { await commands.executeCommand('vectorCode.fileLocalRecording', selected.recording); return; }
		if (action.kind === 'play') { await audio.play(selected.recording.id); return; }
		const target = await dialogs.showSaveDialog({ title: 'Export saved recording', filters: [{ name: 'WebM audio', extensions: ['webm'] }] });
		if (target) { const { data } = await recordings.read(selected.recording.id); await files.writeFile(target, data); }
	}
});
