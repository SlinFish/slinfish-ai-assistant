// AI-2B.3A prospective evaluation. Run explicitly:
// node --test scripts/evaluate-conversation.js
// Kept outside test/ so that npm test remains the passing release baseline.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../server.js";
import { HANDOFF } from "../src/chat.js";
import { retrieveKnowledge } from "../src/knowledge.js";

const fixture = JSON.parse(readFileSync(new URL("../test/fixtures/conversation-evaluation.json", import.meta.url)));
assert.equal(fixture.phase, "AI-2B.3A");
assert.equal(fixture.cases.length, 16);

async function start(t, now) {
  const server = createServer({ now, chatRateLimit: { limit: 200, globalLimit: 300 } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { if (!server.listening) return resolve(); server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

for (const scenario of fixture.cases) {
  test(`AI-2B.3A: ${scenario.name}`, async t => {
    let clock = 1800000000000;
    const origin = await start(t, () => clock);
    let business = scenario.business ?? "hotel";
    let handle = "";
    let sequence = 0;

    for (const step of scenario.steps) {
      clock += step.advance ?? 0;

      if (step.switchBusiness) {
        if (handle) {
          const response = await fetch(origin + "/api/chat/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: origin, "X-Chat-Context": handle },
            body: JSON.stringify({ business }),
          });
          assert.equal(response.status, 200);
        }
        business = step.switchBusiness;
        handle = "";
        sequence = 0;
        continue;
      }
      if (step.reset) {
        assert.ok(handle, "reset requires an active context");
        const response = await fetch(origin + "/api/chat/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin, "X-Chat-Context": handle },
          body: JSON.stringify({ business }),
        });
        assert.equal(response.status, 200);
        handle = "";
        sequence = 0;
        continue;
      }

      const currentBusiness = step.business ?? business;
      const headers = { "Content-Type": "application/json", Origin: origin };
      if (!scenario.stateless) {
        headers["X-Chat-Context"] = handle || "new";
        if (handle) headers["X-Chat-Sequence"] = String(sequence + 1);
      }
      const response = await fetch(origin + "/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ business: currentBusiness, message: step.message }),
      });
      assert.equal(response.status, 200, `unexpected HTTP status for ${step.message}`);
      const result = await response.json();
      if (step.answer) {
        const fact = retrieveKnowledge(currentBusiness).facts.find(item => item.id === step.answer);
        assert.ok(fact, `missing fixture fact ${currentBusiness}:${step.answer}`);
        assert.deepEqual(result, {
          message: fact.text, handoff: false, mode: "demo", sources: [`${currentBusiness}:${step.answer}`],
        }, `unexpected grounded answer for ${step.message}`);
      } else {
        assert.deepEqual(result, { message: HANDOFF, handoff: true, mode: "demo", sources: [] },
          `unsafe or unexpected answer for ${step.message}`);
      }

      if (scenario.stateless) {
        assert.equal(response.headers.get("x-chat-context"), null);
      } else {
        handle = response.headers.get("x-chat-context") || "";
        sequence = Number(response.headers.get("x-chat-sequence") || 0);
      }
    }
  });
}
