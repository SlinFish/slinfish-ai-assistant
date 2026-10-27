import test from "node:test";
import assert from "node:assert/strict";
import { GEMINI_MODEL } from "./src/gemini.js";
import { providerConfig } from "./src/provider.js";
import { createChat, HANDOFF } from "./src/chat.js";
import { businesses, retrieveKnowledge } from "./src/knowledge.js";
import { createServer } from "./server.js";

const config = {
  provider: "gemini",
  model: GEMINI_MODEL,
  apiKey: "fictional-gemini-test-key",
  timeoutMs: 100,
};
const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const envelope = (selection) => ({
  candidates: [
    {
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify(selection) }] },
    },
  ],
});
const complete = (selection) => Response.json(envelope(selection));

test("Gemini configuration uses its own server key and pinned model; demo remains default", () => {
  const selected = providerConfig({
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: config.apiKey,
  });
  assert.equal(selected.model, GEMINI_MODEL);
  assert.equal(selected.apiKey, config.apiKey);
  assert.equal(
    providerConfig({ GEMINI_API_KEY: config.apiKey, AI_API_KEY: "unused" })
      .provider,
    "demo",
  );
  assert.equal(
    providerConfig({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: config.apiKey,
      AI_MODEL: GEMINI_MODEL,
    }).model,
    GEMINI_MODEL,
  );
  for (const env of [
    { AI_PROVIDER: "gemini" },
    { AI_PROVIDER: "gemini", AI_API_KEY: "wrong-provider" },
    { AI_PROVIDER: "gemini", GEMINI_API_KEY: " " },
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: config.apiKey,
      AI_MODEL: "gemini-4-argon",
    },
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: config.apiKey,
      AI_MODEL: "../another-model",
    },
  ])
    assert.throws(() => providerConfig(env));
});

test("Gemini uses official REST endpoint and header key with only scoped knowledge", async () => {
  for (const [business, record] of Object.entries(businesses)) {
    let calls = 0;
    const chat = createChat(config, async (url, options) => {
      calls++;
      assert.equal(url, endpoint);
      assert.ok(!url.includes(config.apiKey));
      assert.equal(options.headers["x-goog-api-key"], config.apiKey);
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      const payload = JSON.parse(options.body);
      assert.deepEqual(
        JSON.parse(payload.systemInstruction.parts[1].text),
        retrieveKnowledge(business),
      );
      assert.deepEqual(payload.contents, [
        { role: "user", parts: [{ text: record.faqs[0].questions[0] }] },
      ]);
      assert.equal(
        Object.hasOwn(payload.generationConfig, "candidateCount"),
        false,
        "Gemini must not receive unsupported candidateCount",
      );
      assert.equal(
        Object.hasOwn(payload.generationConfig, "temperature"),
        false,
        "Gemini must not receive deprecated temperature",
      );
      assert.deepEqual(payload.generationConfig, {
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingLevel: "MINIMAL" },
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          required: ["factId", "confident"],
          properties: {
            factId: {
              type: "STRING",
              nullable: true,
              enum: record.faqs.map((f) => f.id),
            },
            confident: { type: "BOOLEAN" },
          },
        },
      });
      assert.equal(payload.tools, undefined);
      assert.ok(!options.body.includes(config.apiKey));
      return complete({ factId: record.faqs[0].id, confident: true });
    });
    const result = await chat(business, record.faqs[0].questions[0]);
    assert.equal(result.message, record.faqs[0].text);
    assert.deepEqual(result.sources, [`${business}:${record.faqs[0].id}`]);
    assert.equal(result.mode, "gemini");
    assert.equal(result.handoff, false);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(config.apiKey));
  }
});

test("Gemini uncertainty and foreign fact IDs produce handoff", async () => {
  for (const selection of [
    { factId: null, confident: false },
    { factId: "check-in", confident: false },
    { factId: "price", confident: true },
    { factId: "__proto__", confident: true },
  ]) {
    const result = await createChat(config, async () => complete(selection))(
      "hotel",
      "check-in",
    );
    assert.equal(result.message, HANDOFF);
    assert.equal(result.handoff, true);
    assert.deepEqual(result.sources, []);
  }
});

test("Gemini explicit cross-business references are rejected without any API call", async () => {
  let calls = 0;
  const result = await createChat(config, async () => {
    calls++;
    return complete({ factId: "check-in", confident: true });
  })("hotel", "When is check-in at Harbor Auto Service?");
  assert.equal(result.handoff, true);
  assert.equal(calls, 0);
});

