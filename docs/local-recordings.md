# Local audio attached to work

The desktop client can start **Work: Start Recording in Inbox** without choosing a
project or entering a title. It creates a normal local note with an automatic title,
then requests microphone access through the device capability API. The same capture
action is available inside an existing note. Notes can be renamed, filed, linked to
multiple projects or returned to Inbox while recording; audio remains attached to
the stable note ID. No Graph account, Voice account or network request is required.

A sticky recording notice exposes Stop; closing it also stops capture. The command
palette additionally exposes **Work: Stop Local Recording**. A note's **Play or
export recordings** action lists its captures and can play or export saved WebM
bytes. **Work: Stop Audio Playback** stops the local player. An unfinished capture
is identified as unfinished, not reported as a completed recording.

## API and ownership

`IVectorCodeAudioService` is the browser-side device capability API. Its adapter
uses the existing Electron/Chromium media stack, requests audio only, limits its
pending byte queue, and releases microphone tracks on stop, failure, permission
failure, device end and disposal. It does not own an artifact database or invoke a
provider. The existing Electron media permission policy is unchanged.

`IVectorCodeRecordingsService`, through the explicit `vectorCodeRecordingsV1` IPC
channel, owns `begin`, ordered `append`, `finish`, `list` and `read`. Only validated
recording IDs, note IDs, supported audio MIME types, sequence numbers and binary
buffers cross this boundary. The channel does not expose arbitrary filesystem paths
or methods. Note existence is checked through the local library service.

Recordings live under `VectorCode/Recordings` in the application's user-data
directory, separate from the text journal. Each recording has a versioned manifest
and ordered chunks. A chunk is synced and atomically committed before its hash/size
is added to the manifest. The manifest uses the same atomic-file helper as the
local note library. Replies are issued after persistence. Repeating a chunk with
the same sequence and bytes does not duplicate it; different bytes or missing
prior chunks are rejected. Read verifies committed chunk sizes and hashes.

The initial limits are 4 MB per chunk, 128 MB per recording, 86,400 chunks and an
8 MB client queue. Exceeding a limit stops capture and reports a failure while
preserving previously committed audio. A recording with no captured audio is not
reported as successfully finalized. No automatic deletion or truncation occurs.

A crash or storage failure can leave an unfinished recording. Its successfully
committed chunks remain available for read/export. This is partial recovery, not
resumption of the original microphone session, and does not promise preservation
of audio still in the device/renderer or an uncommitted manifest update. There is
no background recording after closing the window. A physical-device and packaged
restart acceptance test remains necessary before release.

## Reuse and remaining boundaries

The VectorVoice source audit found native Swift capture implementations, meeting
transcription and intelligence APIs; it did not find an existing browser
MediaRecorder adapter to reuse in the cross-platform Electron client. This bounded
adapter uses the app's existing media stack and adds no dependency or provider.
It is local capture, not a second hosted transcript or intelligence service.
VectorVoice still owns its existing meetings, transcripts, processing and grants.
Project-aware transcription, document generation and shared action receipts require
an explicit integration contract and provider/runner choice.

The text service now distinguishes content revisions/timestamps from project/title
metadata revisions. Filing or renaming an open note does not change its text-file
etag or invalidate a dirty body draft. Actual concurrent body edits still fail a
content-revision check. Legacy full-record revision saves remain compatible with
previous journal entries. Pending native save requests are flushed before the
service call and retain their identity until acknowledged.

## Validation scope

Node tests cover durable chunks/manifests, restart, assignment while recording,
ordered writes, duplicate/mismatched retries, premature/empty completion, failed
manifest commits, corrupted chunks, caller buffer isolation and API validation.
Browser tests cover final-chunk ordering, retry identity, storage failure,
permission denial, preventing a second active capture, microphone release and a
real WebM encode/decode round trip using a synthetic Web Audio source. The synthetic
test does not access a physical microphone or prove speakers/OS permissions.

Desktop visual and physical-device acceptance is pending because the Mac is locked.
The independent reviewer cannot run under the skill's required read-only parent
permission mode in this session. Neither source tests nor the synthetic codec test
is a claim that the full unified application has been released or accepted.
