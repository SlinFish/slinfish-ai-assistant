import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runDiagnostic } from './scripts/gemini-http-diagnostic.js';
import { ERROR_BODY_LIMIT, parseFieldDetails, readBoundedBody } from './scripts/lib/gemini-error-details.js';
import { geminiRequest, GEMINI_MODEL } from './src/gemini.js';
import { INSTRUCTION } from './src/provider.js';
import { retrieveKnowledge } from './src/knowledge.js';
import { createServer } from './server.js';
const sensitive = 'FICTIONAL_PRIVATE_SECRET';
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const badRequest = fields => ({ error: {
  message: sensitive, details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: fields.map(field => ({ field, description: sensitive, reason: sensitive })) }]
} });
const stream = bytes => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
const offline = input => runDiagnostic({ args: ['--offline', '--status', '400'], input: stream(input), fetchImpl: () => assert.fail('Offline must not contact Google') });
function safe(result) {
  assert.deepEqual(Object.keys(result).sort(), ['httpStatus', 'category', 'fieldGroups'].sort());
  assert.ok(result.httpStatus === null || Number.isInteger(result.httpStatus));
  assert.ok(!JSON.stringify(result).includes(sensitive));
}

test('field diagnostics map canonical and snake-case Google violations to fixed groups only', async () => {
  const result = await offline(encode(badRequest([
    'generationConfig.thinkingConfig.thinkingLevel', 'generation_config.response_schema.properties[0].value.enum[1]',
    'generationConfig.responseMimeType', 'system_instruction.parts[0].text', 'contents[0].parts[0].text',
    'generation_config.max_output_tokens', 'generation_config.thinking_config.thinking_level'
  ])));
  assert.deepEqual(result, { httpStatus: 400, category: 'field_violations', fieldGroups: ['contents', 'max_output_tokens', 'response_mime_type', 'response_schema', 'system_instruction', 'thinking_config'] });
  safe(result);
});

test('Google snake-case field_violations is supported without echoing descriptions', () => {
  const body = { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', field_violations: [{ field: 'generation_config.response_schema', description: sensitive }] }] } };
  assert.deepEqual(parseFieldDetails(400, encode(body)).fieldGroups, ['response_schema']);
});

test('no_safe_field_details covers missing, malformed and unrecognized structured information', async () => {
  const values = [null, [], 'message', {}, { error: null }, { error: { message: sensitive } }, badRequest([]), badRequest([sensitive]), badRequest(['contents\n']),
    { error: { details: [{ '@type': 'google.rpc.BadRequest', fieldViolations: [{ field: 'contents' }] }] } },
    { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: sensitive, metadata: { field: 'contents' } }] } },
    { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: sensitive }] } }
  ];
  for (const value of values) {
    const result = await offline(encode(value));
    assert.deepEqual(result, { httpStatus: 400, category: 'no_safe_field_details', fieldGroups: [] });
    safe(result);
  }
  for (const bytes of [new TextEncoder().encode(sensitive), new Uint8Array([255, 254])]) assert.equal((await offline(bytes)).category, 'no_safe_field_details');
});

test('malicious paths, type tags, control text, prototype keys and nested private values cannot leak', async () => {
  const body = badRequest([
    'systemInstruction.' + sensitive, // Recognized root; suffix must never be output.
    'generationConfig.responseSchema.properties.' + sensitive,
    'systemInstructionSECRET', 'contents[99999999999]', 'contents\n' + sensitive,
    '__proto__.contents', 'constructor.prototype.contents', sensitive
  ]);
  body.error.details.push({ '@type': 'type.googleapis.com/google.rpc.BadRequest' + sensitive, fieldViolations: [{ field: 'contents' }] });
  body.error.headers = { Authorization: sensitive, 'x-goog-api-key': sensitive };
  body.error.customer = sensitive;
  body.error.businessKnowledge = retrieveKnowledge('hotel');
  const result = await offline(encode(body));
  assert.deepEqual(result.fieldGroups, ['response_schema', 'system_instruction']);
  safe(result);
  assert.ok(!JSON.stringify(result).includes('Aster House'));
  const polluted = parseFieldDetails(400, new TextEncoder().encode('{"__proto__":{"error":{"details":[]}},"error":{"message":"' + sensitive + '"}}'));
  assert.equal(polluted.category, 'no_safe_field_details');
  assert.equal({}.error, undefined);
});

