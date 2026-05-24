/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION = 1;

export const enum VectorCodeMobileRemoteAction {
	StateRead = 'state.read',
	FileTreeRead = 'file.tree.read',
	FileRead = 'file.read',
	FileWrite = 'file.write',
	FileMove = 'file.move',
	FileCopy = 'file.copy',
	TerminalList = 'terminal.list',
	TerminalCreate = 'terminal.create',
	TerminalInput = 'terminal.input',
	TerminalControl = 'terminal.control',
	TerminalOutput = 'terminal.output',
}

export interface IVectorCodeMobileRemoteEnvelope<TPayload = unknown> {
	readonly kind: 'request' | 'response';
	readonly protocolVersion: typeof VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION;
	readonly requestId: string;
	readonly action: VectorCodeMobileRemoteAction;
	readonly projectId?: string;
	readonly payload?: TPayload;
	readonly error?: IVectorCodeMobileRemoteError;
}

export interface IVectorCodeMobileRemoteError {
	readonly code: string;
	readonly message: string;
}

export const enum VectorCodeMobileRelayFrameDirection {
	PhoneToDesktop = 'phone_to_desktop',
	DesktopToPhone = 'desktop_to_phone'
}

export const enum VectorCodeMobileRelayFrameChannel {
	Control = 'control',
	Terminal = 'terminal',
	File = 'file',
	Audit = 'audit'
}

export interface IVectorCodeMobileRelayFrameHeader {
	readonly protocolVersion: typeof VECTOR_CODE_MOBILE_REMOTE_PROTOCOL_VERSION;
	readonly frameId: string;
	readonly desktopId: string;
	readonly phoneId: string;
	readonly sessionId?: string;
	readonly streamId: string;
	readonly channel: VectorCodeMobileRelayFrameChannel;
	readonly direction: VectorCodeMobileRelayFrameDirection;
	readonly seq: number;
	readonly issuedAt: string;
	readonly action: VectorCodeMobileRemoteAction;
}

export interface IVectorCodeMobileRelayEncryptedFrame {
	readonly header: IVectorCodeMobileRelayFrameHeader;
	readonly nonce: string;
	readonly ciphertext: string;
	readonly tag: string;
}

export type VectorCodeMobileRelayInboundMessage =
	| { readonly type: 'relay.ready'; readonly peer?: unknown }
	| { readonly type: 'relay.peer_online'; readonly role: 'desktop' | 'phone'; readonly desktopId: string; readonly deviceId?: string }
	| { readonly type: 'relay.peer_offline'; readonly role: 'desktop' | 'phone'; readonly desktopId: string; readonly deviceId?: string }
	| { readonly type: 'relay.frame'; readonly frame: IVectorCodeMobileRelayEncryptedFrame }
	| { readonly type: 'relay.pong'; readonly requestId?: string }
	| { readonly type: 'relay.error'; readonly code: string; readonly message: string };

export type VectorCodeMobileRelayOutboundMessage =
	| { readonly type: 'relay.frame'; readonly frame: IVectorCodeMobileRelayEncryptedFrame }
	| { readonly type: 'relay.ping'; readonly requestId?: string };

export interface IVectorCodeMobileRemoteWorkspaceSnapshot {
	readonly activeProjectId?: string;
	readonly projects: readonly IVectorCodeMobileRemoteProjectSummary[];
	readonly filesByProject: Readonly<Record<string, readonly IVectorCodeMobileRemoteFileNode[]>>;
	readonly fileTreeTruncatedByProject?: Readonly<Record<string, boolean>>;
	readonly editorsByProject: Readonly<Record<string, readonly IVectorCodeMobileRemoteEditorTab[]>>;
	readonly terminalsByProject: Readonly<Record<string, readonly IVectorCodeMobileRemoteTerminalTab[]>>;
}

export interface IVectorCodeMobileRemoteProjectSummary {
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly isOnline: boolean;
}

export interface IVectorCodeMobileRemoteFileNode {
	readonly name: string;
	readonly path: string;
	readonly kind: 'file' | 'folder';
	readonly children?: readonly IVectorCodeMobileRemoteFileNode[];
	readonly childrenTruncated?: boolean;
}

export interface IVectorCodeMobileRemoteEditorTab {
	readonly id: string;
	readonly projectId: string;
	readonly path: string;
	readonly title: string;
	readonly language: string;
	readonly isDirty: boolean;
	readonly content?: string;
	readonly version?: string;
}

export interface IVectorCodeMobileRemoteTerminalTab {
	readonly id: string;
	readonly projectId: string;
	readonly title: string;
	readonly cwd: string;
	readonly isActive: boolean;
	readonly output: readonly string[];
	readonly rawOutput?: string;
}

export interface IVectorCodeMobileRemoteTerminalInputRequest {
	readonly terminalId: string;
	readonly input: string;
	readonly submit: boolean;
	readonly mode?: 'raw' | 'paste' | 'command';
}

export interface IVectorCodeMobileRemoteTerminalInputResponse {
	readonly terminalId: string;
	readonly accepted: boolean;
}

export interface IVectorCodeMobileRemoteTerminalCreateRequest {
	readonly title?: string;
	readonly cwd?: string;
}

export interface IVectorCodeMobileRemoteTerminalControlRequest {
	readonly terminalId: string;
	readonly command: 'resize' | 'interrupt' | 'clear' | 'rename' | 'close';
	readonly cols?: number;
	readonly rows?: number;
	readonly title?: string;
}

export interface IVectorCodeMobileRemoteTerminalControlResponse {
	readonly terminalId: string;
	readonly accepted: boolean;
}

export interface IVectorCodeMobileRemoteTerminalOutputRequest {
	readonly terminalId: string;
}

export interface IVectorCodeMobileRemoteTerminalOutputResponse {
	readonly terminalId: string;
	readonly output: readonly string[];
	readonly rawOutput?: string;
}

export interface IVectorCodeMobileRemoteFileTreeResponse {
	readonly nodes: readonly IVectorCodeMobileRemoteFileNode[];
	readonly truncated: boolean;
}

export interface IVectorCodeMobileRemoteFileReadRequest {
	readonly path: string;
}

export interface IVectorCodeMobileRemoteFileReadResponse {
	readonly path: string;
	readonly content: string;
	readonly language?: string;
	readonly version?: string;
}

export interface IVectorCodeMobileRemoteFileWriteRequest {
	readonly path: string;
	readonly content: string;
	readonly expectedVersion?: string;
}

export interface IVectorCodeMobileRemoteFileWriteResponse {
	readonly path: string;
	readonly version?: string;
}

export interface IVectorCodeMobileRemoteFileMoveRequest {
	readonly path: string;
	readonly targetPath: string;
	readonly targetProjectId?: string;
	readonly overwrite?: boolean;
}

export interface IVectorCodeMobileRemoteFileMoveResponse {
	readonly path: string;
	readonly targetPath: string;
	readonly targetProjectId: string;
}

export interface IVectorCodeMobileRemoteFileCopyRequest {
	readonly path: string;
	readonly targetPath: string;
	readonly targetProjectId: string;
	readonly overwrite?: boolean;
}

export interface IVectorCodeMobileRemoteFileCopyResponse {
	readonly path: string;
	readonly targetPath: string;
	readonly targetProjectId: string;
}
