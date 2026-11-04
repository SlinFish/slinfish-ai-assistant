import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createTopicStore, MAX_CONTEXTS, validHandle } from "../src/context.js";
import { createServer } from "../server.js";
import { HANDOFF } from "../src/chat.js";
import { retrieveKnowledge, knowledgeRevision } from "../src/knowledge.js";
import { GEMINI_MODEL } from "../src/gemini.js";

const bytes = readFileSync(new URL("./fixtures/topic-context-evaluation.json", import.meta.url));
const fixture = JSON.parse(bytes);
test("context evaluation is frozen before implementation", () => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "16f20a46dbb2b77b9630bfa3e603579d65d8fb1cb2a6322a48fc88ad56d9a150");
  assert.equal(fixture.cases.length, 15);
});
async function app(t, options = {}) {
  const server = createServer({ chatRateLimit: { limit: 200, globalLimit: 300 }, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const stop = () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  t.after(() => server.listening ? stop() : undefined);
  return { root, stop, post: (message, business = "hotel", headers = {}) => fetch(root + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: root, ...headers }, body: JSON.stringify({ business, message }),
  }), reset: (handle, business = "hotel") => fetch(root + "/api/chat/reset", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: root, "X-Chat-Context": handle }, body: JSON.stringify({ business }),
  }) };
}
const followup = "What information do you need from me?";
const booking = "How do I book a room?";
const safe = (result) => assert.deepEqual(result, { message: HANDOFF, handoff: true, mode: "demo", sources: [] });

for (const scenario of fixture.cases) test(`context fixture: ${scenario.name}`, async (t) => {
  let time = 1800000000000, api = await app(t, { now: () => time });
  let handle = "", sequence = 0;
  for (const step of scenario.steps) {
    time += step.advance || 0;
    if (step.reset) { assert.equal((await api.reset(handle)).status, 200); continue; }
    if (step.restart) { await api.stop(); api = await app(t, { now: () => time }); continue; }
    const headers = scenario.stateless ? {} : { "X-Chat-Context": step.handle || handle || "new" };
    if (!scenario.stateless && headers["X-Chat-Context"] !== "new") headers["X-Chat-Sequence"] = String(sequence + 1);
    const response = await api.post(step.message, step.business || "hotel", headers);
    assert.equal(response.status, 200);
    const result = await response.json();
    if (step.answer) {
      const fact = retrieveKnowledge(step.business || "hotel").facts.find((fact) => fact.id === step.answer);
      assert.deepEqual(result, { message: fact.text, mode: "demo", handoff: false, sources: [`${step.business || "hotel"}:${fact.id}`] });
    } else safe(result);
    handle = response.headers.get("x-chat-context") || "";
    sequence = Number(response.headers.get("x-chat-sequence") || 0);
    if (scenario.stateless) assert.equal(response.headers.get("x-chat-context"), null);
  }
});

test("store is bounded, metadata only, unpredictably keyed, and revision bound", (t) => {
  let time = 1000;
  const store = createTopicStore(() => time);
  t.after(() => store.clear());
  const handles = new Set();
  for (let i = 0; i < MAX_CONTEXTS; i++) {
    const result = store.finish(undefined, "hotel", "booking");
    assert.ok(validHandle(result.handle)); handles.add(result.handle);
  }
  assert.equal(handles.size, 1000); assert.equal(store.size, 1000);
  assert.equal(store.finish(undefined, "hotel", "booking").capacity, true);
  const handle = [...handles][0];
  const { record } = store.begin(handle, "hotel", 2);
  assert.deepEqual(Object.keys(record).sort(), ["handle", "businessId", "factId", "followupType", "knowledgeRevision", "createdAt", "lastActivity", "turns", "sequence", "busy"].sort());
  assert.equal(record.knowledgeRevision, knowledgeRevision);
  record.knowledgeRevision = "obsolete";
  assert.equal(store.finish(record, "hotel", "booking").valid, false);
  time += 180000;
  assert.equal(store.size, 0);
  assert.equal(store.finish(undefined, "hotel", "booking").valid, true);
});

