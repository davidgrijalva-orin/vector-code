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
