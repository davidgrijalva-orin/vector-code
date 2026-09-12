# Vector Code

Vector Code is OrinTech's native workbench for project-based development. It keeps projects, file trees, editor tabs, terminals, source control, and mobile pairing scoped to the active project while preserving the surrounding editor layout.

## Current Product Surface

- Project switcher with per-project file, editor, terminal, task, and session state
- Phone Connection view for QR pairing through the relay-backed mobile bridge
- Terminal panel with per-project terminal tabs and persistent hidden sessions
- Rich Markdown editor with editable preview as the default `.md` experience
- Vector-branded workbench shell, empty canvas, and no-project states

## Development

Use the repository scripts for local development and validation. Extension work should be compiled with the matching gulp extension task, and workbench source changes should be checked with the native TypeScript compile gate.

```bash
npm run gulp compile-extensions
npm run compile-check-ts-native
```

## Notes

This repository is a native workbench fork. Upstream platform internals may still exist in source where they are required for compatibility, but user-facing surfaces should be Vector-branded and project-oriented.
