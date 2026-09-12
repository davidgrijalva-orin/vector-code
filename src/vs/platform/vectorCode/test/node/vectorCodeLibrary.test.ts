/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { LibraryMutation, VectorCodeLibraryChannel } from '../../common/vectorCodeLibrary.js';
import { VectorCodeLibrary } from '../../node/vectorCodeLibrary.js';

suite('VectorCode local library', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let directory: string; let service: VectorCodeLibrary;
	setup(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'vectorcode-library-')); service = new VectorCodeLibrary(directory); });
	teardown(async () => { await fs.rm(directory, { recursive: true, force: true }); });
	const base = () => ({ version: 1 as const, requestId: generateUuid() });
	test('account-free projects, inbox, moves and revision history survive service restart', async () => {
		const first = await service.mutate({ ...base(), kind: 'createProject', title: 'Writing' });
		const second = await service.mutate({ ...base(), kind: 'createProject', title: 'Research' });
		const note = await service.mutate({ ...base(), kind: 'createNote', title: 'Idea', projectIds: [] });
		strictEqual((await service.read()).notes[0].projectIds.length, 0);
		await service.mutate({ ...base(), kind: 'saveNote', id: note.id, expectedRevision: 1, body: '# A durable idea' });
		await service.mutate({ ...base(), kind: 'assignNote', id: note.id, expectedRevision: 2, projectIds: [first.id, second.id] });
		await service.mutate({ ...base(), kind: 'assignNote', id: note.id, expectedRevision: 3, projectIds: [second.id] });
		await service.mutate({ ...base(), kind: 'assignNote', id: note.id, expectedRevision: 4, projectIds: [] });
		await service.mutate({ ...base(), kind: 'setFolders', id: first.id, expectedRevision: 1, folders: ['file:///one', 'file:///two', 'file:///one'] });
		await service.mutate({ ...base(), kind: 'setFolders', id: first.id, expectedRevision: 2, folders: [] });
		const loaded = await new VectorCodeLibrary(directory).read();
		deepStrictEqual(loaded, await service.read());
		strictEqual(loaded.notes.length, 1); strictEqual(loaded.notes[0].id, note.id);
		strictEqual(loaded.notes[0].body, '# A durable idea'); strictEqual(loaded.notes[0].history.length, 1);
		deepStrictEqual(loaded.notes[0].projectIds, []); deepStrictEqual(loaded.projects[0].folders, []);
	});
	test('concurrent stale writes reject without overwriting either saved revision', async () => {
		const note = await service.mutate({ ...base(), kind: 'createNote', title: 'Note', projectIds: [] });
		const results = await Promise.allSettled(['one', 'two'].map(body => service.mutate({ ...base(), kind: 'saveNote', id: note.id, expectedRevision: 1, body })));
		strictEqual(results.filter(result => result.status === 'fulfilled').length, 1);
		strictEqual((await service.read()).notes[0].body, 'one');
		await rejects(service.mutate({ ...base(), kind: 'assignNote', id: note.id, expectedRevision: 1, projectIds: [] }), /changed in another window/);
	});
	test('lost replies retry exactly once after restart and reject reused identities', async () => {
		const request: LibraryMutation = { ...base(), kind: 'createNote', title: 'Idea', projectIds: [] };
		const original = await service.mutate(request);
		service = new VectorCodeLibrary(directory);
		deepStrictEqual(await service.mutate(request), original);
		await rejects(service.mutate({ ...request, title: 'Different' }), /different change/);
		strictEqual((await service.read()).notes.length, 1);
		const save: LibraryMutation = { ...base(), kind: 'saveNote', id: original.id, expectedRevision: 1, body: 'Saved' };
		const saved = await service.mutate(save);
		await service.mutate({ ...base(), kind: 'saveNote', id: original.id, expectedRevision: 2, body: 'Next' });
		deepStrictEqual(await new VectorCodeLibrary(directory).mutate(save), saved);
		strictEqual((await service.read()).notes[0].revision, 3);
	});
	test('failed commit keeps prior content and leaves the original request retryable', async () => {
		await service.read();
		await fs.mkdir(join(directory, 'library-v1.pending'));
		const request: LibraryMutation = { ...base(), kind: 'createNote', title: 'Idea', projectIds: [] };
		await rejects(service.mutate(request));
		strictEqual((await service.read()).notes.length, 0);
		await fs.rmdir(join(directory, 'library-v1.pending'));
		await service.mutate(request);
		strictEqual((await new VectorCodeLibrary(directory).read()).notes.length, 1);
	});
	test('corruption and future formats fail closed without resetting saved data', async () => {
		for (const content of ['{broken', JSON.stringify({ version: 2, events: [] }), JSON.stringify({ version: 1, events: [{ request: { kind: 'erase' }, at: 1 }] })]) {
			await fs.writeFile(join(directory, 'library-v1.json'), content);
			await rejects(new VectorCodeLibrary(directory).mutate({ ...base(), kind: 'createProject', title: 'New' }));
			strictEqual(await fs.readFile(join(directory, 'library-v1.json'), 'utf8'), content);
		}
	});
	test('IPC rejects unknown methods, invalid contracts and filesystem access', async () => {
		const channel = new VectorCodeLibraryChannel(service);
		await rejects(channel.call(undefined, 'remove', []));
		await rejects(channel.call(undefined, 'read', ['file:///etc/passwd']));
		await rejects(channel.call(undefined, 'mutate', [{ ...base(), kind: 'createNote', title: 'Missing project', projectIds: [generateUuid()] }]));
		await rejects(channel.call(undefined, 'mutate', [{ ...base(), kind: 'createProject', title: '' }]));
		await rejects(channel.call(undefined, 'mutate', [{ ...base(), kind: 'setFolders', id: generateUuid(), expectedRevision: 1, folders: ['https://example.com'] }]));
		deepStrictEqual(await service.read(), { version: 1, projects: [], notes: [] });
	});
	test('search includes full saved content and project names without a network dependency', async () => {
		const project = await service.mutate({ ...base(), kind: 'createProject', title: 'Research' });
		const note = await service.mutate({ ...base(), kind: 'createNote', title: 'Note', projectIds: [project.id] });
		await service.mutate({ ...base(), kind: 'saveNote', id: note.id, expectedRevision: 1, body: 'x'.repeat(4000) + ' A hidden discovery' });
		strictEqual((await service.findNotes('discovery'))[0].id, note.id);
		strictEqual((await service.findNotes('RESEARCH'))[0].id, note.id);
		deepStrictEqual(await service.findNotes('missing'), []);
	});

	test('callers cannot mutate saved state through returned objects or queued inputs', async () => {
		const request: LibraryMutation = { ...base(), kind: 'createNote', title: 'Original', projectIds: [] };
		const operation = service.mutate(request); request.title = 'Changed'; await operation;
		const snapshot = await service.read(); snapshot.notes[0].body = 'Unsaved';
		strictEqual((await service.read()).notes[0].title, 'Original'); strictEqual((await service.read()).notes[0].body, '');
	});
});