test("Gemini quota and other HTTP errors are sanitized with one call and no paid fallback", async () => {
  for (const status of [429, 400, 401, 403, 404, 500, 503]) {
    let calls = 0;
    const result = await createChat(config, async (url) => {
      calls++;
      assert.equal(url, endpoint);
      return Response.json(
        {
          error: {
            code: status,
            status: "RESOURCE_EXHAUSTED",
            message: config.apiKey,
          },
        },
        { status },
      );
    })("hotel", "check-in");
    assert.equal(result.error, "assistant_unavailable");
    assert.equal(result.message, HANDOFF);
    assert.ok(!JSON.stringify(result).includes(config.apiKey));
    assert.equal(calls, 1);
  }
});

test("Gemini network and redirect failures return safe handoff without retry", async () => {
  let calls = 0;
  const result = await createChat(config, async () => {
    calls++;
    throw new Error(config.apiKey);
  })("hotel", "check-in");
  assert.equal(result.error, "assistant_unavailable");
  assert.equal(result.message, HANDOFF);
  assert.equal(calls, 1);
});

test("Gemini refuses malformed, blocked, truncated, oversized and unsafe responses", async () => {
  const responses = [
    () => new Response("not json"),
    () => new Response("x".repeat(32769)),
    () => Response.json({}),
    () => Response.json({ candidates: [] }),
    () => Response.json({ promptFeedback: { blockReason: "SAFETY" } }),
    () =>
      Response.json({
        candidates: [
          {
            ...envelope({ factId: "check-in", confident: true }).candidates[0],
            finishReason: "MAX_TOKENS",
          },
        ],
      }),
    () =>
      Response.json({
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: "not json" }] } },
        ],
      }),
    () =>
      Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "{}", thought: true }] },
          },
        ],
      }),
    () =>
      Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ functionCall: { name: "invent" } }] },
          },
        ],
      }),
    () =>
      Response.json({
        candidates: [
          ...envelope({ factId: null, confident: false }).candidates,
          ...envelope({ factId: null, confident: false }).candidates,
        ],
      }),
    () =>
      complete({
        factId: "check-in",
        confident: true,
        message: "Invented facts",
      }),
    () => complete({ factId: "check-in", confident: "true" }),
    () => complete(null),
  ];
  for (const response of responses) {
    const result = await createChat(config, async () => response())(
      "hotel",
      "check-in",
    );
    assert.equal(result.error, "assistant_unavailable");
    assert.equal(result.message, HANDOFF);
  }
});

test("Gemini timeout aborts upstream and never switches provider", async () => {
  let signal,
    calls = 0;
  const result = await createChat(
    { ...config, timeoutMs: 10 },
    async (url, options) => {
      calls++;
      assert.equal(url, endpoint);
      signal = options.signal;
      return new Promise(() => {});
    },
  )("hotel", "check-in");
  assert.equal(signal.aborted, true);
  assert.equal(result.error, "assistant_unavailable");
  assert.equal(calls, 1);
});

test("Gemini timeout also covers stalled response bodies", async () => {
  const result = await createChat(
    { ...config, timeoutMs: 10 },
    async () => new Response(new ReadableStream({ start() {} })),
  )("hotel", "check-in");
  assert.equal(result.error, "assistant_unavailable");
  assert.equal(result.handoff, true);
});

test("Gemini HTTP route preserves grounded results and returns 503 for quota exhaustion", async (t) => {
  let quota = false;
  const server = createServer({
    config,
    fetchImpl: async () =>
      quota
        ? Response.json(
            { error: { status: "RESOURCE_EXHAUSTED" } },
            { status: 429 },
          )
        : complete({ factId: "check-in", confident: true }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const root = `http://127.0.0.1:${server.address().port}`;
  async function ask() {
    return fetch(root + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business: "hotel", message: "What is check-in?" }),
    });
  }
  const answer = await ask();
  assert.equal(answer.status, 200);
  assert.equal((await answer.json()).message, businesses.hotel.faqs[0].text);
  quota = true;
  const unavailable = await ask();
  assert.equal(unavailable.status, 503);
  const result = await unavailable.json();
  assert.equal(result.message, HANDOFF);
  assert.ok(!JSON.stringify(result).includes(config.apiKey));
  assert.ok(!JSON.stringify(result).includes("RESOURCE_EXHAUSTED"));
  for (const route of ["/", "/app.js", "/api/businesses"]) {
    const body = await (await fetch(root + route)).text();
    assert.ok(!body.includes(config.apiKey));
  }
});
