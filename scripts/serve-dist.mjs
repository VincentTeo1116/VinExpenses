// A tiny static server that behaves like Cloudflare Pages: it applies `_redirects` (200 rewrites) and `_headers`,
// and answers any other unknown address with /404.html and a real 404 status. Used by the end-to-end tests.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function readRules(file) {
  try {
    return (await readFile(join(root, file), 'utf8')).split('\n');
  } catch {
    return [];
  }
}

const redirectLines = await readRules('_redirects');
const rewrites = redirectLines
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split(/\s+/))
  .filter((parts) => parts.length >= 3 && parts[2] === '200')
  .map(([from, to]) => ({ from, to }));

const headerBlocks = [];
{
  let current = null;
  for (const raw of await readRules('_headers')) {
    if (!raw.trim()) continue;
    if (!raw.startsWith(' ') && !raw.startsWith('\t')) {
      current = { pattern: raw.trim(), headers: {}, remove: [] };
      headerBlocks.push(current);
    } else if (current) {
      if (raw.trim().startsWith('!')) {
        current.remove.push(raw.trim().slice(1).trim()); // "! Name" drops a header set by an earlier, broader rule
        continue;
      }
      const index = raw.indexOf(':');
      current.headers[raw.slice(0, index).trim()] = raw.slice(index + 1).trim();
    }
  }
}

const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path);

function headersFor(path) {
  const out = {};
  for (const block of headerBlocks) {
    if (!matches(block.pattern, path)) continue;
    for (const name of block.remove) delete out[name];
    Object.assign(out, block.headers);
  }
  return out;
}

async function send(response, status, file, path, alsoPath) {
  const body = await readFile(file);
  response.writeHead(status, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', ...(alsoPath ? { 'Cache-Control': headersFor(alsoPath)['Cache-Control'] } : {}), ...headersFor(path) });
  response.end(body);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const safe = normalize(path).replace(/^([/\\])+/, '');
    const file = resolve(root, safe);
    if (file !== root && !file.startsWith(root + sep)) return send(response, 404, join(root, '404.html'), '/404.html');

    const info = await stat(file).catch(() => null);
    if (info?.isFile()) return send(response, 200, file, path);
    if (path === '/' && (await stat(join(root, 'index.html')).catch(() => null))) return send(response, 200, join(root, 'index.html'), '/index.html');
    if ((path === '/miniapp' || path === '/miniapp/') && (await stat(join(root, 'miniapp', 'index.html')).catch(() => null))) return send(response, 200, join(root, 'miniapp', 'index.html'), '/miniapp/index.html');

    const rule = rewrites.find(({ from }) => (from.endsWith('*') ? path.startsWith(from.slice(0, -1)) : from === path));
    // header rules match the address that was asked for (as on Cloudflare), plus the cache rule of the page it is answered with
    if (rule) return send(response, 200, join(root, rule.to), path, rule.to);
    return send(response, 404, join(root, '404.html'), '/404.html');
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Server error');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
