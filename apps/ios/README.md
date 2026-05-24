# VectorCode Mobile

VectorCode Mobile is the iOS companion for the desktop workbench. It pairs from the desktop QR payload, keeps a relay configuration for the paired desktop, and presents the project-scoped workspace surface the phone needs: projects, files, editors, and terminals.

## Local checks

```sh
swift build --package-path apps/ios
swift run --package-path apps/ios VectorCodeMobileVerifier
```

## Runtime contract

The mobile app never reads a project directly from a repo host. The desktop app remains the authority for local project state and terminal PTYs. The phone connects to the Railway relay as a `phone` peer using the QR payload, then sends encrypted workspace requests to the paired desktop peer. After a valid QR payload is scanned or pasted, the app attempts an encrypted `state.read` request and replaces the local preview with the desktop snapshot when the bridge answers.

The first supported remote actions are:

- `state.read`: list open projects, editor tabs, terminals, and active project content.
- `file.tree.read`: read the selected project's file tree.
- `file.read`: open one file into the editor.
- `file.write`: save an edited file through the desktop, including the last read file version when available.
- `terminal.list`: list project terminal tabs.
- `terminal.create`: create a terminal for the selected project.
- `terminal.input`: paste/send terminal input to the active project terminal.
- `terminal.control`: resize, interrupt, clear, rename, or close a project terminal.
- `terminal.output`: refresh and poll output back from the desktop.
