import { randomBytes } from "node:crypto";
import { knowledgeRevision, topicFor } from "./knowledge.js";

export const IDLE_MS = 3 * 60 * 1000;
export const ABSOLUTE_MS = 10 * 60 * 1000;
export const MAX_TURNS = 6;
export const MAX_CONTEXTS = 1000;
export const validHandle = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export function createTopicStore(now = Date.now) {
  const entries = new Map();
  const live = (record) => record.knowledgeRevision === knowledgeRevision && now() >= record.lastActivity && now() >= record.createdAt &&
    now() - record.lastActivity < IDLE_MS && now() - record.createdAt < ABSOLUTE_MS && record.turns < MAX_TURNS;
  function prune() {
    for (const [handle, record] of entries) if (!live(record)) entries.delete(handle);
  }
  const timer = setInterval(prune, 30000);
  timer.unref();
  return {
    get size() { prune(); return entries.size; },
    begin(handle, businessId, sequence) {
      prune();
      const record = entries.get(handle);
      if (!record) return { status: "missing" };
      if (record.businessId !== businessId) { entries.delete(handle); return { status: "missing" }; }
      if (record.busy) return { status: "busy" };
      if (sequence !== record.sequence + 1) { entries.delete(handle); return { status: "missing" }; }
      record.busy = true;
      record.sequence = sequence;
      return { status: "ok", record };
    },
    finish(record, businessId, factId) {
      prune();
      if (record && (entries.get(record.handle) !== record || !live(record))) return { valid: false };
      if (!record) {
        if (entries.size >= MAX_CONTEXTS) return { valid: false, capacity: true };
        record = { handle: randomBytes(32).toString("base64url"), businessId,
          factId, followupType: null, knowledgeRevision, createdAt: now(), lastActivity: now(),
          turns: 0, sequence: 1, busy: true };
        entries.set(record.handle, record);
      }
      record.factId = factId;
      record.followupType = topicFor(businessId, factId);
      record.lastActivity = now();
      record.turns++;
      record.busy = false;
      const handle = record.turns < MAX_TURNS ? record.handle : "";
      if (!handle) entries.delete(record.handle);
      return { valid: true, handle, sequence: record.sequence };
    },
    invalidate(handle) { if (validHandle(handle)) entries.delete(handle); },
    reset(handle, businessId) { if (entries.get(handle)?.businessId === businessId) entries.delete(handle); },
    clear() { clearInterval(timer); entries.clear(); },
  };
}
