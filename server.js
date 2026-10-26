import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { businesses, answer, isBusiness } from './src/businesses.js';
import { validateInquiry, validText, RequestError } from './src/inquiries/validation.js';
import { openInquiryStore } from './src/inquiries/sqlite.js';
import { createLimiter } from './src/inquiries/rate-limit.js';
export { businesses, answer } from './src/businesses.js';
const publicDir = new URL('./public/', import.meta.url);
function reply(res, status, data, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", ...headers });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) throw new RequestError(415, 'Use UTF-8 application/json');
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 12000) { req.resume(); throw new RequestError(413, 'Request too large'); }
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new RequestError(400, 'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'Invalid request');
  return value;
}
export function createServer({ dbPath, now = Date.now, rateLimit } = {}) {
  const limiter = createLimiter(rateLimit);
  const store = dbPath === undefined ? null : openInquiryStore(dbPath);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/businesses') return reply(res, 200, businesses);
      if (req.method === 'POST' && ['/api/lead', '/api/chat'].includes(url.pathname)) {
        if (req.headers.origin) {
          const port = server.address().port;
          if (![ `http://localhost:${port}`, `http://127.0.0.1:${port}` ].includes(req.headers.origin)) throw new RequestError(403, 'Request origin not allowed');
        }
        if (url.pathname === '/api/lead') {
          const retry = limiter.attempt(req.socket.remoteAddress, now());
          if (retry) return reply(res, 429, { error: 'Too many inquiry attempts' }, 'application/json', { 'Retry-After': String(retry) });
        }
        const data = await body(req);
        if (url.pathname === '/api/chat') {
          if (!isBusiness(data.business) || !validText(data.message, 1000, true) || Object.keys(data).some(key => !['business', 'message'].includes(key))) throw new RequestError(400, 'Invalid chat request');
          return reply(res, 200, { message: answer(businesses[data.business], data.message), mode: 'rules-demo' });
        }
        const inquiry = validateInquiry(data);
        if (!store) return reply(res, 200, { stored: false, message: 'Demo only: validated but not stored or sent. Local persistence is not configured.' });
        let id;
        try { id = store.save(inquiry, now()); }
        catch { throw new RequestError(503, 'Inquiry storage unavailable. Nothing was confirmed saved.'); }
        return reply(res, 201, { stored: true, inquiryId: id, message: 'Fictional demo inquiry saved locally. No notification was sent.' });
      }
      if (url.pathname.startsWith('/api/')) throw new RequestError(404, 'Not found');
      if (req.method !== 'GET') throw new RequestError(405, 'Method not allowed');
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
      if (!Object.hasOwn(assets, url.pathname)) throw new RequestError(404, 'Not found');
      const [file, type] = assets[url.pathname];
      return reply(res, 200, await readFile(new URL(file, publicDir)), type);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        const status = error instanceof RequestError ? error.status : 500;
        reply(res, status, { error: error instanceof RequestError ? error.message : 'Request failed' }, 'application/json', { Connection: 'close' });
      }
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxRequestsPerSocket = 100;
  const cleanup = () => { limiter.clear(); store?.close(); };
  server.on('close', cleanup); server.on('error', cleanup);
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const server = createServer({ dbPath: process.env.INQUIRY_DB_PATH });
    server.on('error', () => { console.error('Unable to start local demo. Check storage configuration and port.'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Local demo listening on port ${server.address().port}`));
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('Unable to start local demo. Check storage configuration and port.'); process.exitCode = 1; }
}