test('invalid status values cannot be reflected in output', () => {
  for (const status of [sensitive, 400.5, Infinity, 99, 600]) {
    const result = parseFieldDetails(status, encode(badRequest(['contents'])));
    assert.equal(result.httpStatus, null);
    safe(result);
  }
});

test('strict 32 KiB limit accepts the boundary and discards oversized input without partial parsing', async () => {
  const json = new TextEncoder().encode(JSON.stringify(badRequest(['contents'])));
  const boundary = new Uint8Array(ERROR_BODY_LIMIT).fill(32);
  boundary.set(json);
  assert.equal((await offline(boundary)).category, 'field_violations');
  const oversized = new Uint8Array(ERROR_BODY_LIMIT + 1).fill(32);
  oversized.set(json);
  assert.equal((await offline(oversized)).category, 'no_safe_field_details');
  assert.equal(parseFieldDetails(400, oversized).category, 'no_safe_field_details');
});

test('limits apply cumulatively to chunks and oversized streams are cancelled', async () => {
  let cancelled = false;
  const input = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(ERROR_BODY_LIMIT)); controller.enqueue(new Uint8Array(1));
  }, cancel() { cancelled = true; } });
  assert.equal(await readBoundedBody(input, new AbortController().signal), null);
  assert.equal(cancelled, true);
});

test('structural caps ignore excessive details and violations', () => {
  const body = { error: { details: Array.from({ length: 16 }, () => ({})) } };
  body.error.details.push(...badRequest(['contents']).error.details);
  assert.equal(parseFieldDetails(400, encode(body)).category, 'no_safe_field_details');
  const violations = Array.from({ length: 32 }, () => sensitive);
  violations.push('contents');
  assert.equal(parseFieldDetails(400, encode(badRequest(violations))).category, 'no_safe_field_details');
});

test('default invocation and flags never opt in via environment or leak arguments', async () => {
  const never = () => assert.fail('Must not contact Google');
  const env = { GEMINI_API_KEY: sensitive, AI_PROVIDER: 'gemini', AI_DIAGNOSTICS: '1' };
  assert.equal((await runDiagnostic({ env, fetchImpl: never })).category, 'diagnostic_disabled');
  for (const args of [['--api-key', sensitive], ['--offline', '--status', sensitive], ['--live-once', '--live-once'], ['--live'], ['--offline', '--status', '400', sensitive]]) {
    const result = await runDiagnostic({ args, env, fetchImpl: never });
    assert.equal(result.category, 'invalid_arguments'); safe(result);
  }
  assert.equal((await runDiagnostic({ args: ['--live-once'], env, fetchImpl: never })).category, 'local_terminal_required');
});

test('future live path requires explicit mode, private terminal and valid pinned configuration', async () => {
  for (const env of [{}, { GEMINI_API_KEY: sensitive, AI_MODEL: 'other-model' }, { GEMINI_API_KEY: sensitive, AI_TIMEOUT_MS: 'bad' }]) {
    const result = await runDiagnostic({ args: ['--live-once'], interactive: true, env, fetchImpl: () => assert.fail('Invalid config must not call Google') });
    assert.equal(result.category, 'configuration_error'); safe(result);
  }
});

