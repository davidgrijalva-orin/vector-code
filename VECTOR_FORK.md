# Vector Code Fork

This repository is the Vector-owned Code - OSS fork.

## Direction

- Vector Code is native workbench functionality, not a user-installed extension.
- User extensions remain supported through the VS Code-compatible extension host.
- Open VSX is the default extension gallery for this fork.
- Microsoft product branding, Marketplace entitlement, update services, and proprietary distribution assumptions must not be treated as Vector-owned infrastructure.

## Fork Depth

Vector Code is a medium-plus fork. Product-defining workflows should live as first-party workbench code, while editor, extension host, workspace, search, language, and terminal primitives should stay close to upstream unless a specific Vector behavior requires a narrower patch.

Native Vector surfaces are expected for:

- Multi-project workspaces on top of Code - OSS multi-root workspace support.
- Terminal routing such as sending the current selection or line to the active terminal.
- Project-aware terminal creation and future terminal state improvements.
- Mobile app connection through a native Vector relay adapter.
- Agent sessions, runtime status, verification, and run ledger workflows.

## Current Baseline

- Upstream: `microsoft/vscode`
- Initial fork branch: `main`
- First Vector branch: `vector/brand-baseline`
- Initial fork SHA: `13375c8744186c933270842cb2c029d12bc4e86a`
- Node runtime: `22.22.3` from `.nvmrc`, the latest compatible Node 22 LTS at the time this baseline was created.

## Rebase Rule

Keep Vector Code changes as small, reviewable patches on top of upstream Code - OSS. Prefer first-party workbench contributions and product configuration over broad rewrites of editor, explorer, terminal rendering, language service, or extension host internals.
