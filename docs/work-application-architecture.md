# Architecture decision: project document workflow across Vector products

Date: 2026-09-12. Status: product ownership accepted by owner direction;
first document slice implemented locally; execution and voice integration pending.
Authoritative product intent: [work application brief](work-application-brief.md).
Source evidence and unresolved gaps: [audit](work-application-audit.md).

## Decision

Keep four repositories with explicit, versioned API/package boundaries.
VectorGraph owns shared project/document records, workspace authorization,
relationships, durable revisions and product audit. VectorCode owns native
presentation, editor state, recoverable drafts and separately authorized local
execution. VectorVoice retains its meeting/capture/intelligence/delivery product
state and contributes reusable capability adapters where verified. VectorPlatform
owns demonstrated product-neutral contracts and mechanics, with product-independent
consumers and exact version pins. No common database, identity service, or universal
agent runtime is introduced.

```mermaid
flowchart LR
  Native["VectorCode native client — implemented"] --> API["VectorGraph API / cli/v1 — implemented"]
  Web["VectorGraph web client — implemented"] --> API
  API --> DB["PostgreSQL projects, documents, revisions, audit — implemented"]
  API --> Objects["Signed object storage for attachments — implemented"]
  Native --> Local["Local files, terminals and device permissions — implemented, separate"]
  Text["Selected-context text execution adapter — proposed"] -.-> Native
  Voice["VectorVoice capture, transcription, intelligence — implemented"] -.-> VA["Project voice action adapter — proposed"]
  VA -.-> Text
  Voice --> VoiceAPI["VectorVoice API and product storage — implemented"]
  Platform["VectorPlatform versioned connector and signal packages — implemented"] --> API
  Platform --> VoiceAPI
```

Solid arrows describe implemented source boundaries, not verified live deployments.
Dashed arrows are proposed. Platform consumption by Graph/Voice is verified for
connector packages; the diagram does not assert adoption or deployment of Signals.
Document bodies and derived structured content live in Graph's document model;
attachment storage does not imply a generalized project file store already exists.

## Identity and capability separation

A Graph workspace UUID is the tenant boundary; teams constrain access within it.
A Graph project UUID is a work grouping and may link many documents and optional
repositories. A desktop work project has **zero-to-many local folder resources**;
each resource has its own URI and local access/trust boundary. Many folder bindings
may refer to the same Graph project. A Graph project ID, never the first folder URI,
is the shared work identity. Closing one folder must not delete the project, its
artifacts or other folder associations. An Electron/VS Code workspace and its local folders are client
execution resources, not tenants or authoritative project identities.

The first slice stores a selected Graph workspace/team/project in the empty
window's workspace-scoped presentation storage. Existing folder-to-Graph bindings
retain their profile-scoped owner and take precedence when a folder is active.
This slice proves shared document context for multiple folder bindings; it does
not yet group those folders under one native project-navigation entry. That shell
and persistence migration must preserve existing per-folder editor/terminal state.
A local folder is not synthesized for a remote project. Never pass that project
selection to a filesystem, terminal, relay, or device execution API. Account and
project changes invalidate pending selection/create dialogs, including switching
away and back. Every server call still enforces its own authorization.

Graph owns global users and workspace memberships. Voice owns organization/user
records, WorkOS membership/FGA checks and session/device grants. Sharing WorkOS
does not prove shared subjects, audience, sessions, or authorization. Unified sign-in
and cross-product grants need an explicit account/workspace mapping and revocation
contract; no token interchange is introduced here.

## First slice contracts and compatibility

Reuse existing `listApiProjects`, team/workspace discovery,
`listApiWorkspaceDocuments`, `getApiWorkspaceDocument`,
`createApiWorkspaceDocument`, and `updateApiWorkspaceDocument` through VectorCode's
existing main-process transport. Keep credentials out of renderer and artifact
content. Project selection adds no backend route or package change.

A document reference is `(workspace UUID, document UUID)` with a stable native
`vectorgraph-document` URI. Project linkage remains a Graph document relationship;
there is no second artifact table. Save sends the Markdown body,
`expectedRevisionNumber`, `expectedVersionNumber`, `saveMode: versioned`, and a
retained idempotency key. Graph currently prefers the revision precondition and
uses expected version only as a legacy fallback; these are not two independent
compare-and-swap checks. Keep that compatibility behavior explicit.

The native file model owns dirty buffers and hot-exit backups; the provider retains
the loaded revision and uncertain request identity. A conflict must keep the draft
and require deliberate comparison/reload before another write. Recovering prior
versions through native controls remains a gap; Graph/web already provide versions
and restore. Test this against the real file-model lifecycle before packaged
acceptance, not only provider reconstruction.

No coordinated client migration is necessary for the selection slice. Existing
web/CLI clients continue using their routes. Any new execution protocol must be
additive and versioned and reject unsupported versions without forcing package
upgrades across all products. Keep the Graph-owned API contract authoritative;
extract a Platform contract only after a second actual consumer exists.

## Next execution contract, not implemented

The smallest document action needs: schema version; workspace/project identity;
explicit selected document IDs and source revisions; target document and base
revision for revision actions; user request; operation identity; cancellation state;
and a receipt identifying committed document/revision or a definite/uncertain
failure. Fetch selected content through authorized reads, never an unrestricted
workspace dump. Revalidate access and revisions at mutation time.

Generate a recoverable draft first. Applying the accepted draft uses the same
native save path as direct editing. Do not silently overwrite an already dirty
buffer. Cancellation before dispatch makes no mutation; after dispatch reconcile
the original operation, do not invent a new retry identity. Conversation retention,
actor attribution, and cross-product grants belong with the product that owns them,
not an ad hoc client database or a transcript attachment store.

## Alternatives and consequences

- Reusing the existing native Markdown/file model avoids a new editor dependency
  and preserves standard save/recovery behavior. It requires honest source-editing
  scope and later usability evaluation for non-development users.
- The web Tiptap editor is a useful existing rich-editing implementation. Embedding
  it unchanged into the native shell is not chosen; evaluate native integration and
  content fidelity explicitly if the milestone requires rich text UX.
- Restoring the removed Codex integration, embedding Voice's entire service runtime,
  or extracting a universal Platform agent engine would introduce unapproved scope
  and undermine the ownership boundaries. A document-only execution choice is pending.
- Existing local development stays available offline. Shared Graph documents require
  authorization/network access; unsaved recovery must remain local until a successful
  save. This is not a promise of general offline synchronization.
