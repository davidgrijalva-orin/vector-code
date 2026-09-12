# VC-60 design acceptance

Target: approved combined concept `exec-aba86ca7-a853-48f2-aae7-00a90fb5ca8c.png` in task 01a09380-3fca-76d3-948c-aa88fe512a27. Native Electron implementation, with real project data rather than illustrative ticket titles. Target frame is 1440 × 1024; the desktop capture is a scaled native window, so viewport normalization remains before final comparison.

## Verified

- Installed signed first preview opens the standalone project home and a local repository without an account gate.
- Project tabs switch correctly. Real linked project tickets load and selection opens the native right inspector.
- Documents loads the linked project list; selecting a document opens its named native editor tab while retaining the ticket inspector.
- Native light theme can be selected through the theme picker.
- Browser regression tests verify account-independent local actions, rejection of stale document results after a project switch, and validated restoration of navigation state.
- A computed-style regression verifies that primary project actions consume the actual `--vectorcode-*` theme namespace.

## Findings and corrections

- P1 colors: first preview exposed integration styles using upstream `--vscode-*` variables, while this fork emits `--vectorcode-*`. Corrected project/ticket/MCP styles and removed global hard-coded chrome overrides. Automated computed-style regression passes; final native visual confirmation pending.
- P2 hierarchy: inspector metadata was a single text line. Replaced with labeled fields and a separate primary work action; awaiting final native comparison.
- P2 responsiveness: added a container-width adaptation for ticket rows and project navigation; final narrow-window interaction check pending.
- P2 standalone copy: local development is the primary unconnected workflow; VectorGraph is optional. Existing association is not presented as proof of a live authenticated connection.

## Remaining acceptance

Compare final target and final native capture together, including typography, spacing, theme colors, icon clarity, real content wrapping, selected ticket inspector, resize/dismiss/reopen, editor-tab action, keyboard navigation and narrow layouts. The concept's full graph canvas is outside this delivery and remains in VC-58; the current tab states that limit explicitly. Native workbench chrome and real project names intentionally differ from the illustrative image.

The Mac locked during QA and automatic unlock failed. No final visual pass is claimed. Keep PR in draft and VC-60 open until the final installed app can be inspected.

final result: blocked
