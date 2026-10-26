import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openInquiryStore } from '../src/inquiries/sqlite.js';
import { hashPassword } from '../src/admin/password.js';
import { createAdminAuth } from '../src/admin/auth.js';
import { WORKFLOW } from '../src/inquiries/management.js';
import { createServer } from '../server.js';
const PASSWORD = 'Synthetic dashboard test password 947!';
const credential = await hashPassword(PASSWORD);
const sample = { business: 'hotel', name: '<img src=x onerror=alert(1)>', contact: 'demo@example.invalid', question: '<script>synthetic only</script>', consent: true };
async function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'slinfish-manage-')), file = path.join(dir, 'demo.sqlite');
  let time = 1800000000000;
  const store = openInquiryStore(file); store.admin.createAdmin(credential); const id = store.save(sample, time); store.close();
  const server = createServer({ dbPath: file, now: () => time, adminRateLimit: { limit: 100, globalLimit: 100 } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); rmSync(dir, { recursive: true, force: true }); });
  const root = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(root + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: root }, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0], csrf = (await login.json()).csrfToken;
  const detail = (business = 'hotel', inquiryId = id) => `/api/admin/businesses/${business}/inquiries/${inquiryId}`;
  return { file, root, id, detail, cookie, csrf, advance: ms => { time += ms; },
    get: route => fetch(root + route, { headers: { Cookie: cookie } }),
    patch: (value, route = detail(), headers = {}) => fetch(root + route, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: root, Cookie: cookie, 'X-CSRF-Token': csrf, ...headers }, body: JSON.stringify(value) }) };
}
test('list/details/history require authentication and preserve business scope', async t => {
  const api = await fixture(t);
  for (const route of ['/api/admin/inquiries', api.detail(), api.detail() + '/history']) assert.equal((await fetch(api.root + route)).status, 401);
  assert.equal((await api.get(api.detail('auto'))).status, 404);
  assert.equal((await api.patch({ status: 'contacted', version: 1 }, api.detail('auto'))).status, 404);
  const response = await api.get(api.detail()); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.ok(Number(response.headers.get('x-admin-session-expires')) > 0);
  const row = await response.json(); assert.equal(row.name, sample.name); assert.equal(row.question, sample.question); assert.equal(row.businessType, 'Hospitality');
  assert.deepEqual(row.allowedStatuses, WORKFLOW.new); assert.deepEqual(row.history.events, []);
});
test('filtering and cursor pagination are validated, scoped and newest-first with stable ID ties', async t => {
  const api = await fixture(t), store = openInquiryStore(api.file);
  const auto = store.save({ ...sample, business: 'auto' }, 1800000001000);
  store.save(sample, 1800000002000); store.save(sample, 1800000002000); store.close();
  let response = await api.get('/api/admin/inquiries?limit=2'); let page = await response.json();
  assert.equal(page.inquiries.length, 2); assert.equal(page.inquiries[0].createdAt, 1800000002000);
  assert.ok(page.inquiries[0].id > page.inquiries[1].id); assert.ok(page.nextCursor);
  const ids = page.inquiries.map(row => row.id);
  page = await (await api.get('/api/admin/inquiries?limit=2&cursor=' + page.nextCursor)).json();
  assert.deepEqual(page.inquiries.map(row => row.id), [auto, api.id]); assert.equal(page.nextCursor, null);
  assert.equal(new Set([...ids, ...page.inquiries.map(row => row.id)]).size, 4);
  page = await (await api.get('/api/admin/inquiries?business=auto&status=new')).json(); assert.equal(page.inquiries.length, 1); assert.equal(page.inquiries[0].id, auto);
  page = await (await api.get('/api/admin/inquiries?status=won')).json(); assert.deepEqual(page.inquiries, []);
  for (const query of ['business=constructor', 'business=slinfish', 'status=closed', 'status=won&status=new', 'limit=51', 'limit=0', 'cursor=not-json', 'sort=contact', "business='OR%201=1--"]) assert.equal((await api.get('/api/admin/inquiries?' + query)).status, 400);
});
test('explicit workflow, optimistic versions and append-only audit are enforced together', async t => {
  const api = await fixture(t);
  assert.equal((await api.patch({ status: 'won', version: 1 })).status, 400);
  for (const value of [{ status: 'contacted', version: '1' }, { status: 'closed', version: 1 }, { status: 'contacted', version: 1, actor: 99 }, []]) assert.equal((await api.patch(value)).status, 400);
  let version = 1, previous = 'new';
  for (const status of ['contacted', 'qualified', 'won', 'qualified', 'contacted', 'lost', 'contacted']) {
    api.advance(1); const response = await api.patch({ status, version }); assert.equal(response.status, 200);
    const row = await response.json(); assert.equal(row.status, status); assert.equal(row.version, ++version);
    assert.equal(row.history.events[0].previousStatus, previous); assert.equal(row.history.events[0].status, status);
    assert.equal(row.history.events[0].actor, 'Local administrator'); assert.ok(row.history.events[0].createdAt > 0); previous = status;
  }
  assert.equal((await api.patch({ status: 'qualified', version: 1 })).status, 409);
  const history = await (await api.get(api.detail() + '/history')).json(); assert.equal(history.events.length, 7);
  assert.equal((await api.get(api.detail('auto') + '/history')).status, 404);
});
test('two updates using one observed version produce one success, one conflict and one event', async t => {
  const api = await fixture(t);
  const responses = await Promise.all([api.patch({ status: 'contacted', version: 1 }), api.patch({ status: 'lost', version: 1 })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const row = await (await api.get(api.detail())).json(); assert.equal(row.version, 2); assert.equal(row.history.events.length, 1);
});
test('updates enforce session, CSRF, Origin and unknown-field protections without writes', async t => {
  const api = await fixture(t), value = { status: 'contacted', version: 1 };
  for (const headers of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'x'.repeat(43) }, { Origin: 'https://evil.invalid' }]) assert.equal((await api.patch(value, api.detail(), headers)).status, 403);
  assert.equal((await api.patch(value, api.detail(), { Cookie: '' })).status, 401);
  const row = await (await api.get(api.detail())).json(); assert.equal(row.version, 1); assert.deepEqual(row.history.events, []);
  api.advance(30 * 60 * 1000); assert.equal((await api.patch(value)).status, 401); assert.equal((await api.get('/api/admin/inquiries')).status, 401);
});
test('status changes recheck revocation inside the transaction', async t => {
  const api = await fixture(t), store = openInquiryStore(api.file), auth = createAdminAuth(store.admin, () => 1800000000000);
  try {
    const session = auth.authenticate(api.cookie, false, api.root); store.admin.revoke(session.hash, 1800000000001);
    assert.throws(() => store.management.transition('hotel', api.id, { status: 'contacted', version: 1 }, session, api.root, 1800000000002), error => error.status === 401);
    assert.equal(store.get('hotel', api.id).version, 1);
  } finally { store.close(); }
});
test('audit insertion failure rolls back status/version and returns a sanitized error', async t => {
  const api = await fixture(t), db = new DatabaseSync(api.file);
  db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON inquiry_status_events BEGIN SELECT RAISE(ABORT,'PRIVATE_AUDIT_ERROR'); END"); db.close();
  const result = await api.patch({ status: 'contacted', version: 1 }); assert.equal(result.status, 500);
  const text = await result.text(); for (const secret of ['PRIVATE_AUDIT_ERROR', sample.contact, sample.question, api.file]) assert.ok(!text.includes(secret));
  const row = await (await api.get(api.detail())).json(); assert.equal(row.status, 'new'); assert.equal(row.version, 1); assert.equal(row.history.events.length, 0);
});
test('history is paginated and business-scoped without losing earlier events', async t => {
  const api = await fixture(t), store = openInquiryStore(api.file), auth = createAdminAuth(store.admin, () => 1800000000000);
  const session = auth.authenticate(api.cookie, false, api.root);
  try {
    let version = 1;
    for (let i = 0; i < 56; i++) store.management.transition('hotel', api.id, { status: i % 2 ? 'qualified' : 'contacted', version: version++ }, session, api.root, 1800000000000);
  } finally { store.close(); }
  const first = await (await api.get(api.detail() + '/history')).json(); assert.equal(first.events.length, 50); assert.ok(first.nextCursor);
  const second = await (await api.get(api.detail() + '/history?before=' + first.nextCursor)).json(); assert.equal(second.events.length, 6); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.events, ...second.events].map(event => event.id)).size, 56);
});
test('additive v2 migration preserves every legacy field and never guesses won/lost for closed', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'slinfish-legacy-')), file = path.join(dir, 'demo.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = openInquiryStore(file); const id = store.save(sample); store.close();
  let db = new DatabaseSync(file);
  db.exec("DROP TABLE inquiry_status_events; DROP INDEX inquiries_scope; ALTER TABLE inquiries DROP COLUMN workflow_status; PRAGMA user_version=2");
  db.prepare("UPDATE inquiries SET status='closed' WHERE id=?").run(id);
  const before = { ...db.prepare('SELECT * FROM inquiries WHERE id=?').get(id) }; db.close();
  store = openInquiryStore(file);
  const after = { ...store.get('hotel', id) }; const workflow = after.workflow_status; delete after.workflow_status;
  assert.deepEqual(after, before); assert.equal(workflow, null);
  const detail = store.management.detail('hotel', id); assert.equal(detail.status, 'legacy_closed'); assert.deepEqual(detail.allowedStatuses, ['won', 'lost']); assert.deepEqual(detail.history.events, []);
  store.close(); db = new DatabaseSync(file); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3); db.close();
});
