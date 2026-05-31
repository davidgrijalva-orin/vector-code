# VectorCode Visual QA

Run this after desktop or iOS chrome changes. Treat visual drift from this checklist as a defect, especially copied default workbench styling, oversized CTAs, intense teal fills, duplicate icons, and project state resets.

## Desktop Shell

1. Launch the desktop app with at least two projects open.
2. Verify the top-right chrome order is Search, Account, Settings, Terminal.
3. Click Search once. The icon must remain visible and the dropdown must use VectorCode surfaces, spacing, and muted accent colors.
4. Click Search again. The dropdown must close without moving the other chrome icons.
5. Open Account and Settings. Menus must sit below the chrome bar without overlapping it.
6. Toggle Terminal from the top-right terminal icon. Closing the panel must only hide it; terminal tabs stay alive.
7. Open more terminal tabs than fit. Tabs must scroll horizontally in bottom and vertical placements.
8. Switch the panel to vertical placement. The editor layout stays global while project-scoped terminal tabs swap per project.

## Project State

1. In Project A, open several editor tabs and terminal tabs.
2. Switch to Project B. Only Project B files, editors, terminals, tasks, and sessions are visible.
3. Switch back to Project A. The same Project A editor tabs, active terminal tab, and terminal output are restored.
4. The terminal panel visibility, split size, sidebars, and panel placement must not change during project switches.

## Workbench Tabs

1. Inspect Files, Search, Source Control, Run/Bugs, Extensions, Settings, Notifications, and update UI.
2. Each surface must use VectorCode typography, compact controls, muted borders, and the same low-intensity accent system.
3. No tab should show default VS Code welcome copy, default open-folder CTAs, bulky blue buttons, or unbranded popups.
4. File tree text should use normal file colors and compact spacing; project rows should stay lighter than selected files.

## iOS App

0. Run `npm run smoke-vector-relay -- --dry-run`, then run the live relay smoke from [mobile-relay-smoke.md](./mobile-relay-smoke.md) when the relay issuer token is available.
1. Pair with the desktop QR code and confirm the app moves past the pairing screen after connection.
2. Confirm all open projects appear and switching projects swaps files, editor tabs, and terminal tabs without losing per-project state.
3. Open a file. The editor should show a monospaced Monaco-like gutter, status strip, save state, language, and version when available.
4. Edit and save a file; verify the desktop file changes.
5. Use Copy to Project with and without Allow overwrite. Confirm the destination project updates on desktop.
6. Rename a file and confirm the desktop file tree updates.
7. Open Terminal, create a terminal, type a command, paste without submit, then submit. Output must be real terminal output.
8. Clear, interrupt, and close terminal actions must show confirmation before affecting the paired desktop.
