/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Setting IDs for terminal sandboxing.
 */
export const enum AgentSandboxSettingId {
	AgentSandboxEnabled = 'vectorcode.terminalSandbox.enabled',
	AgentSandboxAllowUnsandboxedCommands = 'vectorcode.terminalSandbox.allowUnsandboxedCommands',
	AgentSandboxAutoApproveUnsandboxedCommands = 'vectorcode.terminalSandbox.autoApproveUnsandboxedCommands',
	AgentSandboxAllowAutoApprove = 'vectorcode.terminalSandbox.allowAutoApprove',
	AgentSandboxLinuxFileSystem = 'vectorcode.terminalSandbox.fileSystem.linux',
	AgentSandboxMacFileSystem = 'vectorcode.terminalSandbox.fileSystem.mac',
	AgentSandboxAdvancedRuntime = 'vectorcode.terminalSandbox.advanced.runtime',
}

export const enum AgentSandboxEnabledValue {
	Off = 'off',
	On = 'on',
	AllowNetwork = 'allowNetwork',
}
