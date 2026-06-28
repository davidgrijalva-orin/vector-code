---
name: vectorcode-release-update
description: Prepare VectorCode desktop release updates and make the in-app Download Update CTA appear. Use when asked to release a new VectorCode version, package or verify macOS update artifacts, update services/update-feed/manifest.example.json, test /api/update responses, publish a new download, or run the VectorCode update-feed release workflow.
---

# VectorCode Release Update

Use this skill to move a desktop fix from source changes to a release manifest entry that the VectorCode app can detect as an available update.

## Core Rules

- The update feed compares the installed app commit to the manifest release commit. If they match, the app gets `204` and no CTA.
- Commit the source changes before packaging. A DMG built from an old commit cannot deliver new source fixes.
- Use a signed and notarized macOS artifact for production. Local unsigned artifacts are only for smoke testing.
- Hash the exact artifact URL users will download. Do not hash a different local rebuild after upload.
- Run `npm run compile-check-ts-native` before release prep, then run narrower checks for changed areas.
- Do not deploy or publish to production without confirming credentials, target environment, and artifact URL.

## One-Command Prep

Prepare or update the manifest entry from a release artifact:

```bash
npm run vector-release-update -- -- \
  --artifact <path-to-signed-dmg> \
  --version <new-version> \
  --platform darwin-arm64 \
  --copy-to-public
```

Use `--dry-run` first when inspecting output. Use `--url <download-url>` instead of `--copy-to-public` when the artifact is already uploaded to external storage.

The command computes `sha256hash` and `size`, updates `services/update-feed/manifest.example.json`, and verifies:

- previous compatible release commit returns update response `200`
- new release commit returns `204`

## Release Workflow

1. Inspect `git status --short` and identify all release-intended changes. Do not include unrelated dirty files unless the user explicitly approves the release scope.
2. Run validation:
   ```bash
   npm run compile-check-ts-native
   npm run monaco-compile-check
   npm run valid-layers-check
   git diff --check
   ```
3. Commit the release changes, or stop and ask if the user has not approved committing.
4. Build/package the macOS artifact. Prefer the established CI release artifact. For local smoke tests, use the repo's Darwin build flow from `build/azure-pipelines/darwin/steps/product-build-darwin-compile.yml`.
5. Run `npm run vector-release-update -- -- --artifact ... --version ...`.
6. Verify the feed locally:
   ```bash
   npm run vector-update-feed -- -- --manifest services/update-feed/manifest.example.json --platform darwin-arm64 --quality stable --commit <old-installed-app-commit>
   npm run vector-update-feed -- -- --manifest services/update-feed/manifest.example.json --platform darwin-arm64 --quality stable --commit <new-release-commit>
   ```
   Expect JSON for the old commit and `204` for the new commit.
7. Deploy or restart the update-feed service only after the artifact URL is reachable.
8. In the app, run `Check for Updates...`. The global activity/titlebar update entry should show `Download Update` when the state is `available for download`.

## Reference

Read `references/update-feed.md` when debugging endpoint behavior, choosing version/commit values, or explaining why the CTA does not appear.
