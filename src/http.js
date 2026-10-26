import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { businesses, getBusiness } from './knowledge.js';
import { createChat } from './chat.js';
import { providerConfig } from './provider.js';
const publicDir = new URL('../public/', import.meta.url);
class RequestError extends Error { constructor(status, message) { super(message); this.status = status; } }
function reply(res, status, data, type = 'application/json', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", ...extra });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new RequestError(415, 'Use application/json');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12000) throw new RequestError(413, 'Request too large');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RequestError(400, 'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'Invalid request');
  return value;
}
const validText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
export function createServer({ config = providerConfig(), fetchImpl, rateLimit = 30, windowMs = 60000, now = Date.now } = {}) {
  const chat = createChat(config, fetchImpl);
  const clients = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') && req.method === 'POST') {
        const time = now();
        for (const [key, record] of clients) if (record.until <= time) clients.delete(key);
        // Socket identity only: do not trust spoofable forwarding headers.
        const key = req.socket.remoteAddress;
        let record = clients.get(key);
        if (!record) {
          if (clients.size >= 10000) throw new RequestError(503, 'Try again later');
          record = { count: 0, until: time + windowMs }; clients.set(key, record);
        }
        if (++record.count > rateLimit) return reply(res, 429, { error: 'Too many requests' }, 'application/json', { 'Retry-After': String(Math.max(1, Math.ceil((record.until - time) / 1000))) });
      }
      if (req.method === 'GET' && url.pathname === '/api/businesses') return reply(res, 200, Object.fromEntries(Object.entries(businesses).map(([id, b]) => [id, { name: b.name, sector: b.sector }])));
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const d = await body(req);
        if (!getBusiness(d.business) || !validText(d.message, 1000) || Object.keys(d).some(k => !['business', 'message'].includes(k))) throw new RequestError(400, 'Invalid chat request');
        const result = await chat(d.business, d.message.trim());
        return reply(res, result.error ? 503 : 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/api/lead') {
        const d = await body(req);
        if (!getBusiness(d.business) || d.consent !== true || !validText(d.name, 100) || !validText(d.contact, 150) || !validText(d.question, 400) || Object.keys(d).some(k => !['business', 'consent', 'name', 'contact', 'question'].includes(k))) throw new RequestError(400, 'Complete all fields and consent');
        return reply(res, 200, { message: 'Demo only: validated but not stored or sent. No team member will receive this inquiry.' });
      }
      if (url.pathname.startsWith('/api/')) throw new RequestError(req.method === 'GET' || req.method === 'POST' ? 404 : 405, 'Unsupported API route or method');
      if (req.method !== 'GET') throw new RequestError(405, 'Method not allowed');
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
      if (!Object.hasOwn(assets, url.pathname)) throw new RequestError(404, 'Not found');
      const [file, type] = assets[url.pathname];
      return reply(res, 200, await readFile(new URL(file, publicDir)), type);
    } catch (error) { if (!res.headersSent && !res.destroyed) reply(res, error.status || 500, { error: error.status ? error.message : 'Request failed' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  server.on('close', () => clients.clear());
  return server;
}
