import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { createServer } from '../server.js';
import { openInquiryStore } from '../src/inquiries/sqlite.js';
import { hashPassword, verifyPassword } from '../src/admin/password.js';
import { IDLE_MS, ABSOLUTE_MS, tokenHash, sessionCookie, readSessionCookie, adminOrigin } from '../src/admin/auth.js';
import { runBootstrap } from '../scripts/admin-bootstrap.js';
// Synthetic test-only credentials, never used by executable startup as defaults.
const PASSWORD = 'Fictional test-only passphrase 836!';
// Node 22 emits this exact runtime warning on SQLite import. Allow no other stderr.
const sqliteWarning = /^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n\(Use `node(?:\.exe)? --trace-warnings \.\.\.` to show where the warning was created\)\r?\n$/;
const expectedBootstrapStderr = text => text === '' || sqliteWarning.exec(text)?.[0] === text;
const inquiry = { business: 'hotel', name: 'Fictional Tester', contact: 'demo@example.invalid', question: 'Fictional booking request', consent: true };
function directory(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'slinfish-admin-test-'));
  return { dir, file: path.join(dir, 'demo.sqlite') };
}
async function fixture(t, { initialized = true, adminRateLimit } = {}) {
  const { dir, file } = directory(t);
  let time = 1800000000000;
  const store = openInquiryStore(file);
  if (initialized) store.admin.createAdmin(await hashPassword(PASSWORD));
  store.close();
  const server = createServer({ dbPath: file, now: () => time, adminRateLimit: adminRateLimit ?? { limit: 100, globalLimit: 100 } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); rmSync(dir, { recursive: true, force: true }); });
  const root = `http://127.0.0.1:${server.address().port}`;
  return { file, root, server, advance: ms => { time += ms; },
    post: (route, value, headers = {}) => fetch(root + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: root, ...headers }, body: JSON.stringify(value) }),
    get: (cookie, headers = {}) => fetch(root + '/api/admin/session', { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } })
  };
}
async function login(api, headers = {}) {
  const response = await api.post('/api/admin/login', { password: PASSWORD }, headers);
  assert.equal(response.status, 200);
  const cookieHeader = response.headers.get('set-cookie');
  return { cookieHeader, cookie: cookieHeader.split(';')[0], body: await response.json() };
}

test('scrypt uses independent salts and verifies passwords without plaintext storage', async () => {
  const first = await hashPassword(PASSWORD), second = await hashPassword(PASSWORD);
  assert.notEqual(first.password_salt, second.password_salt); assert.notEqual(first.password_hash, second.password_hash);
  assert.equal(await verifyPassword(PASSWORD, first), true); assert.equal(await verifyPassword('Incorrect synthetic passphrase', first), false);
  assert.ok(!JSON.stringify(first).includes(PASSWORD));
  await assert.rejects(hashPassword('short'));
});

