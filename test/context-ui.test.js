import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const code = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const token = "a".repeat(43);
const response = (message, handle = token, sequence = 1) => ({ ok: true,
  headers: { get: (key) => key === "x-chat-context" ? handle : key === "x-chat-sequence" ? String(sequence) : null },
  json: async () => ({ message, handoff: false }),
});
async function page(handler) {
  const elements = new Map();
  function element() { return { value: "", textContent: "", children: [], button: { disabled: false },
    append(value) { this.children.push(value); }, replaceChildren() { this.children = []; }, reset() {}, querySelector() { return this.button; } }; }
  for (const id of ["businesses", "messages", "name", "status", "lead", "chat", "question", "reset-chat"]) elements.set(id, element());
  const calls = [];
  const context = vm.createContext({ document: { getElementById: (id) => elements.get(id), createElement: element },
    fetch: async (route, options) => {
      if (route === "/api/businesses") return { ok: true, json: async () => ({ realestate: { name: "Agency", sector: "Real estate" }, hotel: { name: "Hotel", sector: "Hospitality" } }) };
      calls.push({ route, options }); return handler(route, options);
    },
  });
  vm.runInContext(code, context);
  await new Promise((resolve) => setImmediate(resolve));
  const send = (value) => { elements.get("question").value = value; return elements.get("chat").onsubmit({ preventDefault() {} }); };
  return { elements, calls, send };
}

test("browser context is tab-local, sends sequence, blocks overlap, and clears on reset", async () => {
  let release;
  const p = await page((route) => route.endsWith("reset") ? response("reset", "") : new Promise((resolve) => { release = resolve; }));
  const first = p.send("booking");
  await p.send("duplicate");
  assert.equal(p.calls.length, 1);
  assert.equal(p.elements.get("chat").button.disabled, true);
  release(response("approved")); await first;
  const second = p.send("follow-up");
  assert.equal(p.calls.at(-1).options.headers["X-Chat-Context"], token);
  assert.equal(p.calls.at(-1).options.headers["X-Chat-Sequence"], "2");
  p.elements.get("reset-chat").onclick();
  assert.ok(p.elements.get("messages").children.every((el) => el.textContent !== "approved"));
  release(response("late answer", token, 2)); await second;
  assert.ok(p.elements.get("messages").children.every((el) => el.textContent !== "late answer"));
  const third = p.send("fresh");
  assert.equal(p.calls.at(-1).options.headers["X-Chat-Context"], "new");
  release(response("fresh")); await third;
  assert.ok(p.calls.some((call) => call.route === "/api/chat/reset"));
  const independent = await page(() => response("independent"));
  await independent.send("new tab");
  assert.equal(independent.calls[0].options.headers["X-Chat-Context"], "new");
});

test("business switch ignores pending old response and revokes its returned handle", async () => {
  let release;
  const p = await page((route) => route.endsWith("reset") ? response("reset", "") : new Promise((resolve) => { release = resolve; }));
  const pending = p.send("old business");
  p.elements.get("businesses").children[1].onclick();
  release(response("old answer")); await pending;
  assert.ok(p.elements.get("messages").children.every((el) => el.textContent !== "old answer"));
  const reset = p.calls.find((call) => call.route === "/api/chat/reset");
  assert.equal(JSON.parse(reset.options.body).business, "realestate");
  const next = p.send("hotel");
  assert.equal(p.calls.at(-1).options.headers["X-Chat-Context"], "new");
  release(response("hotel answer")); await next;
  assert.ok(!/localStorage|sessionStorage/.test(code));
});

test("late pre-reset completion cannot unlock a new pending chat", async () => {
  const releases = [];
  const p = await page((route) => route.endsWith("reset") ? response("reset", "") : new Promise((resolve) => releases.push(resolve)));
  const old = p.send("old");
  p.elements.get("reset-chat").onclick();
  const fresh = p.send("fresh");
  releases[0](response("old reply")); await old;
  assert.equal(p.elements.get("chat").button.disabled, true);
  assert.ok(p.elements.get("messages").children.every((el) => el.textContent !== "old reply"));
  releases[1](response("fresh reply", "b".repeat(43))); await fresh;
  assert.equal(p.elements.get("chat").button.disabled, false);
});
