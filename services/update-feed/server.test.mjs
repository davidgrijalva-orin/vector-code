import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  createUpdateFeedServer,
  parseVectorUpdateFeed,
  resetVectorUpdateFeedCache,
  resolveVectorUpdate,
  selectLatestDownload
} from './server.mjs';

const feed = parseVectorUpdateFeed({
  schemaVersion: 1,
  releases: [
    {
      version: '0.1.1',
      commit: 'new-commit',
      quality: 'stable',
      timestamp: 200,
      assets: {
        'darwin-universal': {
          url: 'https://vectorcode.app/releases/0.1.1/Vector-Code-darwin-universal.zip',
          sha256hash: 'abc'
        }
      }
    },
    {
      version: '0.1.0',
      commit: 'old-commit',
      quality: 'stable',
      timestamp: 100,
      assets: {
        'darwin-arm64': {
          url: 'https://vectorcode.app/releases/0.1.0/Vector-Code-darwin-arm64.zip'
        }
      }
    }
  ]
});

describe('resolveVectorUpdate', () => {
  it('selects the latest platform-compatible download asset', () => {
    assert.deepEqual(selectLatestDownload(feed, 'darwin-arm64', 'stable'), {
      release: feed.releases[0],
      asset: {
        url: 'https://vectorcode.app/releases/0.1.1/Vector-Code-darwin-universal.zip',
        sha256hash: 'abc'
      }
    });
  });

  it('returns 204 when current commit already matches latest release', () => {
    assert.deepEqual(resolveVectorUpdate(feed, {
      platform: 'darwin-arm64',
      quality: 'stable',
      commit: 'new-commit'
    }), { statusCode: 204 });
  });

  it('returns the latest platform-compatible release', () => {
    assert.deepEqual(resolveVectorUpdate(feed, {
      platform: 'darwin-arm64',
      quality: 'stable',
      commit: 'old-commit'
    }), {
      statusCode: 200,
      body: {
        version: 'new-commit',
        productVersion: '0.1.1',
        timestamp: 200,
        url: 'https://vectorcode.app/releases/0.1.1/Vector-Code-darwin-universal.zip',
        sha256hash: 'abc'
      }
    });
  });

  it('returns 204 when no asset exists for the requested platform', () => {
    assert.deepEqual(resolveVectorUpdate(feed, {
      platform: 'win32-x64-user',
      quality: 'stable',
      commit: 'old-commit'
    }), { statusCode: 204 });
  });

  it('treats the product version as current when commit metadata is unavailable', () => {
    assert.deepEqual(resolveVectorUpdate(feed, {
      platform: 'darwin-arm64',
      quality: 'stable',
      commit: '0.1.1'
    }), { statusCode: 204 });
  });
});

describe('createUpdateFeedServer', () => {
  it('serves the landing page and download redirect', async () => {
    await withUpdateFeedServer(updateFeedManifest('0.1.5', 'landing-commit', 600), async origin => {
      const landing = await fetch(`${origin}/`);
      assert.equal(landing.status, 200);
      assert.match(landing.headers.get('content-type'), /text\/html/);
      assert.match(await landing.text(), /Vector Code/);

      const styles = await fetch(`${origin}/styles.css`, { method: 'HEAD' });
      assert.equal(styles.status, 200);
      assert.equal(await styles.text(), '');
      assert.match(styles.headers.get('content-type'), /text\/css/);

      const sections = await fetch(`${origin}/sections.css`, { method: 'HEAD' });
      assert.equal(sections.status, 200);
      assert.equal(await sections.text(), '');
      assert.match(sections.headers.get('content-type'), /text\/css/);

      const download = await fetch(`${origin}/download`, { redirect: 'manual' });
      assert.equal(download.status, 302);
      assert.equal(download.headers.get('location'), 'https://vectorcode.app/releases/0.1.5/Vector-Code-darwin-universal.zip');
    });
  });

  it('serves health and HEAD update checks without response bodies', async () => {
    await withUpdateFeedServer({
      schemaVersion: 1,
      releases: [
        {
          version: '0.1.2',
          commit: 'next-commit',
          quality: 'stable',
          timestamp: 300,
          assets: {
            'darwin-universal': {
              url: 'https://vectorcode.app/releases/0.1.2/Vector-Code-darwin-universal.zip',
              sha256hash: 'def'
            }
          }
        }
      ]
    }, async origin => {
      const health = await fetch(`${origin}/healthz`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true, service: 'vector-code-update-feed' });

      const update = await fetch(`${origin}/api/update/darwin-arm64/stable/old-commit`, { method: 'HEAD' });
      assert.equal(update.status, 200);
      assert.equal(await update.text(), '');
      assert.equal(update.headers.get('cache-control'), 'no-store');
      assert.match(update.headers.get('content-type'), /application\/json/);
    });
  });

  it('rejects unsupported methods before loading a manifest', async () => {
    await withUpdateFeedServer({ schemaVersion: 1, releases: [] }, async origin => {
      const response = await fetch(`${origin}/healthz`, { method: 'POST' });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.equal(await response.text(), '');
    });
  });

  it('keeps manifest cache isolated when tests swap feed sources', async () => {
    await withUpdateFeedServer(updateFeedManifest('0.1.3', 'first-commit', 400), async origin => {
      const response = await fetch(`${origin}/api/update/darwin-arm64/stable/old-commit`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).version, 'first-commit');
    });

    await withUpdateFeedServer(updateFeedManifest('0.1.4', 'second-commit', 500), async origin => {
      const response = await fetch(`${origin}/api/update/darwin-arm64/stable/old-commit`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).version, 'second-commit');
    });
  });

  it('uses the deployed manifest file by default even when stale env JSON exists', async () => {
    await withTemporaryManifestFile(updateFeedManifest('0.1.6', 'file-commit', 700), async manifestPath => {
      await withManifestEnv({
        VECTOR_UPDATE_FEED_PATH: manifestPath,
        VECTOR_UPDATE_FEED_JSON: JSON.stringify(updateFeedManifest('0.1.5', 'env-commit', 600)),
        VECTOR_UPDATE_FEED_SOURCE: undefined
      }, async () => {
        await withRunningUpdateFeedServer(async origin => {
          const response = await fetch(`${origin}/api/update/darwin-arm64/stable/old-commit`);
          assert.equal(response.status, 200);
          assert.equal((await response.json()).version, 'file-commit');
        });
      });
    });
  });
});

function updateFeedManifest(version, commit, timestamp) {
  return {
    schemaVersion: 1,
    releases: [
      {
        version,
        commit,
        quality: 'stable',
        timestamp,
        assets: {
          'darwin-universal': {
            url: `https://vectorcode.app/releases/${version}/Vector-Code-darwin-universal.zip`
          }
        }
      }
    ]
  };
}

async function withUpdateFeedServer(manifest, run) {
  await withManifestEnv({
    VECTOR_UPDATE_FEED_JSON: JSON.stringify(manifest),
    VECTOR_UPDATE_FEED_SOURCE: 'json'
  }, async () => {
    await withRunningUpdateFeedServer(run);
  });
}

async function withRunningUpdateFeedServer(run) {
  resetVectorUpdateFeedCache();

  const server = createUpdateFeedServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    resetVectorUpdateFeedCache();
  }
}

async function withManifestEnv(nextEnv, run) {
  const keys = Object.keys(nextEnv);
  const previousEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  resetVectorUpdateFeedCache();

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetVectorUpdateFeedCache();
  }
}

async function withTemporaryManifestFile(manifest, run) {
  const directory = await mkdtemp(join(tmpdir(), 'vector-update-feed-'));
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

  try {
    await run(manifestPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
