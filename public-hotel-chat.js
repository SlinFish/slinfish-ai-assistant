import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createChat, HANDOFF } from "./src/chat.js";
import { createTopicStore, validHandle } from "./src/context.js";
import { createLimiter } from "./src/inquiries/rate-limit.js";
import { validText } from "./src/inquiries/validation.js";

// Separate public CHAT-ONLY process. Never imports the admin or SQLite server.
const json = (res, status, data, extra = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(JSON.stringify(data));
};
const tokenMatches = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
async function readJson(req) {
  if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json" ||
    (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity"))
    return null;
  let count = 0; const chunks = [];
  try {
    for await (const chunk of req) {
      count += chunk.length;
      if (count > 12000) return null;
      chunks.push(chunk);
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    return value;
  } catch { return null; }
}
export function createPublicHotelChatServer({ bridgeToken, now = Date.now, fetchImpl } = {}) {
  if (typeof bridgeToken !== "string" || bridgeToken.length < 32 || bridgeToken.length > 256)
    throw new Error("PUBLIC_CHAT_BRIDGE_TOKEN must be a random private secret (32-256 characters)");
  const config = { provider: "demo" };
  const chat = createChat(config, fetchImpl);
  const topics = createTopicStore(now);
  const limiter = createLimiter({ limit: 20, globalLimit: 100 });
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
    if (req.method !== "POST" || req.url !== "/v1/hotel/chat")
      return json(res, 404, { error: "Not found" });
    if (!tokenMatches(req.headers["x-bridge-token"], bridgeToken))
      return json(res, 403, { error: "Forbidden" });
    const ip = typeof req.headers["x-client-ip"] === "string"
      ? req.headers["x-client-ip"].slice(0, 64) : req.socket.remoteAddress;
    const retry = limiter.attempt(ip, now());
    if (retry) return json(res, 429, { error: "Too many requests" }, { "Retry-After": String(retry) });
    const data = await readJson(req);
    if (!data || typeof data !== "object" || Array.isArray(data) ||
      Object.keys(data).length !== 1 || !validText(data.message, 1000, true))
      return json(res, 400, { error: "Invalid question" });
    const handle = req.headers["x-chat-context"];
    const seq = req.headers["x-chat-sequence"];
    const optedIn = handle !== undefined;
    if ((optedIn && handle !== "new" && !validHandle(handle)) ||
      (handle === "new" && seq !== undefined) ||
      (!optedIn && seq !== undefined) ||
      (optedIn && handle !== "new" && !/^[1-9][0-9]{0,2}$/.test(seq ?? "")))
      return json(res, 400, { error: "Invalid context" });
    let record;
    try {
      if (optedIn && handle !== "new") {
        const lease = topics.begin(handle, "hotel", Number(seq));
        if (lease.status === "busy") return json(res, 409, { error: "Busy" });
        if (lease.status !== "ok")
          return json(res, 200, { message: HANDOFF, handoff: true, mode: "demo", sources: [] }, { "X-Chat-Context": "" });
        record = lease.record;
      }
      const topic = record ? { businessId: "hotel", factId: record.factId,
        followupType: record.followupType, knowledgeRevision: record.knowledgeRevision } : undefined;
      const result = await chat("hotel", data.message, topic);
      const headers = optedIn ? { "X-Chat-Context": "" } : {};
      if (result.handoff) topics.invalidate(handle);
      else if (optedIn) {
        const finished = topics.finish(record, "hotel", result.sources[0].split(":")[1]);
        if (!finished.valid) return json(res, 503, { error: "Assistant unavailable" });
        headers["X-Chat-Context"] = finished.handle;
        if (finished.handle) headers["X-Chat-Sequence"] = String(finished.sequence);
      }
      return json(res, 200, result, headers);
    } catch {
      topics.invalidate(handle);
      return json(res, 503, { error: "Assistant unavailable" });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on("close", () => { topics.clear(); limiter.clear(); });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1].replaceAll("\\", "/")}`))) {
  try {
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
    const server = createPublicHotelChatServer({ bridgeToken: process.env.PUBLIC_CHAT_BRIDGE_TOKEN });
    server.listen(port, "0.0.0.0", () => console.log("Public hotel chat gateway listening"));
  } catch {
    console.error("Unable to start public hotel chat gateway. Check configuration.");
    process.exitCode = 1;
  }
}
