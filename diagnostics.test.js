import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, HANDOFF } from './src/chat.js';
import { providerConfig } from './src/provider.js';
import { GEMINI_MODEL } from './src/gemini.js';
import { businesses } from './src/knowledge.js';
import { createServer } from './server.js';
import { ProviderFailure, reportFailure } from './src/diagnostics.js';

const secret = 'fictional-secret-do-not-log';
const customer = 'fictional-private-message-do-not-log';
const config = { provider: 'gemini', model: GEMINI_MODEL, apiKey: secret, timeoutMs: 100, diagnostics: true };
function capture(t) {
  const lines = [];
  t.mock.method(console, 'error', (...args) => { assert.equal(args.length, 1); lines.push(args[0]); });
  return lines;
}
function record(lines, category, phase, status) {
  assert.equal(lines.length, 1);
  const result = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(result).sort(), ['event', 'provider', 'category', 'phase', 'httpStatus', 'elapsedMs'].sort());
  assert.equal(result.event, 'ai_provider_failure');
  assert.equal(result.provider, 'gemini');
  assert.equal(result.category, category);
  assert.equal(result.phase, phase);
  assert.equal(result.httpStatus, status);
  assert.ok(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0);
  for (const privateText of [secret, customer, JSON.stringify(businesses.hotel), 'Authorization', 'x-goog-api-key']) assert.ok(!lines[0].includes(privateText));
}
function unavailable(result) {
  assert.deepEqual(result, { message: HANDOFF, handoff: true, mode: 'gemini', sources: [], error: 'assistant_unavailable' });
}

test('diagnostics require exact explicit opt-in; disabled failures produce no local logs', async t => {
  const lines = capture(t);
  for (const value of [undefined, '0', 'true', 'yes', '']) assert.equal(providerConfig({ AI_DIAGNOSTICS: value }).diagnostics, false);
  assert.equal(providerConfig({ AI_DIAGNOSTICS: '1' }).diagnostics, true);
  const result = await createChat({ ...config, diagnostics: false }, async () => { throw new Error(secret); })('hotel', customer);
  unavailable(result);
  assert.deepEqual(lines, []);
});

test('HTTP status distinguishes quota, auth, model/method access, compatibility and upstream errors without body logs', async t => {
  const lines = capture(t);
  for (const [status, category] of [[429, 'quota_error'], [401, 'authentication_error'], [403, 'model_access_error'], [404, 'model_access_error'], [400, 'request_rejected'], [422, 'request_rejected'], [500, 'http_error'], [503, 'http_error']]) {
    lines.length = 0;
    let calls = 0;
    const result = await createChat(config, async () => {
      calls++;
      return Response.json({ error: { message: secret, details: customer, knowledge: businesses.hotel } }, { status, headers: { 'x-private-header': secret } });
    })('hotel', customer);
    unavailable(result);
    record(lines, category, 'response_body', status);
    assert.equal(calls, 1);
  }
});

test('known HTTP status is classified without waiting for a stalled rejected body cleanup', async t => {
  const lines = capture(t);
  const result = await createChat({ ...config, timeoutMs: 10 }, async () => ({
    status: 404, ok: false, body: { cancel: () => new Promise(() => {}) }
  }))('hotel', customer);
  unavailable(result);
  record(lines, 'model_access_error', 'response_body', 404);
});

test('network exception messages, stacks, causes, codes and invented categories are never logged', async t => {
  const lines = capture(t);
  const error = Object.assign(new Error(`${secret} ${customer}`), { code: secret, cause: { Authorization: secret }, category: 'quota_error' });
  unavailable(await createChat(config, async () => { throw error; })('hotel', customer));
  record(lines, 'network_error', 'request', null);
});

test('deadline distinguishes timeout from network failure and logs once after abort', async t => {
  const lines = capture(t);
  let calls = 0;
  const result = await createChat({ ...config, timeoutMs: 10 }, async (_, options) => {
    calls++;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error(secret)), { once: true }));
  })('hotel', customer);
  unavailable(result);
  record(lines, 'timeout', 'request', null);
  assert.equal(calls, 1);
});

test('stalled response body logs timeout with upstream 200 and body phase', async t => {
  const lines = capture(t);
  unavailable(await createChat({ ...config, timeoutMs: 10 }, async () => new Response(new ReadableStream({ start() {} })))('hotel', customer));
  record(lines, 'timeout', 'response_body', 200);
});

test('body transport failure is distinct from malformed JSON', async t => {
  const lines = capture(t);
  unavailable(await createChat(config, async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } })))('hotel', customer));
  record(lines, 'network_error', 'response_body', 200);
});

test('invalid JSON, schema, blocked and truncated completions log invalid_response without provider content', async t => {
  const lines = capture(t);
  const responses = [
    () => new Response(`${secret} ${customer}`),
    () => Response.json({ error: { message: secret } }),
    () => Response.json({ promptFeedback: { blockReason: secret } }),
    () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: secret }] } }] }),
    () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ factId: 'check-in', confident: secret }) }] } }] })
  ];
  for (const response of responses) {
    lines.length = 0;
    unavailable(await createChat(config, async () => response())('hotel', customer));
    record(lines, 'invalid_response', 'response_validation', 200);
  }
});

test('oversized provider response is classified safely before parsing', async t => {
  const lines = capture(t);
  unavailable(await createChat(config, async () => new Response(secret.repeat(2000)))('hotel', customer));
  record(lines, 'invalid_response', 'response_body', 200);
});

test('logging uses allowlisted fields and values instead of redacting arbitrary input text', t => {
  const lines = capture(t);
  const error = new ProviderFailure('http_error');
  error.category = secret;
  reportFailure({ ...config, provider: secret }, error, { phase: secret, status: secret, elapsedMs: secret });
  const result = JSON.parse(lines[0]);
  assert.equal(result.provider, 'unknown');
  assert.equal(result.category, 'network_error');
  assert.equal(result.phase, 'request');
  assert.equal(result.httpStatus, null);
  assert.equal(result.elapsedMs, 0);
  assert.ok(!lines[0].includes(secret));
});

test('local logging failures cannot replace the public handoff', async t => {
  t.mock.method(console, 'error', () => { throw new Error('local sink unavailable'); });
  unavailable(await createChat(config, async () => new Response('', { status: 404 }))('hotel', customer));
});

test('successful grounded/unknown selections and demo mode produce no failure logs', async t => {
  const lines = capture(t);
  for (const factId of ['check-in', null]) {
    const result = await createChat(config, async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ factId, confident: factId !== null }) }] } }] }))('hotel', customer);
    assert.equal(result.handoff, factId === null);
  }
  const result = await createChat({ ...config, provider: 'demo' }, async () => { assert.fail('Demo must not call a provider'); })('hotel', 'What is check-in?');
  assert.equal(result.handoff, false);
  assert.deepEqual(lines, []);
});

test('diagnostics are local-only: public HTTP errors stay sanitized and no diagnostic route exists', async t => {
  const lines = capture(t);
  const server = createServer({ config, fetchImpl: async () => Response.json({ error: { message: secret } }, { status: 404 }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(root + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business: 'hotel', message: customer }) });
  assert.equal(response.status, 503);
  unavailable(await response.json());
  record(lines, 'model_access_error', 'response_body', 404);
  for (const route of ['/api/diagnostics', '/src/diagnostics.js']) assert.equal((await fetch(root + route)).status, 404);
});
