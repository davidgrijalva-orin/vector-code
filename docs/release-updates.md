# Vector Code Release Updates

Vector Code uses the native workbench update service. A packaged build checks:

```text
GET https://vectorcode.app/api/update/:platform/:quality/:commit
```

The `product.json` release fields are:

```json
{
	"quality": "stable",
	"downloadUrl": "https://vectorcode.app/download",
	"updateUrl": "https://vectorcode.app"
}
```

Release versions are managed with git tags and `package.json`:

```text
v0.1.0
v0.1.1
v0.2.0
```

The packaged app embeds the build commit and product version during the existing package step. The update feed compares the embedded commit with the latest released commit for the requested platform and channel.

When the update service reports a downloadable or ready-to-install update, Vector Code shows a compact download/update action in the top-right chrome, between Settings and Terminal. Closing the terminal panel does not affect update detection; the action only appears when the update state is actionable.

## Feed Manifest

The feed source should be published by CI after signed artifacts are uploaded:

```json
{
	"schemaVersion": 1,
	"releases": [
		{
			"version": "0.1.1",
			"commit": "abc123releasecommit",
			"quality": "stable",
			"timestamp": 1779553124000,
			"assets": {
				"darwin-arm64": {
					"url": "https://releases.vectorcode.com/0.1.1/Vector-Code-darwin-arm64.zip",
					"sha256hash": "..."
				},
				"win32-x64-user": {
					"url": "https://releases.vectorcode.com/0.1.1/Vector-Code-0.1.1-win32-x64-user-setup.exe",
					"sha256hash": "..."
				},
				"win32-x64": {
					"url": "https://releases.vectorcode.com/0.1.1/Vector-Code-0.1.1-win32-x64-system-setup.exe",
					"sha256hash": "..."
				},
				"win32-x64-archive": {
					"url": "https://releases.vectorcode.com/0.1.1/Vector-Code-0.1.1-win32-x64.zip",
					"sha256hash": "..."
				},
				"linux-arm64": {
					"url": "https://releases.vectorcode.com/0.1.1/Vector-Code-linux-arm64.tar.gz",
					"sha256hash": "..."
				}
			}
		}
	]
}
```

Run a local feed response check with:

```sh
npm run vector-update-feed -- -- --manifest .build/vector-update-feed.json --platform darwin-arm64 --quality stable --commit <current-commit>
```

The command prints the JSON body expected by the update service, or `204` when the app is already current.

## Windows x64 Release

Use `.github/workflows/windows-x64-release.yml` to build the Windows user installer, system installer, and ZIP archive. The workflow publishes the assets to the requested GitHub Release, then writes all three Windows platform assets into `services/update-feed/manifest.example.json` with the built `github.sha`.

Local Windows package builds need the repo Node version from `.nvmrc`, Visual Studio C++ Build Tools with the matching Spectre-mitigated x64/x86 libraries installed, Windows SDK tools (`signtool.exe` and `makeappx.exe`) on `PATH`, and 7-Zip (`7z.exe`) on `PATH`. Without the Spectre libraries, native package rebuilds fail during `npm ci`; without the SDK tools or 7-Zip, packaging fails after the client build succeeds.

If local HTTPS downloads fail with `unable to verify the first certificate` while package downloads work in a browser, run the packaging commands with `NODE_OPTIONS=--use-system-ca` so Node uses the Windows certificate store.

## Railway Feed Service

The deployable Railway service lives in `services/update-feed`. It serves:

```text
GET /healthz
GET /api/update/:platform/:quality/:commit
HEAD /api/update/:platform/:quality/:commit
```

The service reads release data from one explicit source:

1. `VECTOR_UPDATE_FEED_SOURCE=file`, or unset: read `VECTOR_UPDATE_FEED_PATH`, falling back to `services/update-feed/manifest.example.json`.
2. `VECTOR_UPDATE_FEED_SOURCE=json`: read inline manifest JSON from `VECTOR_UPDATE_FEED_JSON`.
3. `VECTOR_UPDATE_FEED_SOURCE=url`: fetch remote JSON from `VECTOR_UPDATE_FEED_URL`.

`VECTOR_UPDATE_FEED_JSON` and `VECTOR_UPDATE_FEED_URL` are ignored unless `VECTOR_UPDATE_FEED_SOURCE` selects them. This keeps stale environment overrides from hiding a newly deployed manifest file.

For the first Railway deployment, set `VECTOR_UPDATE_FEED_SOURCE=json` and `VECTOR_UPDATE_FEED_JSON` to:

```json
{"schemaVersion":1,"releases":[]}
```

That makes the endpoint live while safely returning `204` until the first signed release asset is published.

The app may use `HEAD` for cheap polling. The service returns the same status and headers as `GET`, but no body, so update checks can run without downloading the release payload JSON unless an actionable state needs details.

Production is served from the branded VectorCode domain:

```text
https://vectorcode.app
```

Cloudflare routes the branded hostname to the Railway update-feed service, so product metadata, docs, and packaged builds all use the same public URL.
