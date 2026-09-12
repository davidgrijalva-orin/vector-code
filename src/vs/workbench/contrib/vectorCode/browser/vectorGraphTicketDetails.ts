/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { $, append, clearNode, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IVectorGraphService, IVectorGraphTicketDetail } from '../../../../platform/vectorGraph/common/vectorGraph.js';
import { IVectorGraphIssuePatch } from '../../../../platform/vectorGraph/common/vectorGraphWork.js';
import { IVectorCodeWorkbenchService } from '../common/vectorCode.js';
import { IVectorGraphSelection, IVectorGraphWorkService } from '../common/vectorGraphWork.js';
import { renderVectorGraphMarkdown } from './vectorGraphMarkdown.js';

type Draft = IVectorGraphIssuePatch & { title: string; description: string; baseUpdatedAt?: string };
/** The pane and editor share rendering, drafts, retry identity, and mutation behavior. */
export class VectorGraphTicketDetails extends Disposable {
	private readonly content = this._register(new DisposableStore());
	private generation = 0;
	private controls: (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement)[] = [];
	private selection: IVectorGraphSelection | undefined;
	private editing = false;
	private busy = false;
	private status!: HTMLElement;
	constructor(readonly root: HTMLElement,
		@IVectorGraphService private readonly graph: IVectorGraphService,
		@IMarkdownRendererService private readonly markdown: IMarkdownRendererService,
		@IOpenerService private readonly opener: IOpenerService,
		@IStorageService private readonly storage: IStorageService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@IVectorGraphWorkService private readonly work: IVectorGraphWorkService,
		@IVectorCodeWorkbenchService private readonly projects: IVectorCodeWorkbenchService,
		@ICommandService private readonly commands: ICommandService,
		@IWorkspaceTrustManagementService private readonly trust: IWorkspaceTrustManagementService,
	) {
		super();
		this._register(graph.onDidChangeSession(() => { this.editing = false; void this.show(this.selection); }));
		this._register(graph.onDidChangeTickets(event => {
			if (!this.busy && !this.editing && this.selection?.workspace === event.workspace && this.selection.identifier === event.identifier) { void this.show(this.selection); }
		}));
	}
	async show(selection: IVectorGraphSelection | undefined): Promise<void> {
		const generation = ++this.generation;
		this.selection = selection; this.editing = false;
		this.content.clear(); this.controls = []; clearNode(this.root);
		this.status = append(this.root, $('p')); this.status.setAttribute('role', 'status');
		if (!selection) { this.status.textContent = localize('workSelectATicketInWorkToSeeItsDetailsBesideYourCode', 'Select a ticket in Work to see its details beside your code.'); return; }
		this.status.textContent = selection.identifier ? localize('workLoading', 'Loading {0}…', selection.identifier) : localize('workNewTicket', 'New ticket');
		try {
			if (!selection.identifier) { await this.edit(selection, undefined); return; }
			const ticket = await this.graph.getTicket(selection.workspace, selection.identifier);
			if (generation !== this.generation || this._store.isDisposed) { return; }
			this.status.textContent = '';
			const article = append(this.root, $('article.vector-graph-ticket-editor__article'));
			const actions = append(article, $('.vector-graph-ticket-editor__toolbar'));
			append(actions, $('strong')).textContent = ticket.identifier;
			this.button(actions, localize('workRefresh', 'Refresh'), () => this.show(selection));
			this.button(actions, localize('workEditTicket', 'Edit Ticket'), () => this.edit(selection, ticket));
			append(article, $('h1')).textContent = ticket.title;
			append(article, $('p')).textContent = [ticket.status, ticket.priority, ticket.project].filter(Boolean).join(' · ');
			const active = this.work.getActive(selection.project);
			if (selection.project && selection.project === this.projects.getActiveProjectUri()?.toString()) {
				this.button(actions, active?.workspace === selection.workspace && active.identifier === ticket.identifier ? localize('workStopWork', 'Stop Work') : localize('workStartWork', 'Start Work'), async () => {
					this.assertProject(selection);
					this.work.setActive(selection.project, active?.workspace === selection.workspace && active.identifier === ticket.identifier ? undefined : { workspace: selection.workspace, identifier: ticket.identifier });
					await this.show(selection);
				});
				if (active?.workspace === selection.workspace && active.identifier === ticket.identifier) { await this.development(article, selection, generation); }
			}
			if (generation !== this.generation || this._store.isDisposed) { return; }
			append(article, $('h2')).textContent = localize('workDescription', 'Description'); this.renderMarkdown(article, ticket.description || localize('workNoDescriptionProvided', 'No description provided.'));
			if (ticket.links?.length) {
				append(article, $('h2')).textContent = localize('workLinkedWork', 'Linked work');
				for (const link of ticket.links) { if (/^https:\/\//i.test(link.url)) { this.button(article, link.title, async () => { await this.opener.open(link.url, { allowCommands: false, allowContributedOpeners: false, fromUserGesture: true }); }); } }
			}
			append(article, $('h2')).textContent = localize('workActivity', 'Activity');
			for (const comment of ticket.comments) { const section = append(article, $('section')); append(section, $('h3')).textContent = comment.author; this.renderMarkdown(section, comment.body); }
			const commentKey = this.key(selection, 'comment');
			const comment = this.textarea(article, localize('workAddAComment', 'Add a comment'), this.storage.get(commentKey, StorageScope.PROFILE, ''));
			this.content.add(addDisposableListener(comment, EventType.INPUT, () => this.storage.store(commentKey, comment.value, StorageScope.PROFILE, StorageTarget.MACHINE)));
			this.button(article, localize('workPostComment', 'Post Comment'), () => this.mutate(selection, 'comment', { body: comment.value }, async key => {
				await this.graph.addComment(selection.workspace, ticket.identifier, comment.value, key);
				this.storage.remove(commentKey, StorageScope.PROFILE);
			}));
		} catch (error) { if (generation === this.generation && !this._store.isDisposed) { this.status.textContent = toErrorMessage(error); } }
	}
	private async edit(selection: IVectorGraphSelection, ticket: IVectorGraphTicketDetail | undefined): Promise<void> {
		const generation = this.generation;
		const team = ticket?.teamId ?? selection.binding?.team.id;
		if (!team || (!ticket && !selection.binding?.project)) { throw new Error(localize('workChooseAVectorgraphProjectInWorkBeforeCreatingATicket', 'Choose a VectorGraph project in Work before creating a ticket.')); }
		const metadata = await this.graph.getTeamMetadata(selection.workspace, team);
		if (generation !== this.generation || this._store.isDisposed) { return; }
		this.editing = true; this.content.clear(); this.controls = []; clearNode(this.root);
		this.status = append(this.root, $('p')); this.status.setAttribute('role', 'status');
		append(this.root, $('h2')).textContent = ticket ? localize('workEditTicketTitle', 'Edit {0}', ticket.identifier) : localize('workNewTicketTitle', 'New ticket · {0}', selection.binding!.project!.name);
		const key = this.key(selection, 'draft');
		const draft = this.storage.getObject<Draft>(key, StorageScope.PROFILE) ?? { title: ticket?.title ?? '', description: ticket?.description ?? '', statusId: ticket?.statusId ?? metadata.statuses.find(status => status.category === 'unstarted')?.id, priority: ticket?.priority ?? 'no_priority', assigneeUserId: ticket?.assigneeUserId ?? null, baseUpdatedAt: ticket?.updatedAt };
		const title = this.input(this.root, localize('workTitle', 'Title'), draft.title);
		const description = this.textarea(this.root, localize('workDescription', 'Description'), draft.description);
		const status = this.select(this.root, localize('workStatus', 'Status'), metadata.statuses.map(value => [value.id, value.name]), draft.statusId ?? '');
		const priority = this.select(this.root, localize('workPriority', 'Priority'), ['no_priority', 'low', 'medium', 'high', 'urgent'].map(value => [value, value.replace('_', ' ')]), draft.priority ?? 'no_priority');
		const assignee = this.select(this.root, localize('workAssignee', 'Assignee'), [['', localize('workUnassigned', 'Unassigned')], ...metadata.members.map(value => [value.id, value.name])], draft.assigneeUserId ?? '');
		const read = (): Draft => ({ title: title.value, description: description.value, statusId: status.value || undefined, priority: priority.value, assigneeUserId: assignee.value || null, baseUpdatedAt: draft.baseUpdatedAt });
		for (const element of [title, description, status, priority, assignee]) { this.content.add(addDisposableListener(element, EventType.INPUT, () => this.storage.store(key, read(), StorageScope.PROFILE, StorageTarget.MACHINE))); }
		this.button(this.root, ticket ? localize('workSaveChanges', 'Save Changes') : localize('workCreateTicket', 'Create Ticket'), async () => {
			const { baseUpdatedAt, ...patch } = read();
			this.storage.store(key, read(), StorageScope.PROFILE, StorageTarget.MACHINE);
			await this.mutate(selection, 'save', patch, async (requestId, dispatched, markDispatched) => {
				if (ticket) {
					const latest = !dispatched && baseUpdatedAt ? await this.graph.getTicket(selection.workspace, ticket.identifier) : undefined;
					if (latest && baseUpdatedAt && latest.updatedAt !== baseUpdatedAt) { throw new Error(localize('workThisTicketChangedOnVectorgraphYourDraftIsPreservedReviewTheLatestTicke', 'This ticket changed on VectorGraph. Your draft is preserved. Review the latest ticket before saving.')); }
					markDispatched();
					await this.graph.updateTicket(selection.workspace, ticket.identifier, patch, requestId);
				} else {
					this.assertProject(selection);
					const identifier = await this.graph.createTicket(selection.workspace, { ...patch, title: patch.title!, teamId: team, projectId: selection.binding!.project!.id }, requestId);
					if (generation === this.generation) { this.selection = { ...selection, identifier }; this.work.select(this.selection); }
				}
				this.storage.remove(key, StorageScope.PROFILE);
			});
		});
		this.button(this.root, localize('workBackKeepDraft', 'Back (Keep Draft)'), () => this.show(ticket ? selection : undefined));
		this.button(this.root, localize('workDiscardDraft', 'Discard Draft'), async () => { this.storage.remove(key, StorageScope.PROFILE); await this.show(ticket ? selection : undefined); });
	}
	private async mutate(selection: IVectorGraphSelection, operation: string, payload: object, action: (key: string, dispatched: boolean, markDispatched: () => void) => Promise<void>): Promise<void> {
		if (this.busy) { return; }
		const generation = this.generation;
		const key = this.key(selection, 'request.' + operation);
		const serialized = JSON.stringify(payload);
		const saved = this.storage.getObject<{ payload: string; id: string; dispatched?: boolean }>(key, StorageScope.PROFILE);
		const request = saved?.payload === serialized ? saved : { payload: serialized, id: generateUuid() };
		this.storage.store(key, request, StorageScope.PROFILE, StorageTarget.MACHINE);
		this.busy = true; this.status.textContent = localize('workSaving', 'Saving…');
		this.controls.forEach(element => element.disabled = true);
		try {
			await action(request.id, !!request.dispatched, () => { this.storage.store(key, { ...request, dispatched: true }, StorageScope.PROFILE, StorageTarget.MACHINE); }); this.storage.remove(key, StorageScope.PROFILE);
			if (generation === this.generation && !this._store.isDisposed) { this.editing = false; await this.show(this.selection); }
		} catch (error) {
			if (generation === this.generation && !this._store.isDisposed) { this.status.textContent = toErrorMessage(error) + ' ' + localize('workRetryDraft', 'Your draft is preserved; retry uses the same request ID.'); }
		} finally { this.busy = false; if (generation === this.generation && !this._store.isDisposed) { this.controls.forEach(element => element.disabled = false); } }
	}
	private assertProject(selection: IVectorGraphSelection): void { if (!selection.project || selection.project !== this.projects.getActiveProjectUri()?.toString()) { throw new Error(localize('workTheActiveProjectChangedOpenThisTicketFromWorkAgain', 'The active project changed. Open this ticket from Work again.')); } }
	private async development(parent: HTMLElement, selection: IVectorGraphSelection, generation: number): Promise<void> {
		const section = append(parent, $('section.vector-graph-development'));
		append(section, $('h2')).textContent = localize('workActiveWork', 'Active work');
		try {
			const state = await this.graph.getRepositoryState(selection.project);
			if (generation !== this.generation || this._store.isDisposed) { return; }
			append(section, $('p')).textContent = localize('workTreeChanges', '{0} · {1} changed files', state.branch, state.changes.length);
			const linked = this.work.getActive(selection.project)?.branch;
			if (linked && linked !== state.branch) { append(section, $('p')).textContent = localize('workBranchDiffers', 'Ticket branch: {0}. Current branch differs.', linked); }
			const list = append(section, $('ul')); for (const change of state.changes) { append(list, $('li')).textContent = change; }
			this.button(section, localize('workOpenChanges', 'Open Changes'), async () => { this.assertProject(selection); await this.commands.executeCommand('workbench.view.scm'); });
			this.button(section, localize('workUseCurrentBranch', 'Use Current Branch'), async () => {
				this.assertProject(selection);
				const current = await this.graph.getRepositoryState(selection.project);
				if (generation !== this.generation || this._store.isDisposed) { return; }
				this.assertProject(selection);
				this.work.setActive(selection.project, { workspace: selection.workspace, identifier: selection.identifier!, branch: current.branch }); await this.show(selection);
			});
			this.button(section, localize('workCreateTicketBranch', 'Create Ticket Branch'), async () => {
				const branch = await this.quickInput.input({ title: localize('workCreateAndSwitchToANewTicketBranch', 'Create and switch to a new ticket branch'), value: 'codex/' + selection.identifier!.toLowerCase(), prompt: localize('workRequiresACleanWorkingTreeExistingBranchesAreNotOverwritten', 'Requires a clean working tree. Existing branches are not overwritten.') });
				if (!branch || generation !== this.generation || this._store.isDisposed) { return; } this.assertProject(selection);
				if (!this.trust.isWorkspaceTrusted()) { throw new Error(localize('workTrustThisWorkspaceBeforeCreatingABranch', 'Trust this workspace before creating a branch.')); }
				await this.graph.createBranch(selection.project, branch, state.head);
				this.work.setActive(selection.project, { workspace: selection.workspace, identifier: selection.identifier!, branch });
				if (generation === this.generation && !this._store.isDisposed) { await this.show(selection); }
			});
			this.button(section, localize('workLinkPullRequest', 'Link Pull Request'), async () => {
				const url = await this.quickInput.input({ title: localize('workLinkPrTitle', 'Link a pull request to {0}', selection.identifier), prompt: localize('workPasteAGithubPullRequestUrlFromThisRepository', 'Paste a GitHub pull request URL from this repository.') });
				if (!url || generation !== this.generation || this._store.isDisposed) { return; } this.assertProject(selection);
				await this.mutate(selection, 'pullRequest', { url }, requestId => this.graph.linkPullRequest(selection.workspace, selection.identifier!, selection.project, url, requestId));
			});
		} catch (error) { append(section, $('p')).textContent = toErrorMessage(error); }
	}
	private key(selection: IVectorGraphSelection, suffix: string): string { return 'vectorGraph.' + suffix + '.' + selection.workspace + '.' + (selection.identifier ?? 'new.' + selection.project + '.' + selection.binding?.project?.id); }
	private button(parent: HTMLElement, label: string, run: () => Promise<unknown>): void { const button = append(parent, $<HTMLButtonElement>('button')); this.controls.push(button); button.type = 'button'; button.textContent = label; this.content.add(addDisposableListener(button, EventType.CLICK, () => { if (!this.busy) { void run().catch(error => this.notifications.error(toErrorMessage(error))); } })); }
	private input(parent: HTMLElement, label: string, value: string): HTMLInputElement { const wrapper = append(parent, $('label')); wrapper.textContent = label; const input = append(wrapper, $<HTMLInputElement>('input')); this.controls.push(input); input.value = value; input.setAttribute('aria-label', label); return input; }
	private textarea(parent: HTMLElement, label: string, value: string): HTMLTextAreaElement { const wrapper = append(parent, $('label')); wrapper.textContent = label; const input = append(wrapper, $<HTMLTextAreaElement>('textarea')); this.controls.push(input); input.value = value; input.setAttribute('aria-label', label); input.rows = 8; return input; }
	private select(parent: HTMLElement, label: string, values: string[][], selected: string): HTMLSelectElement { const wrapper = append(parent, $('label')); wrapper.textContent = label; const select = append(wrapper, $<HTMLSelectElement>('select')); this.controls.push(select); select.setAttribute('aria-label', label); for (const [value, title] of values) { const option = append(select, $<HTMLOptionElement>('option')); option.value = value; option.textContent = title; } if (selected && !values.some(([value]) => value === selected)) { const option = append(select, $<HTMLOptionElement>('option')); option.value = selected; option.textContent = localize('workCurrentValue', 'Current value'); } select.value = selected; return select; }
	private renderMarkdown(parent: HTMLElement, value: string): void { append(parent, this.content.add(renderVectorGraphMarkdown(this.markdown, this.opener, value)).element); }
	override dispose(): void { this.generation++; super.dispose(); }
}
