# VectorCode Update Feed Reference

## Endpoint Contract

The desktop app builds update URLs as:

```text
<product.updateUrl>/api/update/<platform>/<quality>/<commit>
```

`product.json` currently sets:

```text
updateUrl: https://vectorcode.app
downloadUrl: https://vectorcode.app/download
quality: stable
```

The update-feed service returns:

- `204` when no compatible newer release exists, or when latest release `commit` equals the requesting app commit.
- `200` JSON when a compatible release exists:
  ```json
  {
    "version": "<release commit>",
    "productVersion": "<release version>",
    "timestamp": 1780247559504,
    "url": "https://vectorcode.app/releases/<version>/<asset>",
    "sha256hash": "<sha256>"
  }
  ```

The workbench shows `Download Update` when update state becomes `available for download`.

## Manifest Source

The deployed `services/update-feed/manifest.example.json` file is the default source of truth. Environment-based manifests are explicit overrides only:

- `VECTOR_UPDATE_FEED_SOURCE=file` or unset: read the deployed manifest file.
- `VECTOR_UPDATE_FEED_SOURCE=json`: read `VECTOR_UPDATE_FEED_JSON`.
- `VECTOR_UPDATE_FEED_SOURCE=url`: fetch `VECTOR_UPDATE_FEED_URL`.

Do not rely on `VECTOR_UPDATE_FEED_JSON` being present by itself. It is ignored unless `VECTOR_UPDATE_FEED_SOURCE=json`, which prevents stale production env data from silently hiding a newly deployed release manifest.

## Manifest Shape

`services/update-feed/manifest.example.json` uses:

```json
{
  "schemaVersion": 1,
  "releases": [
    {
      "version": "1.122.1",
      "commit": "<built app commit>",
      "quality": "stable",
      "timestamp": 1780247559504,
      "assets": {
        "darwin-arm64": {
          "url": "https://vectorcode.app/releases/1.122.1/Vector-Code-1.122.1-arm64.dmg",
          "sha256hash": "<sha256>",
          "size": 128060762
        }
      }
    }
  ]
}
```

`darwin-arm64` can fall back to a `darwin-universal` asset. Prefer an exact `darwin-arm64` asset when publishing Apple Silicon-only builds.

## Troubleshooting

- No CTA appears: query the endpoint with the installed app commit. If it returns `204`, the manifest likely has the same commit or no compatible asset.
- Endpoint serves an older release after deploy: verify `VECTOR_UPDATE_FEED_SOURCE` is unset or `file` unless an emergency JSON/URL override is intentional.
- CTA appears but download fails: verify the asset URL with `curl -I <url>` and make sure the hash/size match the uploaded file.
- UI shows same product version: release `version` was not bumped, even if the commit changed. Pass `--version` to `npm run vector-release-update`.
- Local testing needs a static file: run `npm run vector-release-update -- --artifact <dmg> --version <version> --copy-to-public`.
