import test from "node:test";
import assert from "node:assert/strict";
import { createPublicHotelChatServer } from "../public-hotel-chat.js";

const token = "test-only-bridge-token-which-is-over-32-characters";
async function withServer(fn) {
  const server = createPublicHotelChatServer({ bridgeToken: token });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await fn("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
function send(url, message, headers = {}, body) {
  return fetch(url + "/v1/hotel/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bridge-Token": token, ...headers },
    body: body ?? JSON.stringify({ message }),
  });
}
test("public chat gateway has no private routes and requires bridge token", async () => {
  await withServer(async url => {
    assert.equal((await fetch(url + "/health")).status, 200);
    assert.equal((await fetch(url + "/api/admin/inquiries")).status, 404);
    assert.equal((await fetch(url + "/api/lead")).status, 404);
    const denied = await send(url, "How do I book a room?", { "X-Bridge-Token": "wrong" });
    assert.equal(denied.status, 403);
  });
});
test("public gateway permits only hotel questions and never accepts business override", async () => {
  await withServer(async url => {
    const invalid = await send(url, "", {}, JSON.stringify({ business: "auto", message: "How do I book a room?" }));
    assert.equal(invalid.status, 400);
    const ok = await send(url, "How do I book a room?", { "X-Chat-Context": "new" });
    assert.equal(ok.status, 200);
    const result = await ok.json();
    assert.equal(result.mode, "demo");
    assert.equal(result.message, "Leave your dates and guest count. Staff will confirm availability and rates.");
    assert.deepEqual(result.sources, ["hotel:booking"]);
  });
});
test("public gateway preserves bounded booking context then switches to check-in", async () => {
  await withServer(async url => {
    let r = await send(url, "How do I book a room?", { "X-Chat-Context": "new" });
    assert.equal(r.status, 200);
    const handle = r.headers.get("X-Chat-Context");
    assert.match(handle, /^[A-Za-z0-9_-]{43}$/);
    r = await send(url, "What details should I provide?", {
      "X-Chat-Context": handle, "X-Chat-Sequence": "2",
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).sources, ["hotel:booking"]);
    r = await send(url, "What about check-in?", {
      "X-Chat-Context": handle, "X-Chat-Sequence": "3",
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).sources, ["hotel:check-in"]);
  });
});
test("public chat refuses invalid context and compound unsupported questions", async () => {
  await withServer(async url => {
    const invalid = await send(url, "How do I book a room?", { "X-Chat-Context": "new", "X-Chat-Sequence": "1" });
    assert.equal(invalid.status, 400);
    const handoff = await send(url, "What is check-in and can you guarantee an early room?");
    assert.equal(handoff.status, 200);
    assert.equal((await handoff.json()).handoff, true);
  });
});
