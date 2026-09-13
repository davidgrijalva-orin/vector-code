# VectorCode as a native work application

The [work application brief](work-application-brief.md) is authoritative for product
direction. VectorCode contains the IDE and specialized work tools; non-development
projects must not require repositories or local folders. The [architecture decision](work-application-architecture.md)
and [four-repository audit](work-application-audit.md) define ownership and evidence.

VectorGraph owns identity, workspace authorization, business rules, records,
relationships, revisions and audit. VectorCode owns native presentation, protected
main-process credentials, local state and recoverable drafts. Reuse typed operation
adapters and server revision/idempotency checks. Do not duplicate the backend.

Native/web coverage follows explicit workflow priorities: first project documents,
then bounded voice, budgets/charts, and presentations. This supersedes blanket
non-billing API parity. Billing remains web; additional web-only workflows may be
chosen explicitly. Existing web, local development, and voice functionality remains
useful. A catalogue of APIs is not a native workflow or runtime capability proof.

VC-61 owns the document-first integration milestone. VC-58/VC-60 are independently
owned existing work; reconcile their scope with this direction without silently
claiming or rewriting their tasks. VC-59's existing native document provider is
reused. Keep merged source, local checks, packaged builds, and authenticated
installed-app acceptance as separate evidence gates.

For every native workflow, record its API operations/scopes, entry points,
project/workspace behavior, conflict handling, offline/permission states, checks,
and installed-app proof. Preserve backend rich content and relationships; never
silently convert away unsupported data. Use shared authenticated transport and
editor identities rather than embedding the website as the normal native workflow.

## Standalone IDE

VectorCode is also a complete standalone IDE. Local projects, files, editing, Git, terminals, debugging, extensions and MCP must work without a VectorGraph account or service connection. VectorGraph adds shared tickets, documents, planning and relationships. Keep optional connection onboarding separate from local development actions, and validate both disconnected and connected workflows.

Use the same project workspace and navigation in both cases. Connecting VectorGraph enriches the current repository with shared context and native workflows; it must not require switching to a separate application experience. A repository without a VectorGraph association remains a normal, useful project. Losing the service connection must not interrupt local development.

## Persistent project rail

Project Workspace is a permanent native destination in the right sidebar. Its section navigation stays there. Opening a ticket creates a named tab in that rail; opening it again selects the existing tab. Closing a ticket returns to Workspace without closing the workspace itself. Ticket edits stay inline alongside the activity and comments. Mutable metadata follows the API schema; permission-limited planning choices show an explicit access message and preserve existing values.

Documents open rendered previews by default, with an explicit source-edit action retaining the established native draft and save path. Canvas browsing uses the workspace artifact API and opens native scene previews. Canvas editing, collaboration, and full relationship-canvas parity remain separate coverage requirements; preview access does not complete them.

Local terminals use the standard shell profile and environment. No bundled coding-agent runtime is required. Mobile connection currently depends on deployment-provided relay enrollment; a QR or redesigned setup screen alone is not proof of a finished personal-device pairing flow.
