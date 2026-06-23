import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isPublicRoute, sendPublicFile } from './public-files.mjs';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const DEFAULT_MANIFEST_PATH = new URL('./manifest.example.json', import.meta.url);
const CACHE_TTL_MS = Number.parseInt(process.env.VECTOR_UPDATE_FEED_CACHE_TTL_MS ?? '30000', 10);
const DEFAULT_DOWNLOAD_PLATFORM = process.env.VECTOR_CODE_DOWNLOAD_PLATFORM ?? 'darwin-arm64';
const DEFAULT_DOWNLOAD_QUALITY = process.env.VECTOR_CODE_DOWNLOAD_QUALITY ?? 'stable';
const MANIFEST_SOURCE_FILE = 'file';
const MANIFEST_SOURCE_JSON = 'json';
const MANIFEST_SOURCE_URL = 'url';

let cachedManifest;
let cachedAt = 0;

export function resetVectorUpdateFeedCache() {
  cachedManifest = undefined;
  cachedAt = 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid update feed: ${name} must be a non-empty string`);
  }

  return value;
}

function assertNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid update feed: ${name} must be a finite number`);
  }

  return value;
}

function parseAsset(value, name) {
  if (!isRecord(value)) {
    throw new Error(`Invalid update feed: ${name} must be an object`);
  }

  const asset = {
    url: assertString(value.url, `${name}.url`)
  };

  if (value.sha256hash !== undefined) {
    asset.sha256hash = assertString(value.sha256hash, `${name}.sha256hash`);
  }

  if (value.size !== undefined) {
    asset.size = assertNumber(value.size, `${name}.size`);
  }

  return asset;
}

function parseRelease(value, index) {
  if (!isRecord(value)) {
    throw new Error(`Invalid update feed: releases[${index}] must be an object`);
  }

  if (!isRecord(value.assets)) {
    throw new Error(`Invalid update feed: releases[${index}].assets must be an object`);
  }

  const assets = {};
  for (const [platform, asset] of Object.entries(value.assets)) {
    assets[assertString(platform, `releases[${index}].assets key`)] = parseAsset(asset, `releases[${index}].assets.${platform}`);
  }

  if (Object.keys(assets).length === 0) {
    throw new Error(`Invalid update feed: releases[${index}].assets must contain at least one platform`);
  }

  return {
    version: assertString(value.version, `releases[${index}].version`),
    commit: assertString(value.commit, `releases[${index}].commit`),
    quality: assertString(value.quality, `releases[${index}].quality`),
    timestamp: assertNumber(value.timestamp, `releases[${index}].timestamp`),
    assets
  };
}

export function parseVectorUpdateFeed(value) {
  if (!isRecord(value)) {
    throw new Error('Invalid update feed: root must be an object');
  }

  if (value.schemaVersion !== 1) {
    throw new Error('Invalid update feed: schemaVersion must be 1');
  }

  if (!Array.isArray(value.releases)) {
    throw new Error('Invalid update feed: releases must be an array');
  }

  return {
    schemaVersion: 1,
    releases: value.releases.map((release, index) => parseRelease(release, index))
  };
}

function getReleaseAsset(release, platform) {
  return release.assets[platform]
    ?? (platform === 'darwin' || platform === 'darwin-arm64' ? release.assets['darwin-universal'] : undefined);
}

function selectLatestRelease(feed, platform, quality) {
  return feed.releases
    .filter(release => release.quality === quality && getReleaseAsset(release, platform))
    .sort((a, b) => b.timestamp - a.timestamp || b.version.localeCompare(a.version))[0];
}

export function selectLatestDownload(feed, platform = DEFAULT_DOWNLOAD_PLATFORM, quality = DEFAULT_DOWNLOAD_QUALITY) {
  const release = selectLatestRelease(feed, platform, quality);
  if (!release) {
    return undefined;
  }

  const asset = getReleaseAsset(release, platform);
  if (!asset) {
    return undefined;
  }

  return { release, asset };
}