test("server validates context syntax, sequence, reset origin and scope; replay cannot restore state", async (t) => {
  const api = await app(t);
  const first = await api.post(booking, "hotel", { "X-Chat-Context": "new" });
  const handle = first.headers.get("x-chat-context");
  assert.equal((await api.reset(handle, "auto")).status, 200);
  assert.equal((await api.post(followup, "hotel", { "X-Chat-Context": handle, "X-Chat-Sequence": "2" })).status, 200);
  safe(await (await api.post(followup, "hotel", { "X-Chat-Context": handle, "X-Chat-Sequence": "2" })).json());
  safe(await (await api.post(followup, "hotel", { "X-Chat-Context": handle, "X-Chat-Sequence": "3" })).json());
  for (const headers of [{ "X-Chat-Context": "bad" }, { "X-Chat-Context": "x".repeat(1001) }, { "X-Chat-Context": "new", "X-Chat-Sequence": "1" }, { "X-Chat-Sequence": "1" }, { "X-Chat-Context": handle }, { "X-Chat-Context": handle, "X-Chat-Sequence": "2, 3" }])
    assert.equal((await api.post(followup, "hotel", headers)).status, 400);
  const reset = await fetch(api.root + "/api/chat/reset", { method: "POST", headers: { "Content-Type": "application/json", "X-Chat-Context": handle }, body: JSON.stringify({ business: "hotel" }) });
  assert.equal(reset.status, 403);
});

test("busy requests and reset during provider await cannot revive context or leak headers", async (t) => {
  let pending = false, entered, release;
  const ready = new Promise((resolve) => { entered = resolve; });
  const api = await app(t, { config: { provider: "gemini", model: GEMINI_MODEL, apiKey: "synthetic-key", timeoutMs: 1000 }, fetchImpl: async (_, options) => {
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.contents, [{ role: "user", parts: [{ text: "booking" }] }]);
    assert.deepEqual(JSON.parse(payload.systemInstruction.parts[1].text), retrieveKnowledge("hotel"));
    assert.equal(options.headers["X-Chat-Context"], undefined);
    assert.equal(options.headers.Cookie, undefined);
    if (pending) { entered(); await new Promise((resolve) => { release = resolve; }); }
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ factId: "booking", confident: true }) }] } }] });
  } });
  const initial = await api.post(booking, "hotel", { "X-Chat-Context": "new" });
  const handle = initial.headers.get("x-chat-context");
  pending = true;
  const headers = { "X-Chat-Context": handle, "X-Chat-Sequence": "2" };
  const inFlight = api.post(followup, "hotel", headers);
  await ready;
  assert.equal((await api.post(followup, "hotel", headers)).status, 409);
  assert.equal((await api.reset(handle)).status, 200);
  release();
  const late = await inFlight;
  assert.equal(late.headers.get("x-chat-context"), "");
  assert.equal((await late.json()).handoff, true);
  assert.equal((await (await api.post(followup, "hotel", { ...headers, "X-Chat-Sequence": "3" })).json()).handoff, true);
});

test("expiry during an in-flight request and invalid bodies invalidate leased context", async (t) => {
  let time = 1;
  const store = createTopicStore(() => time); t.after(() => store.clear());
  const first = store.finish(undefined, "hotel", "booking");
  const { record } = store.begin(first.handle, "hotel", 2);
  time += 180000;
  assert.equal(store.finish(record, "hotel", "booking").valid, false);
  const api = await app(t);
  const response = await api.post(booking, "hotel", { "X-Chat-Context": "new" });
  const handle = response.headers.get("x-chat-context");
  assert.equal((await api.post("", "hotel", { "X-Chat-Context": handle, "X-Chat-Sequence": "2" })).status, 400);
  safe(await (await api.post(followup, "hotel", { "X-Chat-Context": handle, "X-Chat-Sequence": "2" })).json());
});

test("busy rejection preserves the first lease; wrong scope and clock rollback fail closed", (t) => {
  let time = 1000;
  const store = createTopicStore(() => time); t.after(() => store.clear());
  let first = store.finish(undefined, "hotel", "booking");
  let lease = store.begin(first.handle, "hotel", 2);
  assert.equal(store.begin(first.handle, "hotel", 2).status, "busy");
  assert.equal(store.finish(lease.record, "hotel", "booking").valid, true);
  assert.equal(store.begin(first.handle, "auto", 3).status, "missing");
  assert.equal(store.begin(first.handle, "hotel", 3).status, "missing");
  first = store.finish(undefined, "hotel", "booking");
  time = 999;
  assert.equal(store.begin(first.handle, "hotel", 2).status, "missing");
});
