# VectorCode as the native VectorGraph client

VectorCode is the native application client for VectorGraph. All exposed non-billing product capabilities belong in the native experience. Billing, subscriptions, payment methods and invoices always open on the VectorGraph website.

VectorGraph remains the authority for identity, authorization, business rules, records, relationships, revisions and audit history. The IDE stores only credentials in its protected main-process store, local presentation state, cached data and recoverable drafts. It must not create a second backend or rely on web embeds for normal product workflows.

## Client architecture

Use one account and workspace context, a shared authenticated transport, explicit typed operation adapters, consistent API errors, and server-supported idempotency and revision checks. API coverage means usable native workflows, not a generic endpoint console. Project navigation owns the selected context; documents and tickets open through shared editor identities and links. Missing grants and offline state are visible and actionable. Billing is the sole intentional web-only product boundary.

Native surfaces should cover project/team planning, issues and relationships, documents and collections, canvases, context and search, evidence and review, integrations and repository data, operational records, and workspace administration according to the API and the signed-in user's permissions. Full API parity must be tracked and verified capability by capability; adding document tabs does not complete it.

## Delivery and coverage

VC-58 tracks full native API coverage. VC-57 tracks the existing ticket workflow and its live secondary-sidebar correction. VC-59 delivers document browsing, creation, native Markdown tabs and revision-aware saves. The current CLI operation catalogue is a discovery input, not proof that every public API endpoint has been audited or implemented. Reconcile it with the canonical VectorGraph API definitions before declaring full coverage.

Verified foundations: IDE-owned device sign-in, main-process authenticated API transport, explicit workspace selection, project/ticket queries, ticket editing/comments, active work and repository/PR links. Document support is in progress. Other API families remain tracked work; none should be described as complete from catalogue presence alone.

## Acceptance

For each native capability, record its API operations and scopes, native entry points, workspace/project behavior, write and conflict semantics, offline/permission handling, deterministic checks, and visible installed-app proof. Preserve backend rich content and relationships. Never silently convert away unsupported data. Merged source, packaged builds and authenticated runtime acceptance are separate evidence requirements.

## Standalone IDE

VectorCode is also a complete standalone IDE. Local projects, files, editing, Git, terminals, debugging, extensions and MCP must work without a VectorGraph account or service connection. VectorGraph adds shared tickets, documents, planning and relationships. Keep optional connection onboarding separate from local development actions, and validate both disconnected and connected workflows.
