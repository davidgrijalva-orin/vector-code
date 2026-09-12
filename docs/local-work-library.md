# Local work library

The desktop client can create projects and notes without a VectorGraph account.
Open **Work: Open Local Work** from the command palette, or **Open Local Work** in
the existing Work view. [Local recording/playback/export](local-recordings.md) now
uses the same note identities. Transcription, publishing/sync and a unified permanent
project rail remain separate work. It does not replace the existing connected Graph document actions.

## Document tabs and page destinations

**Work: New Local Note** offers **Next page**, **New tab**, or **New document**
when saved documents exist. Document actions also offer these choices for new
notes and recordings. The direct **Start Recording in Inbox** command retains its
immediate capture behavior. Open a document to choose one of its internal tabs;
each tab uses the existing native Markdown editor. Search covers all tab titles
and bodies, history is selected per tab, and document export includes every tab.

The local API adds `createTab`, `saveTab` and `appendPage`. Services validate the
selected document/tab and expected revision, commit atomically, and return stable
document/tab/page references. Page and tab retries return the original receipt
without duplication. Saves use independent tab content revisions, so editing a
different tab or moving the containing document does not invalidate a dirty draft.
The append action refuses a currently dirty target tab; same-tab concurrent saves
still fail the service revision check without overwriting either draft.

For compatible replay, the existing note body is the first tab, with the existing
note ID, content revision, history and editor URI. Additional tabs have their own
IDs, titles, bodies and histories in `additionalTabs`. `localDocumentTabs` provides
the ordered tab projection without duplicating the original body in storage.
Existing journal events are replayed unchanged; simply reading an older library
does not rewrite it. Older binaries fail closed on unsupported new mutations;
this is not a downgrade conversion. Limits are 100 tabs per document, one million
characters per tab and the existing 64 MB journal limit.

A local page boundary is a durable Markdown comment containing its append operation
UUID. The editor places the cursor after that boundary. This provides explicit
append/retry identity, not a rich paginated layout or a published Graph content
format. Direct Markdown editing can intentionally remove the boundary; historical
content and recording references remain available. A shared rich document/tab API,
visual page rendering, and filing an already started capture into a different
document/tab remain open. No local-to-Graph upload or transcription is performed.

## API and storage ownership

`IVectorCodeLibraryService` is the client contract. The `vectorCodeLibraryV1` IPC
channel exposes only `read`, `findNotes` and validated `mutate` operations. The
renderer imports the common contract and a thin Electron proxy; a single main
process service owns persistence, revision checks, project membership and retry
receipts. There are no Graph credentials, HTTP calls or shared backend imports in
this service. Local IDs are independent UUIDs, not folder paths or Graph IDs.

The service stores `VectorCode/LocalLibrary/library-v1.json` under the application's
user-data directory. The versioned journal records successful mutations and their
original request IDs. Writes serialize across windows, sync a temporary file and
atomically rename it; POSIX additionally syncs the directory. A lost reply can be
retried after restarting the service without applying the change twice. A failed
write leaves the prior committed state intact. Invalid/future journal formats fail
closed and are not reset or overwritten. Returned objects cannot mutate service
state. The application owns one local library per user-data directory.

The initial implementation deliberately has a 64 MB journal limit and a one-million-
character note limit. Saved versions count toward the journal limit. It rejects
further writes without deleting history. This is a bounded initial store, not a
claim of an unlimited indexed database. Audio has its own bounded storage API.

## Workflows

- Create a local project with no folders. Store zero-to-many deduplicated folder
  references; adding/removing references does not alter files or grant execution
  or workspace trust. **Open project folders** asks which references to open and delegates
  to the existing native workspace/trust controls. Existing IDE folder/terminal state
  remains independently owned.
- Create a note directly in Inbox. Its ID, creation time, text and saved history
  remain stable when linking multiple projects, moving between them or clearing
  all assignments to return it to Inbox. Local inbox classification is authoritative
  because this service owns complete local relationships.
- Edit through the native text-file model and save through a revision-checked API.
  Local notes always use UTF-8. Body revisions and file timestamps are independent
  of project/title metadata, so organizing a dirty note does not cause a false text conflict. Dirty drafts retain their original revision through
  background reads. A conflicting save preserves both saved content and the dirty
  draft. Use the native editor's recovery/revert actions after preserving the draft;
  a clean reload adopts the saved revision and clears the obsolete pending request.
- An uncertain save is retried with its original request before subsequent edits
  are submitted. An uncertain creation/assignment/folder change is offered for
  retry when reopening Local Work; it can also be explicitly dismissed so the
  user can inspect the actual saved state.
- Search full saved note text, titles and project names through the service API.
  Export the current saved body as Markdown using the native Save dialog. Rename notes and projects through revision-checked mutations. Open
  earlier text revisions as separate drafts without overwriting the current note.

## Evidence and limits

The tab/destination increment passed the native TypeScript compiler, client
transpile, changed-file ESLint, architecture layer checks, 29 Node checks and 77
Chromium checks. These include legacy journal replay without rewriting, tab/page
retry after restart, independent tab conflicts, recording destination persistence,
choice cancellation, dirty-target protection, and the real native file-model
save/reopen/conflict/hot-exit recovery for both first and additional tabs.


Automated coverage exercises real filesystem persistence, service reconstruction,
concurrent stale saves, failed writes, request reuse, corruption, IPC validation,
search beyond the displayed snippet, and caller isolation. Browser coverage checks
account-free commands with no Graph service registered, cancellation, creation
retries, UTF-8, native editing/save/reopen, conflict preservation and hot-exit draft
backup recovery. Mocked editor tests do not prove a complete application restart.

A development app was launched from the branch with separate user-data, shared-data
and extension directories. Desktop visual acceptance is blocked while the Mac is
locked. Initial extension activation issues were resolved by linking the existing
extension dependencies and compiling GitHub with its NodeNext configuration; the
subsequent isolated startup log is clean. Packaged acceptance remains open, and
source tests and startup logs are not a packaged release result. No production
workspace has been used for mutation QA, and no local material is uploaded on sign-in.
