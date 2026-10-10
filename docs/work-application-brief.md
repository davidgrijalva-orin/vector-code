# Work application product brief

Owner direction: 2026-09-12. Integration tracking: **VC-61** in the verified
VectorCode workspace. This is the authoritative cross-product brief; other
repositories should link here instead of copying it. Implementation evidence
belongs on the owning tickets.

Vector is a general-purpose work application containing an IDE and specialized
tools. A project organizes a brief, research, documents, budgets, charts,
presentations, designs, tasks, decisions, and optional code. A desktop work project may contain **zero, one, or many local
folders**; each folder may or may not be a Git repository. Folder count never
defines project identity. Creating a document
or budget must not require a repository, local folder, or development environment.
VectorCode is the native application foundation; VectorGraph remains the shared
work and context backend. VectorVoice and VectorPlatform contribute only the
capabilities verified in the [source audit](work-application-audit.md), under the
[architecture decision](work-application-architecture.md).

Users work directly and through text or voice where implemented. They explicitly
select project materials for an agent. Generated work becomes durable project
content that users can reopen and edit, not just a conversation attachment.
Direct edits and agent edits share authorization, revision, retry, and recovery
semantics. The app is an API client. Graph/Voice services own business rules and
processing; clients depend on versioned contracts, never backend implementation
modules or direct database access. Neither document access nor voice access grants local file, terminal,
device, or credential access.

The existing desktop model equates one folder with one project. Migrating that
navigation to one work project with multiple folder resources is required; merely
linking two separately displayed folder projects to the same Graph project does not
complete the desktop grouping experience. Preserve each folder's editor/terminal
state and separately authorized local access during that migration.

## Accepted entry experience: useful personal work, then connected context

Owner approved this direction on 2026-09-12. The account-free app is a complete,
repeatable personal work tool, not an expiring demo or an onboarding shell. A person
must be able to capture material, edit it, organize it into projects, find it again,
reopen it later, and export usable work without signing up. Their local work stays
available whether or not they ever create an account.

The core includes local projects with zero-to-many folders, notes, an unassigned
inbox, dependable saving/recovery, editing, local search, audio recording/playback,
and export. First-run entry points are **New note**, **Record**, **New project**,
and **Open folder**. Sign-in is not an interruption inside the basic workflow.
The current PR's Graph-connected commands are an optional mode, not this final
account-free onboarding.

An optional account makes the user's accumulated work more useful through connected
context, continuity, and collaboration. The intended distinction is:

| Account-free personal work | Optional connected account |
| --- | --- |
| Local projects, files, notes, recordings and recovery | Cross-device access and cloud recovery |
| Explicitly selected material for the immediate task, when an engine is available | Relevant context across authorized project history and connected sources |
| Search on this computer | Search connected documents, transcripts and decisions |
| Manual organization and file export | Shared projects, collaboration and controlled access |
| Local capture and editing | Hosted transcription/AI and connected conversation continuity |

Do not remove all useful context from the local experience. A person can select
materials for the task at hand. Broader context remains transparent and scoped:
an account is not permission to ingest every file or silently expand an agent's
context. Display what material an action will use and preserve user control.

Invite account creation at a requested benefit: continue on another device, use
prior project conversations, connect another source, or collaborate. Explain the
benefit and what will be uploaded. Do not force signup to recover existing local
work, block its export, or silently publish the local library on connection.

Transcription/AI availability and economics remain separate decisions. Recording
alone is not proof of offline speech processing. Evaluate whether a local engine
or bounded hosted allowance is needed to make capture useful enough for repeat
use; this approval does not select a model, provider, pricing, quota, or new identity
system. A simple account experience should not require learning the Graph website.

Product validation should observe whether people complete useful work before
signup, return to continue the same project, and voluntarily choose a connected
benefit. The first [local library implementation](local-work-library.md) now covers
projects, notes, inbox, native editing/recovery, moves, search and Markdown export.
[Local audio capture/playback/export](local-recordings.md) also has source and
automated coverage. Physical-device acceptance, model integration, sync, packaged
acceptance and retention results are not established by these changes.

## Document structure and voice-note destinations

Owner clarification on 2026-09-12: VectorVoice notes are content in VectorGraph
documents. A document contains internal tabs, distinct from open editor tabs.
For each new typed note or recording/transcript, offer three destinations:

- Append on the next page of a selected tab in an existing document.
- Create a new tab inside an existing document.
- Create a new document.

Capture may still start before a destination or project is selected. Keep that
capture durable in Inbox and allow filing during or after processing. Choosing or
changing a destination must not restart recording/transcription. Preserve audio,
source identity, timestamps and prior edits; retry must not append the same content
or create a tab/document twice. Project membership belongs to the containing
document and remains independent of its tab/page structure.

Use this same document concept in the account-free local library, with an optional
mapping to a shared Graph document. Existing local notes must migrate without loss
into documents with an initial tab; do not require signup or duplicate the notes.
Appending on a new page must preserve existing content and a durable page boundary,
not overwrite the whole document or treat a visual line wrap as a saved page.
The exact rich-content/page representation must follow the Graph-owned API design.

The local implementation now exposes internal tabs and the three new-content
destinations through service APIs and native pickers. Existing notes retain their
identity as each document's first tab. Recording starts can retain a selected
document/tab/page reference, and existing local recordings can be filed into a new
destination during or after capture without restarting audio. Local page boundaries currently use Markdown markers,
not a rich paginated layout. The native Graph adapter still saves a document body;
shared Graph tab/page APIs, hosted transcript filing,
rich editor navigation and full desktop acceptance remain open. See the
[local library implementation](local-work-library.md) for exact evidence and limits.

## Implementation sequence and acceptance

