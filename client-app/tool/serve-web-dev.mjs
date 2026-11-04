/**
 * Development aid: serve the web build and the API from one origin.
 *
 *   flutter build web --release --dart-define=VAULT_BASE_URL=
 *   node tool/serve-web-dev.mjs
 *
 * Why this exists
 * ---------------
 * The real client is a native app and makes no cross-origin requests, so the
 * backend's CORS allowlist deliberately admits only the administrator console's
 * origin and only the two headers that console sends. A browser-hosted build of
 * the client therefore gets blocked at preflight on `x-device-id` — correctly.
 *
 * Rather than widening production CORS for the convenience of a development
 * check, this proxy puts the app and the API on the same origin, where CORS
 * does not apply at all. That is also what the deployment does: Caddy serves
 * one hostname and reverse-proxies `/api/v1/*` (see infra/Caddyfile).
 *
 * Build with an empty VAULT_BASE_URL so the client issues same-origin
 * relative requests.
 *
 * Not for production: no TLS, no security headers, binds to loopback.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 8095);
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3100';
const ROOT = new URL('../build/web/', import.meta.url).pathname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.bin': 'application/octet-stream',
};

createServer(async (req, res) => {
  // ── API: forward untouched, headers and all ──────────────────────────────
  if (req.url.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;

    try {
      const upstream = await fetch(`${API_ORIGIN}${req.url}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });

      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.writeHead(502).end();
    }
    return;
  }

  // ── Static: the built app, with a single-page fallback ───────────────────
  const requested = req.url.split('?')[0];
  const candidate = requested === '/' ? '/index.html' : requested;
  // `normalize` collapses any `..` before the join, so a crafted path cannot
  // climb out of the build directory.
  const path = join(ROOT, normalize(candidate).replace(/^(\.\.[/\\])+/, ''));

  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(join(ROOT, 'index.html')));
    } catch {
      res.writeHead(404).end();
    }
  }
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`client + api on http://127.0.0.1:${PORT}\n`);
});
