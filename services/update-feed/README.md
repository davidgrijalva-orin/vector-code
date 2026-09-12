# VectorCode update ordering

Automatic updates require the installed commit to be present in the manifest for
its quality and platform (including macOS universal fallback). A candidate must
have a strictly greater release timestamp. Unknown/local builds, version-only
identities, equal timestamps, and ambiguous latest releases receive HTTP 204.
Download pages continue to offer the latest compatible published artifact.

Keep historical release entries for every supported upgrade origin. Removing an
entry disables automatic upgrades from that build; it must never cause a guessed
upgrade. Timestamp is the immutable, increasing publication order within a quality
channel. Commit identifies the exact source. Version labels alone cannot establish
ordering, especially for historical builds that share a version.

Use `scripts/vector-release-update.mjs` for release preparation. It retains history,
rejects reusing a version for another commit or a commit under another version,
requires increasing timestamps for new releases, and preserves the timestamp when
adding another platform to an existing release. Publish each artifact with its
actual source commit, distinct release version, URL and checksum. Never relabel an
old artifact with a new commit.

Validate changes with:

```sh
node --test services/update-feed/server.test.mjs scripts/vector-release-update.test.mjs
```

After deploying, check an unknown/newer local commit returns 204 with no body,
a known older compatible commit returns the correct newer artifact, and the latest
published commit returns 204. Keep local update checks disabled until the live
service is verified; merging source does not update an already-running service.
