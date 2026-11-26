// A tiny static server that behaves like Cloudflare (Workers static assets with `html_handling: auto-trailing-slash` and
// `not_found_handling: 404-page`): /app is answered by app.html, /app.html and /index.html redirect to their clean address, /miniapp
// redirects to /miniapp/, `_headers` is applied, and any other unknown address gets /404.html with a real 404 status.
// Used by the end-to-end tests.
// There are NO rewrite rules on purpose: on Cloudflare a rewrite to /index.html is turned into a redirect to /, so a refresh on /app
// landed on the home page. The app addresses are real files instead (made by the build, see appPagesPlugin in vite.config.mts).
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
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

async function readRules(file) {
  try {
    return (await readFile(join(root, file), 'utf8')).split('\n');
  } catch {
    return [];
  }
}

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
  const cache = alsoPath ? headersFor(alsoPath)['Cache-Control'] : undefined; // the cache rule of the page file itself, when it has one
  response.writeHead(status, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', ...(cache ? { 'Cache-Control': cache } : {}), ...headersFor(path) });
  response.end(body);
}

const exists = (file) => stat(file).catch(() => null);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const safe = normalize(path).replace(/^([/\\])+/, '');
    const file = resolve(root, safe);
    if (file !== root && !file.startsWith(root + sep)) return send(response, 404, join(root, '404.html'), '/404.html');

    const redirect = (to) => {
      response.writeHead(307, { Location: to + url.search, ...headersFor(path) });
      response.end();
    };

    // a real file
    const info = await exists(file);
    if (info?.isFile()) {
      // /x.html and /x/index.html go to their clean address; 404.html is only ever served as the not-found page
      if (path.endsWith('.html') && path !== '/404.html') return redirect(path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path.slice(0, -'.html'.length));
      return send(response, 200, file, path);
    }
    if (path === '/') return send(response, 200, join(root, 'index.html'), '/', '/index.html'); // headers by the address asked for, the cache rule of the file itself

    // clean addresses: /x is x.html (or x/index.html); /x/ is x/index.html, or goes to /x when only x.html exists
    const bare = safe.replace(/[/\\]+$/, '');
    const page = join(root, `${bare}.html`);
    const folderIndex = join(file, 'index.html');
    if (path.endsWith('/')) {
      if ((await exists(folderIndex))?.isFile()) return send(response, 200, folderIndex, path, `${path}index.html`);
      if ((await exists(page))?.isFile()) return redirect(path.replace(/\/+$/, ''));
    } else {
      if ((await exists(page))?.isFile()) return send(response, 200, page, path, `${path}.html`);
      if ((await exists(folderIndex))?.isFile()) return redirect(`${path}/`);
    }
    return send(response, 404, join(root, '404.html'), '/404.html');
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Server error');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
