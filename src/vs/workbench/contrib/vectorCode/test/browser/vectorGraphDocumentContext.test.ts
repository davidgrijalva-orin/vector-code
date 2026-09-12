/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { isResourceEditorInput } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import '../../browser/vectorGraphDocuments.contribution.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IVectorGraphBinding, IVectorGraphService } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { IVectorCodeWorkbenchService } from '../../common/vectorCode.js';
import { VECTOR_GRAPH_BINDING_KEY } from '../../common/vectorGraphBinding.js';
import { chooseDocumentWorkProject, readDocumentBinding, VectorGraphDocumentContext } from '../../browser/vectorGraphDocumentContext.js';

suite('VectorGraph work projects without local folders', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const binding: IVectorGraphBinding = {
		workspace: { id: 'bf275fab-fe03-44c3-b993-ced522c45a07', name: 'Workspace' },
		team: { id: '658d2b51-5118-46d4-8b60-bf1954501284', name: 'Team', identifier: 'TEAM' },
		project: { id: '7ac5c487-8d85-40e3-8a51-ab251bccc871', name: 'Research' }
	};
	function fixture() {
		const storage = store.add(new TestStorageService());
		const account = store.add(new Emitter<void>());
		const changedProject = store.add(new Emitter<URI | undefined>());
		let localProject: URI | undefined;
		const calls: string[] = [];
		const projects = {
			getActiveProjectUri: () => localProject,
			onDidChangeActiveProject: changedProject.event
		} as unknown as IVectorCodeWorkbenchService;
		const graph = {
			onDidChangeSession: account.event,
			listWorkspaces: async () => { calls.push('workspaces'); return [binding.workspace]; },
			listTeams: async (workspace: string) => { strictEqual(workspace, binding.workspace.id); calls.push('teams'); return [binding.team]; },
			listProjects: async (workspace: string, team: string) => { strictEqual(workspace, binding.workspace.id); strictEqual(team, binding.team.id); calls.push('projects'); return [binding.project!]; }
		} as unknown as IVectorGraphService;
		const quick = { pick: async (items: unknown[]) => items[0] } as unknown as IQuickInputService;
		return { storage, account, changedProject, projects, graph, calls, quick, setLocal: (uri: URI | undefined) => { localProject = uri; changedProject.fire(uri); } };
	}

	test('selects an authorized project with no filesystem or repository service and restores its selection', async () => {
		const f = fixture();
		const selection = store.add(new VectorGraphDocumentContext(f.storage, f.projects, f.graph));
		strictEqual(selection.localProject, undefined);
		deepStrictEqual(await chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => selection.isCurrent()), binding);
		deepStrictEqual(f.calls, ['workspaces', 'teams', 'projects']);
		const restored = store.add(new VectorGraphDocumentContext(f.storage, f.projects, f.graph));
		deepStrictEqual(restored.binding, binding);
		strictEqual(restored.isCurrent(), true);
		// Workspace-scoped presentation state does not create a local-folder binding.
		strictEqual(readDocumentBinding(f.storage, 'file:///unrelated'), undefined);
	});

	for (const canceledStep of [0, 1, 2]) {
		test(`canceling picker ${canceledStep + 1} retains the previously selected project`, async () => {
			const f = fixture();
			await chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => true);
			let step = 0;
			const quick = { pick: async (items: unknown[]) => step++ === canceledStep ? undefined : items[0] } as unknown as IQuickInputService;
			strictEqual(await chooseDocumentWorkProject(f.graph, quick, f.storage, () => true), undefined);
			deepStrictEqual(readDocumentBinding(f.storage, undefined), binding);
		});
	}

	test('permission failure preserves the selected project and propagates an actionable error', async () => {
		const f = fixture();
		await chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => true);
		f.graph.listProjects = async () => { throw new Error('Missing scope: planning:read'); };
		await rejects(chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => true), /planning:read/);
		deepStrictEqual(readDocumentBinding(f.storage, undefined), binding);
	});

	test('account changes during selection stop further reads and do not persist context', async () => {
		const f = fixture();
		const selection = store.add(new VectorGraphDocumentContext(f.storage, f.projects, f.graph));
		const quick = { pick: async (items: unknown[]) => { f.account.fire(); return items[0]; } } as unknown as IQuickInputService;
		strictEqual(await chooseDocumentWorkProject(f.graph, quick, f.storage, () => selection.isCurrent()), undefined);
		deepStrictEqual(f.calls, ['workspaces']);
		strictEqual(readDocumentBinding(f.storage, undefined), undefined);
	});

	test('switching away and back invalidates pending document actions', () => {
		const f = fixture();
		const selection = store.add(new VectorGraphDocumentContext(f.storage, f.projects, f.graph));
		f.setLocal(URI.file('/local')); f.setLocal(undefined);
		strictEqual(selection.isCurrent(), false);
	});

	test('local bindings take precedence without inheriting an unrelated work project', async () => {
		const f = fixture();
		await chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => true);
		const local = URI.file('/local'); f.setLocal(local);
		strictEqual(readDocumentBinding(f.storage, local.toString()), undefined);
		const localBinding = { ...binding, project: { ...binding.project!, name: 'Local development' } };
		f.storage.store(VECTOR_GRAPH_BINDING_KEY + local.toString(), localBinding, StorageScope.PROFILE, StorageTarget.MACHINE);
		const selection = store.add(new VectorGraphDocumentContext(f.storage, f.projects, f.graph));
		deepStrictEqual(selection.binding, localBinding);
		f.storage.remove(VECTOR_GRAPH_BINDING_KEY + local.toString(), StorageScope.PROFILE);
		f.storage.store(VECTOR_GRAPH_BINDING_KEY + local.toString(), localBinding, StorageScope.PROFILE, StorageTarget.MACHINE);
		strictEqual(selection.isCurrent(), false);
	});

	test('empty and unauthenticated selections never persist a fabricated project', async () => {
		const f = fixture();
		f.graph.listWorkspaces = async () => [];
		await rejects(chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => true), /Sign in/);
		f.graph.listWorkspaces = async () => [binding.workspace];
		f.graph.listProjects = async () => [];
		await rejects(chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => true), /No projects/);
		strictEqual(readDocumentBinding(f.storage, undefined), undefined);
	});
	test('the registered New Document action creates and opens in the selected project without a folder', async () => {
		const f = fixture();
		await chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => true);
		const document = { id: binding.team.id, title: 'Brief', body: '', teamId: binding.team.id, projectIds: [binding.project!.id], revisionNumber: 1, versionNumber: 1, updatedAt: '2026-09-12T19:00:00.000Z' };
		let created = 0; let opened = 0;
		f.graph.createDocument = async (workspace, team, project, title, key) => {
			deepStrictEqual([workspace, team, project, title], [binding.workspace.id, binding.team.id, binding.project!.id, 'Brief']);
			strictEqual(key.length, 36); created++; return document;
		};
		const inst = store.add(new TestInstantiationService());
		inst.stub(IVectorCodeWorkbenchService, f.projects); inst.stub(IStorageService, f.storage); inst.stub(IVectorGraphService, f.graph);
		inst.stub(IQuickInputService, { input: async () => 'Brief' });
		inst.stub(IEditorService, { openEditor: async input => { strictEqual(isResourceEditorInput(input) ? input.resource.authority : undefined, binding.workspace.id); opened++; return undefined; } });
		await inst.invokeFunction(accessor => CommandsRegistry.getCommand('vectorCode.newDocument')!.handler(accessor));
		strictEqual(created, 1); strictEqual(opened, 1);
	});

	test('the registered New Document action does not write after sign-out during title entry', async () => {
		const f = fixture();
		await chooseDocumentWorkProject(f.graph, f.quick, f.storage, () => true);
		f.graph.createDocument = async () => { throw new Error('Must not write'); };
		const inst = store.add(new TestInstantiationService());
		inst.stub(IVectorCodeWorkbenchService, f.projects); inst.stub(IStorageService, f.storage); inst.stub(IVectorGraphService, f.graph);
		inst.stub(IQuickInputService, { input: async () => { f.account.fire(); return 'Brief'; } });
		inst.stub(IEditorService, { openEditor: async () => { throw new Error('Must not open'); } });
		await inst.invokeFunction(accessor => CommandsRegistry.getCommand('vectorCode.newDocument')!.handler(accessor));
	});

	test('multiple folders can resolve to the same work project and document identity', async () => {
		const f = fixture();
		const folders = [URI.file('/research'), URI.file('/assets')];
		for (const folder of folders) {
			f.storage.store(VECTOR_GRAPH_BINDING_KEY + folder.toString(), binding, StorageScope.PROFILE, StorageTarget.MACHINE);
			f.setLocal(folder);
			const selection = store.add(new VectorGraphDocumentContext(f.storage, f.projects, f.graph));
			deepStrictEqual(selection.binding, binding);
			strictEqual(selection.binding!.project!.id, binding.project!.id);
		}
		// Selecting one folder does not remove the other folder's association.
		deepStrictEqual(readDocumentBinding(f.storage, folders[0].toString()), readDocumentBinding(f.storage, folders[1].toString()));
	});

});
