# Vector Code Release Updates

Vector Code uses the native workbench update service. A packaged build checks:

```text
GET https://updates.vectorcode.com/api/update/:platform/:quality/:commit
```

The `product.json` release fields are:

```json
{
	"quality": "stable",
	"downloadUrl": "https://vectorcode.com/download",
	"updateUrl": "https://updates.vectorcode.com"
}
```

Release versions are managed with git tags and `package.json`:

```text
v0.1.0
v0.1.1
v0.2.0
```

The packaged app embeds the build commit and product version during the existing package step. The update feed compares the embedded commit with the latest released commit for the requested platform and channel.

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
