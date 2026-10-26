import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { runReset } from '../scripts/admin-reset.js';
import { openInquiryStore } from '../src/inquiries/sqlite.js';
import { hashPassword, verifyPassword } from '../src/admin/password.js';
import { createAdminAuth, tokenHash, IDLE_MS, ABSOLUTE_MS } from '../src/admin/auth.js';
import { createServer } from '../server.js';
// Synthetic credentials/records only; no runtime defaults or real customer information.
const OLD = 'Synthetic old reset passphrase 836!';
const NEW = 'Synthetic new reset passphrase 947!';
const origin = 'http://127.0.0.1:3000', now = 1800000000000;
const sample = { business: 'hotel', name: 'Fictional Tester', contact: 'demo@example.invalid', question: 'Fictional reset test', consent: true };
const expectedFailure = 'Reset unavailable. Use a private terminal and an existing configured demo administrator database.\n';
const sqliteWarning = /^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n\(Use `node(?:\.exe)? --trace-warnings \.\.\.` to show where the warning was created\)\r?\n$/;
function temp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'slinfish-reset-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'demo.sqlite');
}
async function seeded(t) {
  const file = temp(t), store = openInquiryStore(file);
  store.admin.createAdmin(await hashPassword(OLD));
  const ids = [store.save(sample), store.save({ ...sample, business: 'auto' })];
  const rows = ids.map((id, i) => ({ ...store.get(i ? 'auto' : 'hotel', id) }));
  const before = { ...store.admin.getAdmin() };
  const credential = store.admin.getAdmin();
  for (const token of ['a'.repeat(43), 'b'.repeat(43)]) store.admin.createSession(tokenHash(token), origin, now, IDLE_MS, ABSOLUTE_MS, credential);
  store.close();
  return { file, ids, rows, before };
}
const reset = (file, ask = async () => NEW) => runReset({ env: { INQUIRY_DB_PATH: file }, interactive: true, ask });
function snapshot(file) {
  const db = new DatabaseSync(file);
  try { return {
    admin: { ...db.prepare('SELECT * FROM administrators').get() },
    sessions: db.prepare('SELECT * FROM admin_sessions ORDER BY token_hash').all().map(row => ({ ...row })),
    inquiries: db.prepare('SELECT * FROM inquiries ORDER BY id').all().map(row => ({ ...row })),
    version: db.prepare('PRAGMA user_version').get().user_version
  }; } finally { db.close(); }
}

test('reset uses fresh scrypt credentials, preserves inquiries/admin metadata/schema and revokes every session', async t => {
  const fixture = await seeded(t), before = snapshot(fixture.file);
  assert.equal(await reset(fixture.file), true);
  const after = snapshot(fixture.file);
  assert.notEqual(after.admin.password_salt, before.admin.password_salt);
  assert.notEqual(after.admin.password_hash, before.admin.password_hash);
  assert.equal(await verifyPassword(NEW, after.admin), true); assert.equal(await verifyPassword(OLD, after.admin), false);
  for (const field of ['id', 'enabled', 'created_at', 'scrypt_n', 'scrypt_r', 'scrypt_p']) assert.equal(after.admin[field], before.admin[field]);
  assert.deepEqual(after.inquiries, before.inquiries); assert.equal(after.version, 2);
  assert.equal(after.sessions.length, before.sessions.length);
  assert.ok(after.sessions.every(row => row.revoked_at !== null));
});

test('mismatched confirmation, invalid policy values and interrupted prompts leave all records unchanged', async t => {
  const { file } = await seeded(t), before = snapshot(file);
  for (const value of ['short', 'x'.repeat(129), ' '.repeat(20), '\ud800'.repeat(20), 'A'.repeat(16) + '\n']) {
    assert.equal(await reset(file, async () => value), false); assert.deepEqual(snapshot(file), before);
  }
  let prompts = 0;
  assert.equal(await reset(file, async () => ++prompts === 1 ? NEW : 'Different confirmation'), false);
  assert.deepEqual(snapshot(file), before);
  assert.equal(await reset(file, async () => { throw new Error('PRIVATE_PROMPT_ERROR'); }), false);
  assert.deepEqual(snapshot(file), before);
});

test('noninteractive, missing path, argument and environment-password attempts cannot reset credentials', async t => {
  const { file } = await seeded(t), before = snapshot(file);
  const never = () => assert.fail('No credential prompt allowed');
  for (const options of [
    { env: { INQUIRY_DB_PATH: file }, ask: never },
    { interactive: true, ask: never },
    { interactive: true, env: { INQUIRY_DB_PATH: file }, args: ['--password', NEW], ask: never },
    { interactive: true, env: { INQUIRY_DB_PATH: file, ADMIN_PASSWORD: NEW, NEW_PASSWORD: NEW } }
  ]) assert.equal(await runReset(options), false);
  assert.deepEqual(snapshot(file), before);
});

test('missing administrator or database is rejected before prompting; no empty database is created', async t => {
  const file = temp(t), never = () => assert.fail('Must not ask for a new passphrase');
  assert.equal(await reset(file, never), false); assert.equal(existsSync(file), false);
  const store = openInquiryStore(file), id = store.save(sample); store.close();
  assert.equal(await reset(file, never), false);
  const reopened = openInquiryStore(file); assert.equal(reopened.admin.hasAdmin(), false); assert.equal(reopened.get('hotel', id).name, sample.name); reopened.close();
});

