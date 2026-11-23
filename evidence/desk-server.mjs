// Serves the built desk (apps/desk/dist) statically and proxies /api/* to the
// local indexer on :3000 — one port for the deployed app.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';

const ROOT = new URL('../apps/desk/dist/', import.meta.url).pathname;
const API = 'http://127.0.0.1:3000';
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const proxy = new Request(`${API}${url.pathname}${url.search}`, { method: req.method });
    fetch(proxy).then(async (up) => {
      res.writeHead(up.status, {
        'content-type': up.headers.get('content-type') || 'application/octet-stream',
        'access-control-allow-origin': '*',
      });
      res.end(Buffer.from(await up.arrayBuffer()));
    }).catch(() => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'indexer unreachable' }));
    });
    return;
  }
  let path = normalize(join(ROOT, url.pathname));
  if (!path.startsWith(ROOT)) path = join(ROOT, 'index.html');
  try {
    const st = statSync(path);
    if (st.isDirectory()) path = join(path, 'index.html');
  } catch {
    path = join(ROOT, 'index.html');
  }
  try {
    statSync(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`desk+api on :${PORT}`));