The approved entry model comes first: implement a durable local project/note/inbox
service behind explicit APIs, connect it to native editing and recovery, then
complete local recording/playback and basic organization/search/export. Verify
repeated capture, edit, move, reopen, and export with no Graph credential and no
network dependency. Preserve the existing IDE and per-folder state.

The connected document/agent milestone remains required through the existing API
path below. It must not gate basic local work. Add hosted processing and richer
context only with an explicit connection; record local-to-shared mapping and
recoverable outcomes. Account creation, sharing, sync and Voice auth still need
concrete contracts and validation.

1. Create or open a work project without a repository, or start an unassigned note
   in the inbox and choose its project later.
2. Add a brief or other source document.
3. Select context and ask an agent to draft a document.
4. Save it as a project-linked artifact and open it in an editor.
5. Revise directly and with agent assistance; preserve concurrent changes and
   previous versions instead of silently overwriting them.
6. Close/reopen and recover saved work and unsaved drafts.
7. Explain permission denials, generation/save failures, cancellation, uncertain
   completion, and retry without duplicate artifacts or revisions.

The first bounded native slice opens **existing** VectorGraph projects using
**VectorGraph: Open Work Project**, with or without local folders.
**VectorGraph: Show Work Project** groups its document actions and folder resources
in one picker. **Manage Folders** associates zero-to-many folders already open in
the window and retains previously associated closed folders. Removing an association
does not close/delete a folder or delete the work project. It reuses **New Document**
and **Open Document**, native Markdown text editing, Save, and hot-exit recovery.
New project creation is available in the web client; native project creation is
not included in this slice. Command-palette entry is an initial integration point,
not acceptance of the final non-development navigation. Integrate visible project
navigation with the independently owned VC-60 shell after its candidate is ready.

The native capability level is direct Markdown source editing with the existing
editor infrastructure. It is not a native rich text, spreadsheet, presentation, or
design editor. Preserve the useful web rich document client. Choose native/web
scope by workflow priority rather than reproducing every API surface.

## Agent and voice boundary

Owner confirmed the combined desktop direction: VectorCode supplies one desktop
surface, and recording/transcription from VectorVoice becomes a work capability
inside that surface. The existing Voice application remains functional during
migration. The first integrated voice flow is record with an optional project, stop/cancel,
transcribe, review the transcript, and file it now or later. A later draft/revision
uses explicitly selected context and saves through Graph.
Live spoken responses and barge-in follow separately; they are not implemented by
the existing recording/transcription pipeline. Frontends consume versioned Voice
HTTP contracts rather than importing its services or provider implementations.

Current source removed VectorCode's chat/Codex runtime. Do not restore it or
reactivate retired profiles by implication. The execution choice must be explicit:
a bounded adapter to a configured external agent, or a newly scoped built-in text
surface. A configuration catalogue is not an executing agent. Preserve this
boundary while implementing project selection and persistence independently.

Local recording/playback belongs to the account-free core. Agent-assisted voice
follows the stable document/action workflow. Capture may start without a project;
when applying a document action, explicitly select its destination and context,
and submit the same authorized
document action as text. Report the returned artifact/revision. Interruption must
stop generation before dispatch, and an interrupted in-flight write must be shown
as uncertain until reconciled using the original operation identity. Never claim
cancellation rolled back an already committed document.

The audit found batch/chunked transcription and meeting intelligence in
VectorVoice, not a small reusable realtime conversation/action runtime. Voice is
therefore the immediate processing follow-up; it must not block local notes or
recording/playback while its service contract is developed.

## Capture first, organize later

Owner clarification: notes and recordings/transcripts must not require choosing a
project before capture. An **Inbox / Unassigned** area keeps saved items available
until the user files them. Assignment can happen during a recording, during
transcription, or after completion without restarting capture or processing.
Unassigned means no project relationship. Local items remain local until explicitly
connected. Hosted items retain their workspace/team authorization and actual
audience; unassignment does not make them public or automatically private.
Do not widen hosted visibility by clearing team scope.

A user can move a note or transcript from one project to another, return it to
unassigned, or explicitly link the same item to another project. **Move** replaces
the chosen source-project relationship; **Add to project** retains existing
relationships. Neither operation duplicates content, reprocesses audio, changes
stable item identity, discards edits/history, or replaces unrelated links.

Local moves stay within the local library. The initial hosted move flow stays
within an authorized workspace and preserves the
item's existing visibility. Cross-workspace or visibility-changing transfers need
an explicit transfer design; ordinary project organization is not permission to
copy data across tenants. Recheck source/destination access and current revision,
retain one operation identity on retries, and preserve the previous assignment
when permission, conflict, or cancellation prevents the move. Reconcile uncertain
completion before offering another mutation.

The native draft now includes **New Note Without a Project** and **Browse Team
Documents**, through the existing document create/list APIs and native editor.
This supports saving/reopening notes before project selection. It does not yet
provide recording capture, authoritative inbox filtering, or move/link controls.
Those require the service-side contracts described in the architecture decision.

## Later sequence and delivery limits

Next: a budget spreadsheet and a chart derived from its data. Later: a presentation
from the document, budget, and chart. Scope image generation, diagrams, and editable
interface design independently. Generation, preview, export, and full direct editing
are distinct capabilities and must be described accurately.

Preserve the complete local IDE without a mandatory cloud dependency. Keep Git
histories, dependency managers, databases, packages, deployments, and release gates
separate. No new major dependency, editor framework, provider, production deploy,
public API/package rename, or feature deletion is part of this first slice.

This direction supersedes development-only framing and blanket non-billing native
API parity. Existing security, tenancy, licensing, review, CI, merge, and release
requirements remain in force. Milestone completion requires source, deterministic
checks, independent review, packaged functionality, and authorized runtime evidence;
a local mock test or historical release is not equivalent to that evidence.
