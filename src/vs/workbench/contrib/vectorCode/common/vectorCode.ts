/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { type IVectorCodeMobileRemoteEnvelope, type IVectorCodeMobileRemoteWorkspaceSnapshot, VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION } from './vectorCodeMobileProtocol.js';

export const VECTOR_CODE_VIEW_CONTAINER_ID = 'workbench.view.vectorCode';
export const VECTOR_CODE_CONTROL_VIEW_ID = 'workbench.views.vectorCode.control';
export const VECTOR_CODE_PROJECTS_VIEW_ID = 'workbench.views.vectorCode.projects';
export const VECTOR_CODE_CODEX_VIEW_CONTAINER_ID = 'workbench.view.vectorCodeCodex';
export const VECTOR_CODE_CODEX_VIEW_ID = 'workbench.views.vectorCode.codex';

export const VECTOR_CODE_OPEN_CONTROL_COMMAND_ID = 'vectorCode.openControl';
export const VECTOR_CODE_ADD_PROJECT_COMMAND_ID = 'vectorCode.addProjectToWorkspace';
export const VECTOR_CODE_CONNECT_MOBILE_COMMAND_ID = 'vectorCode.connectMobileApp';
export const VECTOR_CODE_OPEN_CODEX_COMMAND_ID = 'vectorCode.openCodex';
export const VECTOR_CODE_OPEN_CODEX_TERMINAL_COMMAND_ID = 'vectorCode.openCodexTerminal';
export const VECTOR_CODE_OPEN_ADMIN_TERMINAL_COMMAND_ID = 'vectorCode.openAdminTerminalWindow';

export const enum VectorCodeCodexConnectionState {
	Idle = 'idle',
	Starting = 'starting',
	Retrying = 'retrying',
	Ready = 'ready',
	Error = 'error'
}

export type VectorCodeCodexMessageRole = 'user' | 'assistant' | 'reasoning' | 'activity' | 'error';

export interface IVectorCodeCodexMessage {
	readonly id: string;
	readonly role: VectorCodeCodexMessageRole;
	readonly title: string;
	readonly text: string;
	readonly status?: string;
}

export interface IVectorCodeCodexThread {
	readonly id: string;
	readonly title: string;
	readonly updatedAt: number;
	readonly status: string;
}

export interface IVectorCodeCodexModel {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly reasoningEfforts: readonly string[];
	readonly defaultReasoningEffort?: string;
}

export interface IVectorCodeCodexState {
	readonly connectionState: VectorCodeCodexConnectionState;
	readonly detail: string;
	readonly accountLabel?: string;
	readonly requiresAuthentication: boolean;
	readonly activeProjectName?: string;
	readonly activeProjectPath?: string;
	readonly threads: readonly IVectorCodeCodexThread[];
	readonly activeThreadId?: string;
	readonly messages: readonly IVectorCodeCodexMessage[];
	readonly turnInProgress: boolean;
	readonly models: readonly IVectorCodeCodexModel[];
	readonly selectedModel?: string;
	readonly selectedReasoningEffort?: string;
	readonly installedPluginCount: number;
}

export const IVectorCodeCodexService = createDecorator<IVectorCodeCodexService>('vectorCodeCodexService');

export interface IVectorCodeCodexService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<IVectorCodeCodexState>;

	getState(): IVectorCodeCodexState;
	ensureReady(): Promise<void>;
	refreshThreads(): Promise<void>;
	createThread(): Promise<void>;
	selectThread(threadId: string): Promise<void>;
	sendMessage(text: string): Promise<void>;
	interruptTurn(): Promise<void>;
	forkActiveThread(): Promise<void>;
	archiveActiveThread(): Promise<void>;
	managePlugins(): Promise<void>;
	selectModel(model: string, reasoningEffort?: string): void;
}

export interface IVectorCodeProjectSummary {
	readonly name: string;
	readonly uri: URI;
	readonly uriLabel: string;
}

export const enum VectorCodeMobileConnectionState {
	Unconfigured = 'unconfigured',
	Disconnected = 'disconnected',
	Pairing = 'pairing',
	Connected = 'connected'
}

export interface IVectorCodeMobilePairingPayload {
	readonly protocolVersion: typeof VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION;
	readonly desktopId: string;
	readonly pairingId: string;
	readonly desktopPublicKey: string;
	readonly desktopPublicKeyFingerprint: string;
	readonly pairingToken: string;
	readonly relayHost: string;
	readonly userId?: string;
	readonly relayToken?: string;
	readonly relayTokenExpiresAt?: string;
	readonly expiresAt: string;
}

export interface IVectorCodeMobilePairingSession {
	readonly payload: IVectorCodeMobilePairingPayload;
	readonly payloadJson: string;
	readonly pairingCode: string;
	readonly qrDataUrl: string;
}

export interface IVectorCodeMobileConnectionStatus {
	readonly state: VectorCodeMobileConnectionState;
	readonly label: string;
	readonly detail: string;
	readonly relayHost?: string;
	readonly pairing?: IVectorCodeMobilePairingSession;
}

export const IVectorCodeMobileRelayService = createDecorator<IVectorCodeMobileRelayService>('vectorCodeMobileRelayService');

export interface IVectorCodeMobileRelayService {
	readonly _serviceBrand: undefined;

	getStatus(): IVectorCodeMobileConnectionStatus;
	startPairing(relayHost?: string, relayIssuerToken?: string): Promise<IVectorCodeMobileConnectionStatus>;
	registerRequestHandler(handler: IVectorCodeMobileRemoteRequestHandler): IDisposable;
}

export interface IVectorCodeMobileRemoteRequestHandler {
	handleVectorCodeMobileRemoteRequest(envelope: IVectorCodeMobileRemoteEnvelope): Promise<IVectorCodeMobileRemoteEnvelope>;
}

export const IVectorCodeWorkbenchService = createDecorator<IVectorCodeWorkbenchService>('vectorCodeWorkbenchService');

export interface IVectorCodeWorkbenchService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeActiveProject: Event<URI | undefined>;

	getProjectStatusLabel(): string;
	getProjectSummaries(): readonly IVectorCodeProjectSummary[];
	getActiveProjectUri(): URI | undefined;
	getMobileWorkspaceSnapshot(): IVectorCodeMobileRemoteWorkspaceSnapshot;
	isProjectSwitching(): boolean;
	switchProject(projectUri: URI | undefined): Promise<void>;
	addProjectToWorkspace(): Promise<void>;
	closeProject(projectUri: URI): Promise<void>;
	connectMobileApp(): Promise<void>;
	openCodexTerminal(): Promise<void>;
	toggleActiveProjectTerminalPanel(): Promise<void>;
}
