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
semantics. Neither document access nor voice access grants local file, terminal,
device, or credential access.

The existing desktop model equates one folder with one project. Migrating that
navigation to one work project with multiple folder resources is required; merely
linking two separately displayed folder projects to the same Graph project does not
complete the desktop grouping experience. Preserve each folder's editor/terminal
state and separately authorized local access during that migration.

## First milestone

1. Create or open a work project without a repository.
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
surface, and recording/transcription from VectorVoice becomes a project capability
inside that surface. The existing Voice application remains functional during
migration. The first integrated voice flow is record, stop/cancel, transcribe,
review the transcript, draft/revise a selected document, and save through Graph.
Live spoken responses and barge-in follow separately; they are not implemented by
the existing recording/transcription pipeline. Frontends consume versioned Voice
HTTP contracts rather than importing its services or provider implementations.

Current source removed VectorCode's chat/Codex runtime. Do not restore it or
reactivate retired profiles by implication. The execution choice must be explicit:
a bounded adapter to a configured external agent, or a newly scoped built-in text
surface. A configuration catalogue is not an executing agent. Preserve this
boundary while implementing project selection and persistence independently.

Voice follows the completed text workflow. Associate capture/conversation with the
active project, explicitly select the document, and submit the same authorized
document action as text. Report the returned artifact/revision. Interruption must
stop generation before dispatch, and an interrupted in-flight write must be shown
as uncertain until reconciled using the original operation identity. Never claim
cancellation rolled back an already committed document.

The audit found batch/chunked transcription and meeting intelligence in
VectorVoice, not a small reusable realtime conversation/action runtime. Voice is
therefore the immediate follow-up rather than a prerequisite for this milestone.

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
