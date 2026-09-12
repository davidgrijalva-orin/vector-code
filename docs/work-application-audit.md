# Four-repository implementation audit

Inspected 2026-09-12 for [VC-61](work-application-brief.md). These are source
observations. No production deployment, package-registry verification, authenticated
artifact mutation or installed-app acceptance was performed during this audit.

## Repository and release boundaries

| Repository / verified checkout | Inspected HEAD | State and build boundary |
| --- | --- | --- |
| VectorCode `/Users/davidgrijalva/OrinTech/Vector/vector_code` | `3217b2a2479` | npm, TypeScript/Electron, native editor/extension tests; main; untracked imageCarousel CLAUDE.md preserved |
| VectorGraph `/Users/davidgrijalva/OrinTech/ticket_tracking` | `77288e95` | pnpm 11.23.0, Node 24.19.0, separate API/web/workers; existing CSS edits on `codex/fix-authorization-callout-layout` preserved |
| VectorVoice `/Users/davidgrijalva/OrinTech/Vector/VectorVoice` | `86c0d45` | npm workspaces, Next/Fastify, Swift clients, separate API/worker/intelligence/delivery builds; main; untracked CLAUDE.md preserved |
| VectorPlatform `/Users/davidgrijalva/OrinTech/Vector/VectorPlatform` | `fa5f34a6` | npm packages and Signals service; staging; untracked .vectorgraph preserved |

Root AGENTS.md files were read. Graph also has nested web instructions; no web
source changes are included. VectorCode requires its first TypeScript compiler
check and paired instruction equality; Voice requires dedicated stack worktrees;
Platform retains its staging/main package release flow; Graph retains its exact-SHA
Verify/release gates. Local tests do not bypass any of these.

Implementation is isolated at `/private/tmp/vector-code-vc61-20260912`, branch
`codex/vc-61-work-document-foundation`. VC-60 owns the concurrent project-shell and
inspector work. That task and its branch were not claimed or modified. Their future
integration is an explicit dependency, not an implicit merge of dirty trees.

## Ownership and gaps

| Concern | Verified source owner and reusable foundation | Required extension / gap |
| --- | --- | --- |
| Project identity | Code `vectorCodeService.getProjectSummaries()` maps VS Code folders; Graph planning and project context bundles use workspace/project UUIDs | Native non-folder selection; zero-to-many folder resources per work project and integrated project navigation. Do not reinterpret tenant workspace as local workspace |
| Documents | Graph document creation checks team, collection, reviewer and link access, persists body/content JSON and initial version in a transaction | Reuse project links and existing CRUD; no new generalized artifact service |
| Saves/revisions | Graph atomic `revision_number` predicate plus version insertion; Code virtual filesystem retains draft baseline and retry key | Native conflict comparison/version UI and real restart/uncertain-write acceptance remain to prove |
| Storage | Graph document bodies in PostgreSQL; `storage-core` plus attachment upload/complete/download handlers; signed object URLs | Project-native binaries/file formats need scoped ownership later; do not use issue attachments as a generic artifact model by assumption |
| Native editing | Existing `vectorGraphDocuments.contribution`, `vectorGraphDocumentFileSystem`, UTF-8 Markdown text-file registration | Source editing is implemented; native rich editing is not proven. Reuse existing editors/previews first |
| Web | Tiptap Markdown rich editor, templates, collections, comments, autosave, versions, archive/restore, Markdown import | Keep useful web workflows; select native priorities explicitly |
| Text agents | Graph scoped CLI/MCP access, context bundles, actor and operation policy; Code MCP catalogue/config management | No current Code chat runtime or tool runner. Explicit selected-document generation/apply/cancel/receipt path is missing |
| Voice | Voice capture-session start/stop/cancel, temporary audio lifecycle, batch/chunked providers, cited meeting intelligence, reviewed follow-up delivery | No located realtime voice session/interrupt/tool-action runtime. Reusable transcription is not equivalent to project voice actions |
| Auth | Code encrypted main-process Graph device credentials; Graph workspace membership/team scopes; Voice organization, WorkOS FGA, session/device scopes | No verified cross-product account mapping or shared sessions. Treat unified sign-in as unresolved |
| Platform | Connector contracts/core/adapters and Signals contracts/core/PostHog adapter/gateway source; scaffold tooling | No present generic artifact or agent execution package. Do not extract speculative interfaces |

### Direct source evidence

Paths below are relative to their repository root unless linked.

- **Code:** [project identity](../src/vs/workbench/contrib/vectorCode/browser/vectorCodeService.ts),
  [Graph binding](../src/vs/workbench/contrib/vectorCode/common/vectorGraphBinding.ts),
  [document operations](../src/vs/platform/vectorGraph/node/vectorGraphOperations.ts),
  [document file provider](../src/vs/workbench/contrib/vectorCode/browser/vectorGraphDocumentFileSystem.ts),
  [device auth](../src/vs/platform/vectorGraph/node/vectorGraphAuth.ts),
  [native document tests](../src/vs/workbench/contrib/vectorCode/test/browser/vectorGraphDocuments.test.ts),
  [MCP runtime limitation](marketplaces.md).
