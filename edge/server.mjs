/**
 * The single front door.
 *
 * Serves the client website and forwards `/api/v1/*` to the backend, both on
 * one address. That matters for three reasons:
 *
 *   - the site and the service share an origin, so CORS never applies and the
 *     backend's CORS allowlist can stay closed to everything but the
 *     administrator console;
 *   - a tunnel only has to expose one port;
 *   - it mirrors what Caddy does in a real deployment (infra/Caddyfile), so
 *     development and production behave the same way.
 *
 * The administrator console is deliberately NOT served here. It stays on your
 * own machine — see README. Anything under /api/v1/admin is refused, so
 * exposing this to the internet does not expose the admin API with it.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
// Loopback only. Both stacks — see the note at the bottom of this file.
const HOSTS = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:3000';
const ROOT = new URL('../web-client/dist/', import.meta.url).pathname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const NOT_FOUND = JSON.stringify({ error: { code: 'NOT_FOUND', requestId: 'edge' } });

const handler = async (req, res) => {
  const path = req.url.split('?')[0];

  // ── The administrator API is not public ─────────────────────────────────
  // Indistinguishable from any other unmatched path: no hint that an
  // administrator surface exists at all.
  if (path.startsWith('/api/v1/admin')) {
    res.writeHead(404, { 'content-type': 'application/json' }).end(NOT_FOUND);
    return;
  }

  // ── API ─────────────────────────────────────────────────────────────────
  if (path.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);

    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];

    try {
      const upstream = await fetch(`${API_ORIGIN}${req.url}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });

      const out = { 'content-type': upstream.headers.get('content-type') ?? 'application/json' };
      // Document downloads need their filename; nothing else is forwarded.
      const disposition = upstream.headers.get('content-disposition');
      if (disposition) out['content-disposition'] = disposition;
      out['cache-control'] = 'no-store';

      res.writeHead(upstream.status, out);
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      // The backend being down must look like anything else going wrong.
      res.writeHead(404, { 'content-type': 'application/json' }).end(NOT_FOUND);
    }
    return;
  }

  // ── The website ─────────────────────────────────────────────────────────
  const candidate = path === '/' ? '/index.html' : path;
  // `normalize` collapses any `..` before the join, so a crafted path cannot
  // climb out of the build directory.
  const file = join(ROOT, normalize(candidate).replace(/^(\.\.[/\\])+/, ''));

  const security = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), camera=(), microphone=()',
  };

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      ...security,
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // The shell may be cached; document bytes never are (see the API branch).
      'cache-control': extname(file) === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    // Single-page app: unknown paths render the app, which shows its own
    // generic failure screen rather than anything descriptive.
    try {
      const html = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { ...security, 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' }).end(NOT_FOUND);
    }
  }
};

/**
 * Listen on IPv4 and IPv6 loopback both.
 *
 * macOS resolves `localhost` to `::1` before `127.0.0.1`. A server bound only
 * to `127.0.0.1` makes the browser try IPv6 first, wait for the refusal, then
 * retry on IPv4 — which is exactly the "why is localhost so slow" delay, and
 * on some setups it fails outright rather than falling back.
 *
 * Binding only to `::1` has the mirror problem: `cloudflared` and most scripts
 * target `127.0.0.1` and would find nothing there. Two listeners, one handler,
 * and every spelling of loopback works. Neither is reachable from the network.
 */
for (const host of HOSTS) {
  createServer(handler).listen(PORT, host, () => {
    process.stdout.write(`Vault front door on http://${host.includes(':') ? `[${host}]` : host}:${PORT}\n`);
  }).on('error', (err) => {
    // A machine with IPv6 disabled simply skips that listener.
    if (err.code !== 'EADDRNOTAVAIL' && err.code !== 'EAFNOSUPPORT') throw err;
  });
}