test('explicit one-time bootstrap rejects noninteractive/argument/password failures and second owner', async t => {
  const { dir, file } = directory(t); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { INQUIRY_DB_PATH: file };
  assert.equal(await runBootstrap({ env, ask: () => assert.fail('No prompt without TTY') }), false);
  assert.equal(existsSync(file), false);
  assert.equal(await runBootstrap({ env, interactive: true, args: ['--password', PASSWORD], ask: () => assert.fail('No arguments') }), false);
  let prompts = 0;
  assert.equal(await runBootstrap({ env, interactive: true, ask: async () => ++prompts === 1 ? PASSWORD : 'Mismatch' }), false);
  assert.equal(await runBootstrap({ env, interactive: true, ask: async () => PASSWORD }), true);
  assert.equal(await runBootstrap({ env, interactive: true, ask: async () => assert.fail('Second setup must not ask for credentials') }), false);
  const store = openInquiryStore(file), record = store.admin.getAdmin();
  assert.equal(record.id, 1); assert.ok(!JSON.stringify(record).includes(PASSWORD));
  assert.throws(() => store.admin.createAdmin(record)); store.close();
  const child = spawnSync(process.execPath, ['scripts/admin-bootstrap.js', '--password', PASSWORD], { cwd: new URL('../', import.meta.url), env: { ...process.env, INQUIRY_DB_PATH: file }, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 1);
  assert.ok(expectedBootstrapStderr(child.stderr), 'Unexpected bootstrap stderr');
  assert.equal(child.stdout.replaceAll('\r\n', '\n'), 'Setup unavailable or already completed. Use a private terminal and configured demo database.\n');
  for (const output of [child.stdout, child.stderr]) {
    for (const secret of [PASSWORD, file, record.password_salt, record.password_hash]) assert.ok(!output.includes(secret));
  }
});

test('bootstrap stderr allowance accepts only the complete known SQLite warning', () => {
  const warning = '(node:123) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n'
    + '(Use `node --trace-warnings ...` to show where the warning was created)\n';
  assert.equal(expectedBootstrapStderr(''), true);
  assert.equal(expectedBootstrapStderr(warning), true);
  assert.equal(expectedBootstrapStderr(warning.replaceAll('\n', '\r\n').replace('`node ', '`node.exe ')), true);
  for (const text of [PASSWORD, 'PRIVATE_DATABASE_ERROR', 'Error: unexpected failure\n',
    warning + PASSWORD, PASSWORD + warning, warning + 'additional diagnostic\n',
    warning + warning, warning + '\n', warning.replace('SQLite', 'Another feature'), warning.replace('time\n', 'time ' + PASSWORD + '\n')]) {
    assert.equal(expectedBootstrapStderr(text), false);
  }
});

test('login issues opaque HttpOnly Strict cookie, exposes only CSRF, and stores only session hash', async t => {
  const api = await fixture(t), result = await login(api);
  assert.match(result.cookieHeader, /HttpOnly/); assert.match(result.cookieHeader, /SameSite=Strict/); assert.match(result.cookieHeader, /Path=\//);
  assert.ok(!result.cookieHeader.includes('; Secure'));
  const token = result.cookie.split('=')[1]; assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(result.body).sort(), ['authenticated', 'csrfToken']);
  assert.equal(result.body.authenticated, true); assert.notEqual(result.body.csrfToken, token);
  const db = new DatabaseSync(api.file); const row = db.prepare('SELECT * FROM admin_sessions').get();
  assert.equal(row.token_hash, tokenHash(token)); assert.ok(!JSON.stringify(row).includes(token)); db.close();
  const response = await api.get(result.cookie); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result.body);
});

test('absent account and incorrect password return identical generic errors with no credentials', async t => {
  const api = await fixture(t, { initialized: false });
  const before = await api.post('/api/admin/login', { password: PASSWORD }); assert.equal(before.status, 401);
  const body = await before.text();
  assert.equal(await runBootstrap({ env: { INQUIRY_DB_PATH: api.file }, interactive: true, ask: async () => PASSWORD }), true);
  const after = await api.post('/api/admin/login', { password: 'Incorrect synthetic password' }); assert.equal(after.status, 401);
  assert.equal(await after.text(), body); assert.ok(!body.includes(PASSWORD));
  assert.equal((await api.post('/api/admin/login', { password: PASSWORD, username: 'owner' })).status, 400);
  assert.equal((await api.post('/api/admin/login', { password: {} })).status, 400);
});

test('session fixation is rejected and a successful login revokes older sessions only', async t => {
  const api = await fixture(t), fixed = 'slinfish-demo-admin=' + 'a'.repeat(43);
  const first = await login(api, { Cookie: fixed }); assert.notEqual(first.cookie, fixed);
  const failure = await api.post('/api/admin/login', { password: 'Incorrect synthetic password' }, { Cookie: first.cookie });
  assert.equal(failure.status, 401); assert.equal((await api.get(first.cookie)).status, 200);
  const second = await login(api, { Cookie: first.cookie });
  assert.notEqual(second.cookie, first.cookie); assert.notEqual(second.body.csrfToken, first.body.csrfToken);
  assert.equal((await api.get(first.cookie)).status, 401); assert.equal((await api.get(second.cookie)).status, 200);
  assert.equal((await api.get(second.cookie + '; ' + second.cookie)).status, 401);
});

test('logout requires Origin, JSON and correct session-bound CSRF, then revokes and clears cookie', async t => {
  const api = await fixture(t), session = await login(api);
  const headers = { Cookie: session.cookie };
  assert.equal((await api.post('/api/admin/logout', {}, headers)).status, 403);
  assert.equal((await api.post('/api/admin/logout', {}, { ...headers, 'X-CSRF-Token': 'b'.repeat(43) })).status, 403);
  assert.equal((await api.post('/api/admin/logout', {}, { ...headers, Origin: 'https://evil.invalid', 'X-CSRF-Token': session.body.csrfToken })).status, 403);
  assert.equal((await api.get(session.cookie)).status, 200);
  const result = await api.post('/api/admin/logout', {}, { ...headers, 'X-CSRF-Token': session.body.csrfToken });
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual(await result.json(), { authenticated: false });
  assert.equal((await api.get(session.cookie)).status, 401);
  assert.equal((await api.post('/api/admin/logout', {}, { ...headers, 'X-CSRF-Token': session.body.csrfToken })).status, 401);
});

