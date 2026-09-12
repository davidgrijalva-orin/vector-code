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

## Use without a VectorGraph account — product exploration

Owner requirement: the app must provide useful work for people who do not have a
VectorGraph account. Do not make the connected Graph workflow the universal entry
point. The current PR implements connected-client foundations only.

Proposed experience for discussion: account-free local projects, notes, a capture
inbox, audio recording, ordinary files, local search, and export; an optional Vector
account adds hosted services, backup, sync, and collaboration. Transcription and
generation are separate capabilities: local recording does not prove local speech
or AI processing. A local model, user-configured provider, or hosted Voice service
requires explicit capability and provider evaluation before implementation.

First-run candidate: **New note**, **Record**, **New project**, and **Open folder**.
A person can record a thought, preserve it in the inbox, organize it into a project
later, and produce an editable deliverable. The core value should be evident before
sign-in. Solo researchers, consultants, students, and developers can each use that
sequence; shared Graph work is an optional expansion.

Alternatives to evaluate:

1. Local core with optional hosted services (recommended for discussion): useful
   offline and no signup required; requires durable local project/artifact services
   and a carefully scoped later connection/sync workflow.
2. A simple Vector account for everything: easier cloud recovery and service access,
   while Graph remains behind the API; still requires signup before useful work.
3. Anonymous hosted guest sessions: quick trial, but recovery, retention, abuse,
   and paid AI limits complicate making it a dependable daily work environment.

No account-free library, inbox, recording, transcription, or synchronization is
claimed as delivered by the connected-document PR. Decide whether a completely
account-free first run is required and which hosted capabilities need a Vector
account before committing to those implementation boundaries.

## First milestone

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

Voice follows the completed text workflow. Capture may start without a project;
when applying a document action, explicitly select its destination and context,
and submit the same authorized
document action as text. Report the returned artifact/revision. Interruption must
stop generation before dispatch, and an interrupted in-flight write must be shown
as uncertain until reconciled using the original operation identity. Never claim
cancellation rolled back an already committed document.

The audit found batch/chunked transcription and meeting intelligence in
VectorVoice, not a small reusable realtime conversation/action runtime. Voice is
therefore the immediate follow-up rather than a prerequisite for this milestone.

## Capture first, organize later

Owner clarification: notes and recordings/transcripts must not require choosing a
project before capture. An **Inbox / Unassigned** area keeps saved items available
until the user files them. Assignment can happen during a recording, during
transcription, or after completion without restarting capture or processing.
Unassigned means no project relationship; it does not mean unauthenticated,
public, or automatically private. Use the item's actual workspace/team visibility
and show that audience. Do not widen visibility by clearing its team scope.

A user can move a note or transcript from one project to another, return it to
unassigned, or explicitly link the same item to another project. **Move** replaces
the chosen source-project relationship; **Add to project** retains existing
relationships. Neither operation duplicates content, reprocesses audio, changes
stable item identity, discards edits/history, or replaces unrelated links.

The initial move flow stays within an authorized workspace and preserves the
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
