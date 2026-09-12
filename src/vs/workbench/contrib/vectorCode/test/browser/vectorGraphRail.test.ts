/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { strictEqual } from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { localize2 } from '../../../../../nls.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IVectorGraphService } from '../../../../../platform/vectorGraph/common/vectorGraph.js';
import { IViewContainerModel, IViewDescriptorService, ViewContainerLocation } from '../../../../common/views.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IVectorCodeWorkbenchService } from '../../common/vectorCode.js';
import { IVectorGraphSelection, IVectorGraphWorkService } from '../../common/vectorGraphWork.js';
import { VectorGraphDetailsView } from '../../browser/vectorGraphDetails.contribution.js';
import { renderVectorGraphCanvas } from '../../browser/vectorGraphCanvas.js';

suite('VectorGraph persistent project rail', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('workspace cannot close, ticket tabs deduplicate and preserve unsent comments', async () => {
		const instantiation = workbenchInstantiationService({}, store);
		const changed = store.add(new Emitter<void>()); let selection: IVectorGraphSelection | undefined;
		const project = URI.file('/project');
		instantiation.stub(IVectorCodeWorkbenchService, { onDidChangeActiveProject: Event.None, getActiveProjectUri: () => project, getProjectSummaries: () => [] });
		instantiation.stub(IVectorGraphWorkService, { onDidChange: changed.event, get selection() { return selection; }, getActive: () => undefined });
		instantiation.stub(IVectorGraphService, { onDidChangeSession: Event.None, onDidChangeTickets: Event.None, getSession: async () => ({ workspaces: [] }), getTicket: async (_workspace: string, identifier: string) => ({ identifier, title: identifier, status: 'Todo', category: 'unstarted', priority: 'high', project: '', description: '', comments: [] }) });
		const container = { id: 'test.projectRail', title: localize2('railTest', 'Project'), ctorDescriptor: new SyncDescriptor(VectorGraphDetailsView) };
		const descriptor = { id: 'test.projectRail.view', name: localize2('railViewTest', 'Project'), ctorDescriptor: new SyncDescriptor(VectorGraphDetailsView) };
		instantiation.stub(IViewDescriptorService, { getViewLocationById: () => ViewContainerLocation.AuxiliaryBar, onDidChangeLocation: Event.None, getViewDescriptorById: () => descriptor, getViewContainerByViewId: () => container, getViewContainerModel: () => ({ onDidChangeContainerInfo: Event.None } as IViewContainerModel), getDefaultContainerById: () => container });
		const view = store.add(instantiation.createInstance(VectorGraphDetailsView, { id: descriptor.id, title: 'Project' })); view.render(); const root = view.element;
		await timeout(0);
		const select = async (identifier: string) => { selection = { identifier, workspace: 'workspace', project: project.toString() }; changed.fire(); await timeout(0); };
		await select('VC-1'); const comment = root.querySelector<HTMLTextAreaElement>('textarea')!; comment.value = 'Unsent comment';
		await select('VC-2'); await select('VC-1');
		strictEqual(root.querySelectorAll('.vector-project-rail__tabs [role="tab"]').length, 3);
		strictEqual(comment.value, 'Unsent comment'); strictEqual(comment.closest<HTMLElement>('.vector-project-rail__page')!.hidden, false);
		strictEqual(root.querySelector('[aria-label="Close Workspace"]'), null);
		root.querySelector<HTMLButtonElement>('[aria-label="Close VC-1"]')!.click();
		strictEqual(root.querySelectorAll('.vector-project-rail__tabs [role="tab"]').length, 2);
		strictEqual(root.querySelector('.vector-project-rail__tabs [aria-selected="true"]')?.textContent, 'Workspace');
	});
	test('canvas text is rendered as text, never markup', () => {
		const root = document.createElement('div');
		renderVectorGraphCanvas(root, { id: 'canvas', title: 'Canvas', projectIds: [], scene: { elements: [{ type: 'text', x: 0, y: 0, text: '<script>alert(1)</script>' }] } });
		strictEqual(root.querySelector('script'), null);
		strictEqual(root.querySelector('text')?.textContent, '<script>alert(1)</script>');
	});
});