test('synthetic live transport matches the production request exactly, with header-only key and one call', async () => {
  let calls = 0;
  const result = await runDiagnostic({ args: ['--live-once'], interactive: true, env: { GEMINI_API_KEY: sensitive, AI_DIAGNOSTICS: '1' }, fetchImpl: async (url, options) => {
    calls++;
    const expected = geminiRequest(retrieveKnowledge('hotel'), 'What is check-in?', { apiKey: sensitive }, INSTRUCTION);
    assert.equal(url, expected.url);
    assert.deepEqual(options.headers, expected.headers);
    assert.deepEqual(JSON.parse(options.body), expected.body);
    assert.equal(options.redirect, 'error');
    assert.ok(!url.includes(sensitive));
    assert.ok(!options.body.includes(sensitive));
    assert.ok(url.includes(GEMINI_MODEL));
    return Response.json(badRequest(['generationConfig.thinkingConfig.thinkingLevel']), { status: 400 });
  } });
  assert.equal(calls, 1); assert.equal(result.httpStatus, 400);
  assert.deepEqual(result.fieldGroups, ['thinking_config']); safe(result);
});

test('network failures and stalled bodies return fixed metadata, with no exception messages', async () => {
  const base = { args: ['--live-once'], interactive: true, env: { GEMINI_API_KEY: sensitive, AI_TIMEOUT_MS: '100' } };
  const failure = await runDiagnostic({ ...base, fetchImpl: async () => { throw Object.assign(new Error(sensitive), { cause: sensitive, stack: sensitive }); } });
  assert.deepEqual(failure, { httpStatus: null, category: 'network_error', fieldGroups: [] });
  const timedOut = await runDiagnostic({ ...base, fetchImpl: async () => new Response(new ReadableStream({ start() {} }), { status: 400 }) });
  assert.deepEqual(timedOut, { httpStatus: 400, category: 'timeout', fieldGroups: [] });
  const offlineTimeout = await runDiagnostic({ args: ['--offline', '--status', '400'], input: new ReadableStream({ start() {} }), offlineTimeoutMs: 10 });
  assert.equal(offlineTimeout.category, 'timeout');
});

test('successful responses are not read or displayed and do not claim grounded answer validation', async () => {
  let cancelled = false;
  const result = await runDiagnostic({ args: ['--live-once'], interactive: true, env: { GEMINI_API_KEY: sensitive }, fetchImpl: async () => ({
    ok: true, status: 200, body: { cancel() { cancelled = true; return Promise.resolve(); }, getReader() { assert.fail('Must not read success content'); } }
  }) });
  assert.deepEqual(result, { httpStatus: 200, category: 'http_success', fieldGroups: [] });
  assert.equal(cancelled, true);
});

test('CLI emits only one metadata JSON line, no stderr, using synthetic stdin and credentials', () => {
  const cli = fileURLToPath(new URL('./scripts/gemini-http-diagnostic.js', import.meta.url));
  for (const [args, input, category] of [
    [[], '', 'diagnostic_disabled'],
    [['--offline', '--status', '400'], JSON.stringify(badRequest(['contents'])), 'field_violations'],
    [['--offline', '--status', '400'], sensitive, 'no_safe_field_details'],
    [['--offline', '--status', '400'], 'x'.repeat(ERROR_BODY_LIMIT + 1), 'no_safe_field_details'],
    [['--api-key', sensitive], '', 'invalid_arguments']
  ]) {
    const child = spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: { GEMINI_API_KEY: sensitive } });
    assert.equal(child.error, undefined);
    assert.equal(child.status, category === 'diagnostic_disabled' ? 0 : 1);
    assert.equal(child.stderr, '');
    const lines = child.stdout.trim().split('\n');
    assert.equal(lines.length, 1);
    const result = JSON.parse(lines[0]);
    assert.equal(result.category, category); safe(result);
  }
});

test('CLI and parser are inaccessible through public routes and normal requests remain demo mode', async t => {
  const server = createServer({ config: { provider: 'demo' }, fetchImpl: () => assert.fail('Demo must not call Google') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const root = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/scripts/gemini-http-diagnostic.js', '/scripts/lib/gemini-error-details.js', '/api/gemini-http-diagnostic']) assert.equal((await fetch(root + route)).status, 404);
  const response = await fetch(root + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business: 'hotel', message: 'What is check-in?' }) });
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.mode, 'demo'); assert.equal(result.handoff, false);
});
