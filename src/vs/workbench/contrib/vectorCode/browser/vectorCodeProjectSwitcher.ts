/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, isHTMLElement } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IVectorCodeProjectSummary } from '../common/vectorCode.js';

interface IProjectActions {
	add(): Promise<unknown>;
	select(project: IVectorCodeProjectSummary): Promise<unknown>;
	close(project: IVectorCodeProjectSummary): Promise<unknown>;
	onError(message: string): void;
}

interface IProjectRow {
	project: IVectorCodeProjectSummary;
	readonly element: HTMLElement;
	readonly select: HTMLButtonElement;
	readonly close: HTMLButtonElement;
	readonly name: HTMLElement;
	readonly path: HTMLElement;
	readonly disposables: DisposableStore;
}

/** Keeps project controls stable across service updates so keyboard focus survives. */
export class VectorCodeProjectSwitcher extends Disposable {
	private readonly status: HTMLElement;
	private readonly list: HTMLElement;
	private readonly empty: HTMLElement;
	private readonly addButton: HTMLButtonElement;
	private readonly rows = new Map<string, IProjectRow>();
	private lastSelection: HTMLButtonElement | undefined;

	constructor(container: HTMLElement, private readonly actions: IProjectActions) {
		super();
		const root = append(container, $('.vector-code-project-switcher'));
		const header = append(root, $('.vector-code-project-switcher__header'));
		this.status = append(header, $('.vector-code-project-switcher__status'));
		this.addButton = this.createIconButton(header, localize('vectorCodeAddProject', 'Add Project'), Codicon.add);
		this.registerAction(this.addButton, () => actions.add(), this._store);
		this.list = append(root, $('.vector-code-project-switcher__list'));
		this.empty = append(this.list, $('.vector-code-project-switcher__empty'));
		this.empty.textContent = localize('vectorCodeProjectsListEmpty', 'Add a project to populate the file tree.');
	}

	update(projects: readonly IVectorCodeProjectSummary[], activeProject: URI | undefined, status: string): void {
		this.status.textContent = status;
		const focusedElement = this.list.ownerDocument.activeElement;
		const focusedRowIndex = [...this.list.children].filter(element => element !== this.empty).findIndex(element => element.contains(focusedElement));
		const keys = new Set(projects.map(project => project.uri.toString()));
		let removedFocusedRow = false;
		for (const [key, row] of this.rows) {
			if (!keys.has(key)) {
				removedFocusedRow ||= row.element.contains(focusedElement);
				row.disposables.dispose();
				row.element.remove();
				this.rows.delete(key);
			}
		}
		this.empty.hidden = projects.length > 0;
		let previous: HTMLElement = this.empty;
		for (const project of projects) {
			const key = project.uri.toString();
			let row = this.rows.get(key);
			if (!row) {
				row = this.createRow(project);
				this.rows.set(key, row);
			}
			row.project = project;
			row.name.textContent = project.name;
			row.path.textContent = project.uriLabel;
			row.path.title = project.uriLabel;
			row.element.title = `${project.name}\n${project.uriLabel}`;
			row.select.setAttribute('aria-label', localize('vectorCodeSelectProject', 'Select {0}', project.name));
			const closeLabel = localize('vectorCodeCloseProject', 'Close {0}', project.name);
			row.close.setAttribute('aria-label', closeLabel);
			row.close.title = closeLabel;
			const active = key === activeProject?.toString();
			row.element.classList.toggle('vector-code-project-switcher__project--active', active);
			row.select.setAttribute('aria-pressed', String(active));
			// Moving an already correctly placed node also drops focus in Chromium.
			if (previous.nextElementSibling !== row.element) {
				previous.after(row.element);
			}
			previous = row.element;
		}
		if (removedFocusedRow) {
			const next = projects[Math.min(focusedRowIndex, projects.length - 1)];
			(next ? this.rows.get(next.uri.toString())!.select : this.addButton).focus();
		} else if (isHTMLElement(focusedElement) && this.list.contains(focusedElement)) {
			// Preserve the same control if a workspace reorder moved its row.
			if (this.list.ownerDocument.activeElement !== focusedElement) {
				focusedElement.focus();
			}
		}
	}

	private createRow(project: IVectorCodeProjectSummary): IProjectRow {
		const element = $('.vector-code-project-switcher__project');
		const select = append(element, $<HTMLButtonElement>('button.vector-code-project-switcher__project-select'));
		select.type = 'button';
		const name = append(select, $('.vector-code-project-switcher__project-name'));
		const path = append(select, $('.vector-code-project-switcher__project-path'));
		const close = this.createIconButton(element, '', Codicon.close);
		close.classList.add('vector-code-project-switcher__project-close');
		const row: IProjectRow = { project, element, select, close, name, path, disposables: new DisposableStore() };
		this.registerAction(select, () => this.actions.select(row.project), row.disposables, true);
		this.registerAction(close, () => this.actions.close(row.project), row.disposables);
		return row;
	}

	private createIconButton(container: HTMLElement, label: string, icon: ThemeIcon): HTMLButtonElement {
		const button = append(container, $<HTMLButtonElement>('button.vector-code-project-switcher__icon-button'));
		button.type = 'button';
		button.title = label;
		button.setAttribute('aria-label', label);
		append(button, $('.vector-code-project-switcher__icon')).classList.add(...ThemeIcon.asClassNameArray(icon));
		return button;
	}

	private registerAction(button: HTMLButtonElement, action: () => Promise<unknown>, disposables: DisposableStore, selection = false): void {
		let pending = 0;
		disposables.add(addDisposableListener(button, EventType.CLICK, async event => {
			event.stopPropagation();
			if (pending && (!selection || this.lastSelection === button)) {
				return;
			}
			pending++;
			if (selection) {
				// A -> B -> A is a new choice even while the first A is pending.
				this.lastSelection = button;
			} else {
				button.setAttribute('aria-disabled', 'true');
			}
			button.setAttribute('aria-busy', 'true');
			try {
				await action();
			} catch (error) {
				if (!disposables.isDisposed && !this._store.isDisposed) {
					this.actions.onError(localize('vectorCodeProjectActionFailed', 'Unable to complete the project action. Try again. {0}', toErrorMessage(error)));
				}
			} finally {
				if (--pending === 0) {
					button.removeAttribute('aria-disabled');
					button.removeAttribute('aria-busy');
					if (this.lastSelection === button) {
						this.lastSelection = undefined;
					}
				}
			}
		}));
	}

	override dispose(): void {
		for (const row of this.rows.values()) {
			row.disposables.dispose();
		}
		this.rows.clear();
		super.dispose();
	}
}