export function resolveVectorUpdate(feed, request) {
  const latest = selectLatestRelease(feed, request.platform, request.quality);
  if (!latest || latest.commit === request.commit || latest.version === request.commit) {
    return { statusCode: 204 };
  }

  const asset = getReleaseAsset(latest, request.platform);
  if (!asset) {
    return { statusCode: 204 };
  }

  return {
    statusCode: 200,
    body: {
      version: latest.commit,
      productVersion: latest.version,
      timestamp: latest.timestamp,
      url: asset.url,
      ...(asset.sha256hash ? { sha256hash: asset.sha256hash } : {})
    }
  };
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be set when VECTOR_UPDATE_FEED_SOURCE=${process.env.VECTOR_UPDATE_FEED_SOURCE}`);
  }

  return value;
}

async function readManifestFile() {
  return readFile(process.env.VECTOR_UPDATE_FEED_PATH ?? DEFAULT_MANIFEST_PATH, 'utf8');
}

async function readManifestUrl() {
  const manifestUrl = readRequiredEnv('VECTOR_UPDATE_FEED_URL');
  const response = await fetch(manifestUrl, {
    headers: { 'accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch update manifest: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function readManifestSource() {
  const source = (process.env.VECTOR_UPDATE_FEED_SOURCE ?? MANIFEST_SOURCE_FILE).trim().toLowerCase();
  switch (source) {
    case MANIFEST_SOURCE_FILE:
      return readManifestFile();
    case MANIFEST_SOURCE_JSON:
      return readRequiredEnv('VECTOR_UPDATE_FEED_JSON');
    case MANIFEST_SOURCE_URL:
      return readManifestUrl();
    default:
      throw new Error(`Invalid VECTOR_UPDATE_FEED_SOURCE: ${source}`);
  }
}

async function loadManifest() {
  const now = Date.now();
  if (cachedManifest && now - cachedAt < CACHE_TTL_MS) {
    return cachedManifest;
  }

  const manifest = parseVectorUpdateFeed(JSON.parse(await readManifestSource()));
  cachedManifest = manifest;
  cachedAt = now;
  return manifest;
}

function sendJson(request, response, statusCode, body) {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
}

function sendNoContent(response) {
  response.writeHead(204, { 'cache-control': 'no-store' });
  response.end();
}

function sendRedirect(response, location) {
  response.writeHead(302, {
    'cache-control': 'no-store',
    location
  });
  response.end();
}

function sendNotFound(request, response) {
  sendJson(request, response, 404, { error: 'not_found' });
}

function sendDownloadUnavailable(request, response) {
  sendJson(request, response, 503, { error: 'download_unavailable' });
}

export function createUpdateFeedServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' });
        response.end();
        return;
      }

      if (url.pathname === '/healthz') {
        sendJson(request, response, 200, { ok: true, service: 'vector-code-update-feed' });
        return;
      }

      if (url.pathname === '/download' || url.pathname === '/download/macos' || url.pathname === '/download/macos-arm64') {
        const download = selectLatestDownload(await loadManifest());
        if (!download) {
          sendDownloadUnavailable(request, response);
          return;
        }

        sendRedirect(response, download.asset.url);
        return;
      }

      if (isPublicRoute(url.pathname) && await sendPublicFile(request, response, url.pathname)) {
        return;
      }

      const match = url.pathname.match(/^\/api\/update\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (!match) {
        sendNotFound(request, response);
        return;
      }

      const [, platform, quality, commit] = match.map(decodeURIComponent);
      const result = resolveVectorUpdate(await loadManifest(), { platform, quality, commit });

      if (result.statusCode === 204) {
        sendNoContent(response);
        return;
      }

      sendJson(request, response, 200, result.body);
    } catch (error) {
      console.error(error);
      sendJson(request, response, 500, { error: 'update_feed_error' });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createUpdateFeedServer().listen(PORT, () => {
    console.log(`Vector Code update feed listening on ${PORT}`);
  });
}