- **Graph:** `apps/api/src/handlers/documents/{documents,access,versions}.ts`;
  `packages/db-core/src/repository/artifacts/artifact-document-{creations,mutations}.ts`;
  `packages/validation-core/src/{artifacts,document-content}.ts`;
  `apps/api/src/handlers/cli/{api-operations,project-context-bundle}.ts`;
  `apps/api/src/handlers/attachments/{upload-intents,complete-upload,download}.ts`;
  `apps/web/src/features/workspace-console/docs/components/WorkspaceDocsRichEditor.tsx`;
  `apps/web/src/features/workspace-console/docs/useArtifactAutosave.ts`.
- **Voice:** `services/api/src/{captures,authorization,auth-context,follow-ups}.ts`;
  `packages/transcription/src/types.ts` (`transcribe` accepts Blob; batch/chunked
  capability contract); `packages/intelligence/src/{types,pipeline}.ts` (`analyze`
  consumes transcript segments, validates cited IDs); `packages/workflows/src/index.ts`;
  `apps/apple-shared/Sources/VectorVoiceApple`; `packages/storage/src/index.ts`.
  Searching app/services/packages/native code did not locate a realtime WebSocket,
  TTS, barge-in or project document action implementation.
- **Platform:** `packages/connector-core/src/{oauth-client,pkce,signed-state,webhook-signatures}.ts`;
  `packages/signals-{contracts,core}/src/index.ts`;
  `services/signals-gateway/src/{gateway,config,catalogs}.ts`; package manifests,
  `docs/{ARCHITECTURE,MIGRATION_ROADMAP,RELEASES}.md`.

### Cross-product packages and documentation drift

Graph's `packages/integration-core/package.json` and Voice's root manifest pin
`@davidgrijalva-orin/vector-connector-core` and `vector-connector-adapters` to **0.7.1**.
Concrete imports occur in Graph's `provider-oauth-token.ts`,
`oauth-credential-refresh.ts`, and Voice's `google-oauth.ts`, `oauth-crypto.ts`,
and delivery `gmail-provider.ts`. Platform's current seven package manifests are **1.0.0**. No pin is changed here.
Platform release docs record publication of 1.0.0, but registry availability was not
re-verified. Its architecture text still describes Signals as branch-only and lists
`platform-contracts`, `security-core`, `events-contracts`, `jobs-core`,
`http-contracts`, and `agent-contracts` as proposed/gated; those names are not proof
of implemented packages. Release/train docs also retain historical staging wording
for consumers whose current trunk policy differs. Follow each repository's current
instructions, not inherited release assumptions.

## Evidence levels and tracking access

Existing test source covers Code document identity, UTF-8, dirty baselines, retry
keys, and generic filesystem refusal; Graph has document route/collaboration,
artifact-link access, import, content, and storage tests; Voice has native auth,
transcription, intelligence and reviewed delivery tests; Platform has connector
and gateway tests. Their presence is not a claim they all passed this run.
Only checks actually executed for the candidate are recorded on VC-61.

Installed CLI **0.7.0** verifies workspace `vectorcode`
`bf275fab-fe03-44c3-b993-ced522c45a07`, team `VC`
`658d2b51-5118-46d4-8b60-bf1954501284`. All current team issues were read without
pagination remaining. VC-61 was created/read back with this task as unique owner.
The current credential returns **403, missing planning:read** for `listApiProjects`.
Saved profiles expose only HomePlatform and VectorCode; bindings for Graph, Voice
and Platform engineering work are not verified. No substitute workspace is used.
Cross-repository implementation tickets must wait for their verified bindings.

## Smallest implementation sequence

1. **VectorCode / VC-61:** record this brief/ADR; select an existing work project in
   an empty window; reuse new/open/save document actions. Validate no-folder context,
   cancellation/account switches, permission errors, and existing save/retry behavior.
2. **VectorCode execution owner, Graph contract owner:** choose the bounded text
   execution path; fetch only selected documents/revisions, generate a draft, apply
   through the same authorized revision-aware action, persist operation outcome.
   This depends on the explicit runner choice and verified tracker access for any
   backend change. Context bundles are reusable but must not replace explicit selection.
3. **VectorCode + Graph:** prove real permission denial, concurrent save, failed and
   uncertain saves, cancellation, duplicate retry, dirty editing, version recovery,
   close/reopen, and packaged UI. Use an authorized QA workspace, not the engineering
   workspace as a test-data fixture. Integrate project navigation with VC-60 separately: one project groups zero-to-many folders, preserves per-folder state, and can close a folder without closing the project or losing its other resources.
4. **VectorVoice + Code/Graph:** project voice adapter using the same action receipt,
   interruption/cancel reconciliation, no duplicate mutation, explicit cross-product
   grant. No required Platform extraction unless two consumers demonstrate it.
5. **Later:** budget/chart, then presentation. Design capability requires separate scope.

Unresolved material decisions: external adapter versus a new built-in text runner;
real grant/account mapping for Voice; final shell integration and non-development
editing usability. Full offline document sync and universal artifact editors are
outside this milestone. See the ADR for the proposed action contract and explicit
compatibility rules.
