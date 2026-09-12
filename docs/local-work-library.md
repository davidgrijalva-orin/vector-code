# Local work library

The desktop client can create projects and notes without a VectorGraph account.
Open **Work: Open Local Work** from the command palette, or **Open Local Work** in
the existing Work view. This is the first account-free implementation; recording,
transcription, publishing/sync and a unified permanent project rail remain separate
work. It does not replace the existing connected Graph document actions.

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
claim of an unlimited indexed database or an audio storage implementation.

## Workflows

- Create a local project with no folders. Store zero-to-many deduplicated folder
  references; adding/removing references does not alter files or grant execution
  or workspace trust. Existing IDE folder/terminal state remains independently owned.
- Create a note directly in Inbox. Its ID, creation time, text and saved history
  remain stable when linking multiple projects, moving between them or clearing
  all assignments to return it to Inbox. Local inbox classification is authoritative
  because this service owns complete local relationships.
- Edit through the native text-file model and save through a revision-checked API.
  Local notes always use UTF-8. Dirty drafts retain their original revision through
  background reads. A conflicting save preserves both saved content and the dirty
  draft. Use the native editor's recovery/revert actions after preserving the draft;
  a clean reload adopts the saved revision and clears the obsolete pending request.
- An uncertain save is retried with its original request before subsequent edits
  are submitted. An uncertain creation/assignment/folder change is offered for
  retry when reopening Local Work; it can also be explicitly dismissed so the
  user can inspect the actual saved state.
- Search full saved note text, titles and project names through the service API.
  Export the current saved body as Markdown using the native Save dialog. Open
  earlier text revisions as separate drafts without overwriting the current note.

## Evidence and limits

Automated coverage exercises real filesystem persistence, service reconstruction,
concurrent stale saves, failed writes, request reuse, corruption, IPC validation,
search beyond the displayed snippet, and caller isolation. Browser coverage checks
account-free commands with no Graph service registered, cancellation, creation
retries, UTF-8, native editing/save/reopen, conflict preservation and hot-exit draft
backup recovery. Mocked editor tests do not prove a complete application restart.

A development app was launched from the branch with separate user-data, shared-data
and extension directories. Desktop visual acceptance is blocked while the Mac is
locked. Development extension activation issues and packaged acceptance remain
open; source tests and startup logs are not a packaged release result. No production
workspace has been used for mutation QA, and no local material is uploaded on sign-in.