test('idle and absolute expiration reject sessions even if the browser keeps the cookie', async t => {
  const api = await fixture(t); let session = await login(api);
  api.advance(IDLE_MS); assert.equal((await api.get(session.cookie)).status, 401);
  session = await login(api);
  for (let elapsed = 29 * 60000; elapsed < ABSOLUTE_MS; elapsed += 29 * 60000) {
    api.advance(29 * 60000); assert.equal((await api.get(session.cookie)).status, 200);
  }
  api.advance(29 * 60000); assert.equal((await api.get(session.cookie)).status, 401);
});

test('revoked and disabled-admin sessions fail authentication, including through direct repository checks', async t => {
  const api = await fixture(t); let session = await login(api);
  const db = new DatabaseSync(api.file);
  db.exec('UPDATE admin_sessions SET revoked_at=1800000000000'); assert.equal((await api.get(session.cookie)).status, 401);
  session = await login(api); db.exec('UPDATE administrators SET enabled=0');
  assert.equal((await api.get(session.cookie)).status, 401); assert.equal((await api.post('/api/admin/login', { password: PASSWORD })).status, 401); db.close();
});

test('admin Host/Origin checks reject cross-site, null or missing Origin and spoofed forwarding', async t => {
  const api = await fixture(t);
  for (const origin of ['null', 'https://evil.invalid', 'http://localhost:' + api.server.address().port]) assert.equal((await api.post('/api/admin/login', { password: PASSWORD }, { Origin: origin })).status, 403);
  const withoutOrigin = await fetch(api.root + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) }); assert.equal(withoutOrigin.status, 403);
  const badHost = await new Promise(resolve => {
    const req = http.request(api.root + '/api/admin/session', { headers: { Host: 'evil.invalid', 'X-Forwarded-Host': 'localhost', 'X-Forwarded-Proto': 'https' } }, res => { res.resume(); resolve(res.statusCode); }); req.end();
  }); assert.equal(badHost, 403);
  assert.equal((await api.post('/api/admin/login', { password: PASSWORD }, { 'Content-Type': 'text/plain' })).status, 415);
  const allowed = await login(api, { 'X-Forwarded-Proto': 'https' }); assert.ok(!allowed.cookieHeader.includes('; Secure'));
  assert.equal((await api.get(allowed.cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('direct HTTPS uses Secure __Host cookies and exact HTTPS Origin; forwarded protocol is not trusted', () => {
  const req = { socket: { encrypted: true, remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:8443', origin: 'https://localhost:8443' }, rawHeaders: ['Host', 'localhost:8443'] };
  assert.deepEqual(adminOrigin(req, 8443, true), { origin: 'https://localhost:8443', secure: true });
  const cookie = sessionCookie('a'.repeat(43), true);
  assert.ok(cookie.startsWith('__Host-slinfish-demo-admin=')); assert.match(cookie, /; Secure$/);
  assert.equal(readSessionCookie(cookie, true), 'a'.repeat(43)); assert.equal(readSessionCookie(cookie, false), undefined);
  req.headers.origin = 'http://localhost:8443'; assert.throws(() => adminOrigin(req, 8443, true));
  req.headers.origin = 'https://localhost:8443'; req.rawHeaders.push('Host', 'localhost:8443'); assert.throws(() => adminOrigin(req, 8443, true)); req.rawHeaders.splice(2);
  req.headers.origin = 'https://localhost:8443'; req.socket.remoteAddress = '192.0.2.1'; assert.throws(() => adminOrigin(req, 8443, true));
});

test('login attempts are throttled across success/failure and cannot bypass with forwarded IP', async t => {
  const api = await fixture(t, { adminRateLimit: { limit: 2, windowMs: 1000, globalLimit: 10 } });
  await login(api);
  assert.equal((await api.post('/api/admin/login', { password: 'Incorrect synthetic password' })).status, 401);
  const limited = await api.post('/api/admin/login', { password: PASSWORD }, { 'X-Forwarded-For': '192.0.2.2' });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '1');
  api.advance(1001); await login(api);
});

test('password verification concurrency is bounded without blocking inquiry submissions', async t => {
  const api = await fixture(t);
  const results = await Promise.all([api.post('/api/admin/login', { password: PASSWORD }), api.post('/api/admin/login', { password: PASSWORD })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429]);
  assert.equal((await api.post('/api/lead', inquiry)).status, 201);
});

test('migration is additive and idempotent and preserves the exact v1 inquiry row', t => {
  const { dir, file } = directory(t); t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = openInquiryStore(file); const id = store.save(inquiry), before = { ...store.get('hotel', id) }; store.close();
  let db = new DatabaseSync(file); db.exec('DROP TABLE admin_sessions; DROP TABLE administrators; PRAGMA user_version=1'); db.close();
  store = openInquiryStore(file); assert.deepEqual({ ...store.get('hotel', id) }, before); assert.equal(store.admin.hasAdmin(), false); store.close();
  store = openInquiryStore(file); assert.deepEqual({ ...store.get('hotel', id) }, before); store.close();
  db = new DatabaseSync(file); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2); db.close();
});

test('wrong-realm v1 DB is rejected before authentication migration', t => {
  const { dir, file } = directory(t); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = openInquiryStore(file); store.close();
  let db = new DatabaseSync(file); db.exec("DROP TABLE admin_sessions; DROP TABLE administrators; UPDATE app_metadata SET value='real-sales'; PRAGMA user_version=1"); db.close();
  assert.throws(() => openInquiryStore(file));
  db = new DatabaseSync(file); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1); assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administrators'").get().n, 0); db.close();
});

test('internal session DB failures are sanitized and roll back previous-session revocation', async t => {
  const api = await fixture(t), session = await login(api);
  const db = new DatabaseSync(api.file); db.exec("CREATE TRIGGER fail_session BEFORE INSERT ON admin_sessions BEGIN SELECT RAISE(ABORT,'PRIVATE_AUTH_DATABASE_ERROR'); END");
  const result = await api.post('/api/admin/login', { password: PASSWORD }); assert.equal(result.status, 500);
  const text = await result.text();
  for (const value of [PASSWORD, 'PRIVATE_AUTH_DATABASE_ERROR', api.file, session.cookie]) assert.ok(!text.includes(value));
  assert.equal((await api.get(session.cookie)).status, 200); db.close();
});

test('unauthenticated callers get no session secrets or inquiry listing; no default account is created', async t => {
  const api = await fixture(t, { initialized: false });
  const response = await api.get(); assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'Authentication required' });
  for (const route of ['/api/admin/inquiries', '/api/admin/bootstrap', '/admin', '/scripts/admin-bootstrap.js', '/src/admin/password.js', '/api/sales/inquiries']) assert.equal((await fetch(api.root + route)).status, 404);
  assert.equal((await api.post('/api/lead', inquiry)).status, 201);
});

