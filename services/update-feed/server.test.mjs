import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseVectorUpdateFeed, resolveVectorUpdate } from './server.mjs';

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
          url: 'https://releases.vectorcode.com/0.1.1/Vector-Code-darwin-universal.zip',
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
          url: 'https://releases.vectorcode.com/0.1.0/Vector-Code-darwin-arm64.zip'
        }
      }
    }
  ]
});

describe('resolveVectorUpdate', () => {
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
        url: 'https://releases.vectorcode.com/0.1.1/Vector-Code-darwin-universal.zip',
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
});
