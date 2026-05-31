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
npm run vector-update-feed -- --manifest .build/vector-update-feed.json --platform darwin-arm64 --quality stable --commit <current-commit>
```

The command prints the JSON body expected by the update service, or `204` when the app is already current.

## Railway Feed Service

The deployable Railway service lives in `services/update-feed`. It serves:

```text
GET /healthz
GET /api/update/:platform/:quality/:commit
HEAD /api/update/:platform/:quality/:commit
```

The service reads release data from one of these sources, in order:

1. `VECTOR_UPDATE_FEED_JSON`: inline manifest JSON.
2. `VECTOR_UPDATE_FEED_URL`: remote JSON manifest URL.
3. `VECTOR_UPDATE_FEED_PATH`: local manifest path.
4. `services/update-feed/manifest.example.json`: local fallback for development.

For the first Railway deployment, set `VECTOR_UPDATE_FEED_JSON` to:

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
