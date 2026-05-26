/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ITerminalInstance } from '../../terminal/browser/terminal.js';

export class VectorCodeMobileTerminalStateStore extends Disposable {
	private readonly projectTerminalInstances = new Map<string, ITerminalInstance[]>();
	private readonly projectActiveTerminalInstances = new Map<string, ITerminalInstance>();
	private readonly terminalProjectKeys = new Map<number, string>();
	private readonly terminalOutputLines = new Map<number, string[]>();
	private readonly terminalOutputDisposables = new Map<number, readonly { dispose(): void }[]>();

	constructor(private readonly outputMaxLines: number) {
		super();
	}

	getProjectKey(instance: ITerminalInstance): string | undefined {
		return this.terminalProjectKeys.get(instance.instanceId);
	}

	getActive(projectKey: string): ITerminalInstance | undefined {
		const instance = this.projectActiveTerminalInstances.get(projectKey);
		if (!instance || instance.isDisposed || this.getProjectKey(instance) !== projectKey) {
			return undefined;
		}
		return instance;
	}

	setActive(projectKey: string, instance: ITerminalInstance): void {
		if (!instance.isDisposed && this.getProjectKey(instance) === projectKey) {
			this.projectActiveTerminalInstances.set(projectKey, instance);
		}
	}

	getInstances(projectKey: string): ITerminalInstance[] {
		const instances = (this.projectTerminalInstances.get(projectKey) ?? [])
			.filter(instance => !instance.isDisposed && this.getProjectKey(instance) === projectKey);
		this.projectTerminalInstances.set(projectKey, instances);
		return instances;
	}

	getOutput(instance: ITerminalInstance): readonly string[] {
		return this.terminalOutputLines.get(instance.instanceId) ?? [];
	}

	clearOutput(instance: ITerminalInstance): void {
		this.terminalOutputLines.set(instance.instanceId, []);
	}

	captureProject(projectKey: string, visibleInstances: readonly ITerminalInstance[], activeInstance?: ITerminalInstance): readonly ITerminalInstance[] {
		const existingInstances = this.getInstances(projectKey);
		for (const instance of visibleInstances) {
			this.adopt(instance, projectKey);
		}

		this.projectTerminalInstances.set(projectKey, this.unique([...existingInstances, ...visibleInstances]));
		if (activeInstance && visibleInstances.includes(activeInstance)) {
			this.projectActiveTerminalInstances.set(projectKey, activeInstance);
		} else {
			this.projectActiveTerminalInstances.delete(projectKey);
		}

		return visibleInstances;
	}

	adopt(instance: ITerminalInstance, projectKey: string | undefined, forceProject = false): void {
		if (!projectKey || instance.isDisposed) {
			return;
		}
		this.ensureOutputTracking(instance);
		const existingProjectKey = this.getProjectKey(instance);
		if (existingProjectKey && (!forceProject || existingProjectKey === projectKey)) {
			return;
		}
		if (existingProjectKey && forceProject) {
			const previousInstances = this.projectTerminalInstances.get(existingProjectKey) ?? [];
			this.projectTerminalInstances.set(existingProjectKey, previousInstances.filter(candidate => candidate !== instance));
			if (this.projectActiveTerminalInstances.get(existingProjectKey) === instance) {
				this.projectActiveTerminalInstances.delete(existingProjectKey);
			}
		}

		this.terminalProjectKeys.set(instance.instanceId, projectKey);
		const instances = this.projectTerminalInstances.get(projectKey) ?? [];
		this.projectTerminalInstances.set(projectKey, this.unique([...instances, instance]));
	}

	forget(instance: ITerminalInstance): void {
		this.terminalProjectKeys.delete(instance.instanceId);
		this.terminalOutputLines.delete(instance.instanceId);
		for (const disposable of this.terminalOutputDisposables.get(instance.instanceId) ?? []) {
			disposable.dispose();
		}
		this.terminalOutputDisposables.delete(instance.instanceId);
		for (const [projectKey, instances] of this.projectTerminalInstances) {
			this.projectTerminalInstances.set(projectKey, instances.filter(candidate => candidate !== instance));
		}
		for (const [projectKey, activeInstance] of this.projectActiveTerminalInstances) {
			if (activeInstance === instance) {
				this.projectActiveTerminalInstances.delete(projectKey);
			}
		}
	}

	prune(projectKeys: ReadonlySet<string>): void {
		for (const projectKey of this.projectTerminalInstances.keys()) {
			if (!projectKeys.has(projectKey)) {
				for (const instance of this.projectTerminalInstances.get(projectKey) ?? []) {
					this.terminalProjectKeys.delete(instance.instanceId);
				}
				this.projectTerminalInstances.delete(projectKey);
			}
		}
		for (const projectKey of this.projectActiveTerminalInstances.keys()) {
			if (!projectKeys.has(projectKey)) {
				this.projectActiveTerminalInstances.delete(projectKey);
			}
		}
	}

	override dispose(): void {
		for (const disposables of this.terminalOutputDisposables.values()) {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		}
		this.terminalOutputDisposables.clear();
		this.terminalOutputLines.clear();
		this.terminalProjectKeys.clear();
		this.projectTerminalInstances.clear();
		this.projectActiveTerminalInstances.clear();
		super.dispose();
	}

	private ensureOutputTracking(instance: ITerminalInstance): void {
		if (this.terminalOutputDisposables.has(instance.instanceId)) {
			return;
		}

		this.terminalOutputLines.set(instance.instanceId, this.terminalOutputLines.get(instance.instanceId) ?? []);
		this.terminalOutputDisposables.set(instance.instanceId, [
			instance.onLineData(line => this.captureOutputLine(instance, line))
		]);
	}

	private captureOutputLine(instance: ITerminalInstance, line: string): void {
		const lines = this.terminalOutputLines.get(instance.instanceId) ?? [];
		lines.push(line);
		if (lines.length > this.outputMaxLines) {
			lines.splice(0, lines.length - this.outputMaxLines);
		}
		this.terminalOutputLines.set(instance.instanceId, lines);
	}

	private unique(instances: readonly ITerminalInstance[]): ITerminalInstance[] {
		const seen = new Set<number>();
		const uniqueInstances: ITerminalInstance[] = [];
		for (const instance of instances) {
			if (seen.has(instance.instanceId) || instance.isDisposed) {
				continue;
			}
			seen.add(instance.instanceId);
			uniqueInstances.push(instance);
		}
		return uniqueInstances;
	}
}
