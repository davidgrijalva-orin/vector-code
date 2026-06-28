import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_ROOT = fileURLToPath(new URL('./public/', import.meta.url));

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.dmg', 'application/x-apple-diskimage'],
  ['.exe', 'application/vnd.microsoft.portable-executable'],
  ['.html', 'text/html; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.zip', 'application/zip']
]);

export function isPublicRoute(pathname) {
  return pathname === '/'
    || pathname === '/favicon.svg'
    || pathname === '/responsive.css'
    || pathname === '/sections.css'
    || pathname === '/styles.css'
    || pathname.startsWith('/assets/')
    || pathname.startsWith('/releases/');
}

function resolvePublicFile(pathname) {
  const publicPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!publicPath || publicPath.includes('\0')) {
    return undefined;
  }

  const filePath = join(PUBLIC_ROOT, publicPath);
  const relativePath = relative(PUBLIC_ROOT, filePath);
  if (!relativePath || relativePath.startsWith('..') || relativePath.startsWith('/')) {
    return undefined;
  }

  return filePath;
}

export async function sendPublicFile(request, response, pathname) {
  const filePath = resolvePublicFile(pathname);
  if (!filePath) {
    return false;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }

  if (!fileStat.isFile()) {
    return false;
  }

  const contentType = CONTENT_TYPES.get(extname(filePath)) ?? 'application/octet-stream';
  response.writeHead(200, {
    'cache-control': pathname.startsWith('/releases/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300',
    'content-length': fileStat.size,
    'content-type': contentType
  });

  if (request.method === 'HEAD') {
    response.end();
    return true;
  }

  createReadStream(filePath).pipe(response);
  return true;
}