test('session hashes, expiry and revocation survive a store reopen', async t => {
  const { dir, file } = directory(t); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const origin = 'http://127.0.0.1:3000', now = 1800000000000, hash = tokenHash('c'.repeat(43));
  let store = openInquiryStore(file); store.admin.createAdmin(await hashPassword(PASSWORD));
  store.admin.createSession(hash, origin, now, IDLE_MS, ABSOLUTE_MS, store.admin.getAdmin()); store.close();
  store = openInquiryStore(file);
  assert.ok(store.admin.session(hash, origin, now)); assert.equal(store.admin.session(hash, origin, now + IDLE_MS), undefined);
  store.admin.revoke(hash, now + 1); store.close();
  store = openInquiryStore(file); assert.equal(store.admin.session(hash, origin, now + 2), undefined); store.close();
});

test('failed v1 migration rolls back without deleting inquiries or advancing schema version', t => {
  const { dir, file } = directory(t); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = openInquiryStore(file), id = store.save(inquiry); store.close();
  let db = new DatabaseSync(file);
  db.exec('DROP TABLE admin_sessions; DROP TABLE administrators; CREATE TABLE administrators (unexpected TEXT); PRAGMA user_version=1'); db.close();
  assert.throws(() => openInquiryStore(file));
  db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare('SELECT name FROM inquiries WHERE id=?').get(id).name, inquiry.name);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='admin_sessions'").get().n, 0); db.close();
});
