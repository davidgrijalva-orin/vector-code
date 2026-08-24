# Vector Code Codex Integration

Vector Code uses the official Codex App Server protocol for its native Codex view. The integration is additive: it does not replace the project switcher, editor, terminal, source-control, extension, or phone-connection surfaces.

## Setup

Install and authenticate the Codex CLI on the desktop:

```sh
npm install -g @openai/codex
codex login
```

Open **Codex** from the title bar or activity bar. Conversations are filtered to the active project's working directory. The native view supports conversation history, new/resumed threads, streamed messages and activity, command and file approvals, user-input requests, model and reasoning-effort selection, interrupt, fork, and archive.

Vector Code owns the helper lifecycle. It discovers the Codex executable, initializes and checks the account before enabling the composer, assigns every request a unique correlation ID, cancels stale project reads, and bounds request timeouts. If the App Server exits unexpectedly, Vector Code reinitializes it after 1, 2.5, and 5 second delays. A stable connection resets that budget; repeated failures stop with an actionable **Refresh** path instead of spawning duplicate helpers.

The native composer remains disabled when Codex authentication is required. Use **Full Terminal** to sign in; account change notifications refresh the native state automatically.

Installed Codex plugins, skills, apps, and MCP servers are loaded by the same Codex runtime used by the native view. Use **Plugins** to inspect installed plugins, search configured marketplaces, and confirm plugin installs or removals. Default and administrator-managed plugins are protected from removal.

Use **Full Terminal** or **Codex: Open Full Terminal Experience** for advanced CLI commands and newly introduced App Server features that do not yet have dedicated chrome.

## Verification

The smoke test is read-only. It starts `codex app-server`, initializes the official protocol, then issues six concurrent UUID-correlated reads for the account, model catalog, project thread list, installed plugins, available plugins, and plugin search. It does not create or modify a thread or plugin:

```sh
npm run smoke-vector-codex
```

Set `VECTOR_CODE_CODEX_COMMAND` only when a non-default Codex executable must be tested.
