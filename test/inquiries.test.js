import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from '../server.js';
import { validateInquiry, LIMITS } from '../src/inquiries/validation.js';
import { openInquiryStore, RETENTION_MS, MAX_INQUIRIES } from '../src/inquiries/sqlite.js';
import { createLimiter } from '../src/inquiries/rate-limit.js';
const sample = { business: 'hotel', name: 'Fictional Tester', contact: 'demo@example.invalid', question: 'Fictional booking inquiry', consent: true };
// Reverse resource cleanup order so Windows never removes an open SQLite file.
const cleanupStacks = new WeakMap();
function onCleanup(t, action) {
  let stack = cleanupStacks.get(t);
  if (!stack) {
    stack = []; cleanupStacks.set(t, stack);
    t.after(async () => { for (const cleanup of stack.reverse()) await cleanup(); });
  }
  stack.push(action);
}
function storage(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'slinfish-test-'));
  onCleanup(t, () => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'inquiries.sqlite');
}
async function app(t, options = {}) {
  const server = createServer({ rateLimit: { limit: 100, globalLimit: 200 }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  onCleanup(t, () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${server.address().port}`;
  return { server, root, post: (value, extra = {}) => fetch(root + '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), ...extra }) };
}

test('strict business IDs and consent reject inherited keys, coercion and real sales scopes', () => {
  for (const business of ['constructor', '__proto__', 'toString', 'unknown', 'slinfish', {}, ['hotel'], null, 1]) assert.throws(() => validateInquiry({ ...sample, business }));
  for (const consent of ['true', 'false', 1, {}, [], false, null, undefined]) assert.throws(() => validateInquiry({ ...sample, consent }));
  for (const business of ['realestate', 'auto', 'retail', 'hotel']) assert.equal(validateInquiry({ ...sample, business }).business, business);
});
test('text validation enforces raw UTF-16 length, trimming, content and consistent HTML limits', () => {
  for (const [field, limit] of Object.entries(LIMITS)) {
    assert.equal(validateInquiry({ ...sample, [field]: 'x'.repeat(limit) })[field].length, limit);
    for (const value of ['x'.repeat(limit + 1), '', '  ', '\0', '\ud800', {}, [], 10, null]) assert.throws(() => validateInquiry({ ...sample, [field]: value }));
  }
  assert.throws(() => validateInquiry({ ...sample, name: '\ud83d\ude00'.repeat(51) }));
  assert.throws(() => validateInquiry({ ...sample, contact: 'a\nb' }));
  assert.equal(validateInquiry({ ...sample, question: ' one\n two ' }).question, 'one\n two');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const [field, limit] of Object.entries(LIMITS)) assert.match(html, new RegExp('name="' + field + '"[^>]*maxlength="' + limit + '"'));
});
test('unexpected structures and user-assigned server metadata are rejected', () => {
  for (const value of [null, [], true, 'text', {}, { ...sample, status: 'qualified' }, { ...sample, version: 100 }, { ...sample, expires_at: 999 }, { ...sample, realm: 'sales' }, JSON.parse('{"__proto__":{},"business":"hotel","name":"Demo","contact":"demo@example.invalid","question":"Demo","consent":true}')]) assert.throws(() => validateInquiry(value));
});
test('unconfigured app validates only, without claiming storage or exposing submitted fields', async t => {
  const api = await app(t);
  const response = await api.post(sample); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.stored, false);
  assert.match(body.message, /not stored/); assert.ok(!JSON.stringify(body).includes(sample.contact));
});
test('HTTP validates JSON, content type, byte budget, origin, and shape before writes', async t => {
  const file = storage(t), api = await app(t, { dbPath: file });
  for (const value of [null, [], false, {}, { ...sample, business: 'constructor' }, { ...sample, consent: 'false' }, { ...sample, extra: true }]) assert.equal((await api.post(value)).status, 400);
  assert.equal((await api.post({}, { body: '{' })).status, 400);
  assert.equal((await api.post({}, { body: new Uint8Array([255]) })).status, 400);
  assert.equal((await api.post(sample, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await api.post({}, { body: JSON.stringify({ data: 'é'.repeat(7000) }) })).status, 413);
  assert.equal((await api.post(sample, { headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' } })).status, 403);
  const db = new DatabaseSync(file); assert.equal(db.prepare('SELECT count(*) AS n FROM inquiries').get().n, 0); db.close();
});
test('stored inquiry has secure ID, strict metadata, only submitted data and seven-day expiry', async t => {
  const file = storage(t), time = 1800000000000, api = await app(t, { dbPath: file, now: () => time });
  const response = await api.post({ ...sample, name: '  Fictional Tester  ' }); assert.equal(response.status, 201);
  const result = await response.json(); assert.equal(result.stored, true);
  assert.match(result.inquiryId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(result).includes(sample.contact));
  const db = new DatabaseSync(file), row = db.prepare('SELECT * FROM inquiries WHERE id=?').get(result.inquiryId);
  assert.deepEqual({ ...row }, { id: result.inquiryId, business_id: 'hotel', name: sample.name, contact: sample.contact, question: sample.question, consent: 1, status: 'new', created_at: time, updated_at: time, expires_at: time + RETENTION_MS, version: 1, workflow_status: 'new' });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3); db.close();
});
test('parameterized writes preserve SQL injection text and business-scoped reads enforce isolation', t => {
  const store = openInquiryStore(storage(t)); onCleanup(t, () => store.close());
  const attack = "Fictional test'); DROP TABLE inquiries; --";
  const hotel = store.save({ ...sample, question: attack });
  const auto = store.save({ ...sample, business: 'auto' });
  assert.equal(store.get('hotel', hotel).question, attack);
  assert.equal(store.get('auto', hotel), undefined); assert.equal(store.get('hotel', auto), undefined);
  assert.equal(store.get('hotel', "' OR 1=1 --"), undefined);
  assert.equal(store.get('constructor', hotel), undefined);
  assert.equal(store.get('auto', auto).business_id, 'auto'); assert.notEqual(auto, hotel);
});
test('schema enforces business, consent, text, status, time and version constraints', t => {
  const file = storage(t), store = openInquiryStore(file), id = store.save(sample); store.close();
  const db = new DatabaseSync(file); onCleanup(t, () => db.close());
  for (const [column, value] of [['business_id', 'slinfish'], ['consent', 0], ['name', 'x'.repeat(101)], ['contact', ''], ['question', 'x'.repeat(401)], ['status', 'invalid'], ['version', 0], ['expires_at', 0], ['updated_at', 0]]) assert.throws(() => db.prepare(`UPDATE inquiries SET ${column}=? WHERE id=?`).run(value, id));
});
test('closed and reopened SQLite retains stored inquiries without duplicating migrations', t => {
  const file = storage(t); const first = openInquiryStore(file), id = first.save(sample); first.close();
  const second = openInquiryStore(file); assert.equal(second.get('hotel', id).contact, sample.contact); second.close();
});
test('storage has an explicit capacity, never overwrites earlier inquiries', t => {
  const store = openInquiryStore(storage(t)); onCleanup(t, () => store.close());
  const first = store.save(sample);
  for (let i = 1; i < MAX_INQUIRIES; i++) store.save(sample);
  assert.throws(() => store.save(sample)); assert.equal(store.get('hotel', first).name, sample.name);
});
test('unsafe paths, unsupported schemas, wrong realms and corrupt files fail closed', t => {
  const file = storage(t);
  for (const candidate of [':memory:', '', 'file:demo?mode=memory', 'relative.sqlite', new URL('../public/leads.sqlite', import.meta.url).pathname]) assert.throws(() => openInquiryStore(candidate));
  writeFileSync(file, 'not a SQLite database', { mode: 0o600 }); assert.throws(() => createServer({ dbPath: file }));
  rmSync(file);
  const store = openInquiryStore(file); store.close();
  const db = new DatabaseSync(file); db.exec("UPDATE app_metadata SET value='real-sales' WHERE key='realm'"); db.close();
  assert.throws(() => openInquiryStore(file));
  const edit = new DatabaseSync(file); edit.exec("UPDATE app_metadata SET value='fictional-demo'; PRAGMA user_version=99"); edit.close();
  assert.throws(() => openInquiryStore(file));
});
test('executable startup rejects invalid configured storage without silent fallback or raw errors', t => {
  const file = storage(t); writeFileSync(file, 'PRIVATE_DATABASE_BYTES', { mode: 0o600 });
  const child = spawnSync(process.execPath, ['server.js'], { cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: '0', INQUIRY_DB_PATH: file }, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 1); assert.equal(child.stdout, '');
  assert.match(child.stderr, /Unable to start local demo/);
  for (const value of [file, 'PRIVATE_DATABASE_BYTES', 'SQLITE', 'Error:']) assert.ok(!child.stderr.includes(value));
});
test('POSIX file permissions and symlinks are rejected when storage is unsafe', { skip: process.platform === 'win32' }, t => {
  const file = storage(t); writeFileSync(file, '', { mode: 0o600 }); chmodSync(file, 0o644); assert.throws(() => openInquiryStore(file));
  rmSync(file); const target = file + '.target'; writeFileSync(target, '', { mode: 0o600 }); symlinkSync(target, file); assert.throws(() => openInquiryStore(file));
  rmSync(file); chmodSync(path.dirname(file), 0o755); assert.throws(() => openInquiryStore(file));
});
test('runtime DB errors return 503 without raw SQL, paths, contact details or success', async t => {
  const file = storage(t), api = await app(t, { dbPath: file });
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON inquiries BEGIN SELECT RAISE(ABORT,'PRIVATE_DB_ERROR'); END");
  const response = await api.post(sample); assert.equal(response.status, 503);
  const text = await response.text();
  for (const secret of ['PRIVATE_DB_ERROR', file, sample.contact, sample.question]) assert.ok(!text.includes(secret));
  assert.equal(db.prepare('SELECT count(*) AS n FROM inquiries').get().n, 0); db.close();
});
test('rate limiting counts invalid attempts, ignores forwarded IPs and resets with time', async t => {
  let time = 1800000000000;
  const api = await app(t, { now: () => time, rateLimit: { limit: 2, windowMs: 1000 } });
  assert.equal((await api.post({})).status, 400);
  assert.equal((await api.post(sample)).status, 200);
  const limited = await api.post(sample, { headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': 'different' } });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '1');
  time += 1001; assert.equal((await api.post(sample)).status, 200);
});
test('global limiter and client map are bounded independently of per-client limits', () => {
  const limiter = createLimiter({ limit: 10, globalLimit: 2, maxClients: 2, windowMs: 1000 });
  assert.equal(limiter.attempt('a', 1), 0); assert.equal(limiter.attempt('b', 1), 0);
  assert.ok(limiter.attempt('a', 1) > 0); assert.ok(limiter.attempt('c', 1) > 0);
  assert.equal(limiter.attempt('c', 1002), 0);
});
test('stored records, DB files and sales/admin routes are not publicly accessible', async t => {
  const api = await app(t, { dbPath: storage(t) });
  const result = await (await api.post(sample)).json();
  for (const route of ['/api/lead', '/api/leads', '/api/inquiries', '/api/lead/' + result.inquiryId, '/api/sales/inquiries', '/api/admin/inquiries', '/inquiries.sqlite', '/data/inquiries.sqlite', '/.git/config', '/src/inquiries/sqlite.js']) {
    const response = await fetch(api.root + route); assert.equal(response.status, route === '/api/admin/inquiries' ? 401 : 404);
    const body = await response.text(); assert.ok(!body.includes(sample.contact));
  }
  assert.equal((await api.post(sample, { method: 'GET', body: undefined })).status, 404);
});

async function processServer(file) {
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('../', import.meta.url), env: { ...process.env, PORT: '0', INQUIRY_DB_PATH: file }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const root = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Child startup timeout')); }, 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/listening on port (\d+)/);
      if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Child failed to start')); });
    child.once('error', reject);
  });
  return { root, async stop() { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; assert.ok(!errors.includes(sample.contact)); } };
}
test('application process restart preserves a committed inquiry on disk', async t => {
  const file = storage(t), first = await processServer(file);
  let id;
  try {
    const response = await fetch(first.root + '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample) });
    assert.equal(response.status, 201); id = (await response.json()).inquiryId;
  } finally { await first.stop(); }
  const second = await processServer(file);
  try {
    assert.equal((await fetch(second.root + '/api/businesses')).status, 200);
    const store = openInquiryStore(file); assert.equal(store.get('hotel', id).name, sample.name); store.close();
  } finally { await second.stop(); }
});
