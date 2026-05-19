# Vector Code Fork

This repository is the Vector-owned Code - OSS fork.

## Direction

- Vector Code is native workbench functionality, not a user-installed extension.
- User extensions remain supported through the VS Code-compatible extension host.
- Open VSX is the default extension gallery for this fork.
- Microsoft product branding, Marketplace entitlement, update services, and proprietary distribution assumptions must not be treated as Vector-owned infrastructure.

## Current Baseline

- Upstream: `microsoft/vscode`
- Initial fork branch: `main`
- First Vector branch: `vector/brand-baseline`
- Initial fork SHA: `13375c8744186c933270842cb2c029d12bc4e86a`

## Rebase Rule

Keep Vector Code changes as small, reviewable patches on top of upstream Code - OSS. Prefer first-party workbench contributions and product configuration over broad rewrites of editor, explorer, terminal rendering, language service, or extension host internals.