test('corrupt, wrong-realm, memory, relative and older-schema databases are rejected without migrations', async t => {
  const file = temp(t), never = () => assert.fail('Must not prompt for an invalid database');
  writeFileSync(file, 'PRIVATE_INVALID_DATABASE', { mode: 0o600 }); assert.equal(await reset(file, never), false);
  for (const invalid of [':memory:', 'file:demo?mode=memory', 'relative.sqlite']) assert.equal(await reset(invalid, never), false);
  rmSync(file); const store = openInquiryStore(file), id = store.save(sample); store.close();
  let db = new DatabaseSync(file); db.exec("UPDATE app_metadata SET value='real-sales'"); db.close();
  assert.equal(await reset(file, never), false);
  db = new DatabaseSync(file); db.exec("UPDATE app_metadata SET value='fictional-demo'; DROP TABLE admin_sessions; DROP TABLE administrators; PRAGMA user_version=1"); db.close();
  assert.equal(await reset(file, never), false);
  db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(db.prepare('SELECT name FROM inquiries WHERE id=?').get(id).name, sample.name);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administrators'").get().n, 0); db.close();
});

test('failure while revoking sessions rolls back credentials, session state and inquiry data together', async t => {
  const { file } = await seeded(t), before = snapshot(file);
  let db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER reject_reset BEFORE UPDATE OF revoked_at ON admin_sessions BEGIN SELECT RAISE(ABORT,'PRIVATE_RESET_DATABASE_ERROR'); END"); db.close();
  assert.equal(await reset(file), false);
  assert.deepEqual(snapshot(file), before);
  assert.equal(await verifyPassword(OLD, snapshot(file).admin), true);
  assert.equal(await verifyPassword(NEW, snapshot(file).admin), false);
});

test('repository reset never creates an owner and disabled accounts are not implicitly enabled', async t => {
  const file = temp(t), credential = await hashPassword(NEW);
  let store = openInquiryStore(file); assert.throws(() => store.admin.resetPassword(credential)); assert.equal(store.admin.hasAdmin(), false); store.close();
  store = openInquiryStore(file); store.admin.createAdmin(await hashPassword(OLD)); store.close();
  const db = new DatabaseSync(file); db.exec('UPDATE administrators SET enabled=0'); db.close();
  assert.equal(await reset(file), true); assert.equal(snapshot(file).admin.enabled, 0);
});

test('in-flight old-password verification cannot mint a post-reset session', async t => {
  const { file } = await seeded(t), replacement = await hashPassword(NEW);
  const store = openInquiryStore(file), auth = createAdminAuth(store.admin, () => now);
  try {
    const login = auth.login(OLD, origin); // Starts asynchronous scrypt against the old snapshot.
    store.admin.resetPassword(replacement, now);
    await assert.rejects(login, error => error.status === 401);
    const db = new DatabaseSync(file);
    assert.equal(db.prepare('SELECT count(*) AS n FROM admin_sessions WHERE revoked_at IS NULL').get().n, 0); db.close();
    const session = await auth.login(NEW, origin);
    assert.ok(store.admin.session(tokenHash(session.token), origin, now));
  } finally { store.close(); }
});

test('noninteractive executable emits fixed messages only and never consumes piped/env/argument passwords', async t => {
  const { file } = await seeded(t), before = snapshot(file);
  for (const args of [[], ['--password', NEW], ['--new-passphrase', NEW]]) {
    const child = spawnSync(process.execPath, ['scripts/admin-reset.js', ...args], {
      cwd: new URL('../', import.meta.url), env: { ...process.env, INQUIRY_DB_PATH: file, ADMIN_PASSWORD: NEW, NEW_PASSWORD: NEW },
      input: NEW + '\n' + NEW + '\n', encoding: 'utf8', timeout: 5000
    });
    assert.equal(child.error, undefined); assert.equal(child.status, 1);
    assert.equal(child.stdout.replaceAll('\r\n', '\n'), expectedFailure);
    assert.ok(child.stderr === '' || sqliteWarning.exec(child.stderr)?.[0] === child.stderr);
    for (const output of [child.stdout, child.stderr]) {
      for (const secret of [OLD, NEW, file, before.admin.password_hash, before.admin.password_salt, ...before.sessions.map(row => row.token_hash)]) assert.ok(!output.includes(secret));
    }
    assert.deepEqual(snapshot(file), before);
  }
});

test('running server rejects revoked cookies and old passwords after local reset; no reset route exists', async t => {
  // Register server cleanup before directory removal (Node after hooks run in order).
  let server;
  t.after(async () => { if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });
  const { file } = await seeded(t);
  server = createServer({ dbPath: file, adminRateLimit: { limit: 100, globalLimit: 100 } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const login = password => fetch(root + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: root }, body: JSON.stringify({ password }) });
  const first = await login(OLD); assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.equal(await reset(file), true);
  assert.equal((await fetch(root + '/api/admin/session', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await login(OLD)).status, 401); assert.equal((await login(NEW)).status, 200);
  for (const route of ['/api/admin/reset', '/api/admin/password-reset', '/scripts/admin-reset.js']) assert.equal((await fetch(root + route)).status, 404);
  assert.equal((await fetch(root + '/api/admin/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: root }, body: '{}' })).status, 404);
});
