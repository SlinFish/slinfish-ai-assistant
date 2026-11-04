import { isBusiness, businesses } from "../businesses.js";
import { RequestError } from "./validation.js";
export const STATUSES = Object.freeze([
  "new",
  "contacted",
  "qualified",
  "won",
  "lost",
]);
export const WORKFLOW = Object.freeze({
  new: Object.freeze(["contacted", "lost"]),
  contacted: Object.freeze(["qualified", "lost"]),
  qualified: Object.freeze(["contacted", "won", "lost"]),
  won: Object.freeze(["qualified"]),
  lost: Object.freeze(["contacted"]),
  legacy_closed: Object.freeze(["won", "lost"]),
});
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const statusOf = (row) => row.workflow_status ?? "legacy_closed";
export function migrateManagement(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version === 3) return;
  if (version !== 2) throw new Error("Unsupported migration");
  db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE inquiries ADD COLUMN workflow_status TEXT DEFAULT 'new'
      CHECK((workflow_status IS NULL AND status='closed') OR (workflow_status IS NOT NULL AND workflow_status IN ('new','contacted','qualified','won','lost')));
    UPDATE inquiries SET workflow_status=CASE WHEN status='closed' THEN NULL ELSE status END;
    CREATE UNIQUE INDEX inquiries_scope ON inquiries(business_id,id);
    CREATE TABLE inquiry_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id TEXT NOT NULL,
      inquiry_id TEXT NOT NULL,
      actor_admin_id INTEGER NOT NULL REFERENCES administrators(id),
      previous_status TEXT NOT NULL CHECK(previous_status IN ('new','contacted','qualified','won','lost','legacy_closed')),
      new_status TEXT NOT NULL CHECK(new_status IN ('new','contacted','qualified','won','lost')),
      created_at INTEGER NOT NULL CHECK(created_at>0),
      version INTEGER NOT NULL CHECK(version>=2),
      UNIQUE(business_id,inquiry_id,version),
      FOREIGN KEY(business_id,inquiry_id) REFERENCES inquiries(business_id,id)
    ) STRICT;
    CREATE INDEX inquiry_events_scope ON inquiry_status_events(business_id,inquiry_id,id DESC);
    PRAGMA user_version=3;
    COMMIT;`);
}
function item(row) {
  return {
    id: row.id,
    business: row.business_id,
    businessName: businesses[row.business_id].name,
    businessType: businesses[row.business_id].sector,
    name: row.name,
    contact: row.contact,
    status: statusOf(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}
function params(query, allowed) {
  if (
    [...query.keys()].some(
      (key) => !allowed.includes(key) || query.getAll(key).length !== 1,
    )
  )
    throw new RequestError(400, "Invalid filters or pagination");
}
export function managementRepository(db, admin) {
  const scoped = (business, id) => {
    if (!isBusiness(business) || !uuid(id))
      throw new RequestError(404, "Inquiry not found");
    const row = db
      .prepare("SELECT * FROM inquiries WHERE business_id=? AND id=?")
      .get(business, id);
    if (!row) throw new RequestError(404, "Inquiry not found");
    return row;
  };
  const history = (business, id, query = new URLSearchParams()) => {
    scoped(business, id);
    params(query, ["before"]);
    const before = query.get("before");
    if (
      before !== null &&
      (!/^[1-9]\d{0,14}$/.test(before) || !Number.isSafeInteger(Number(before)))
    )
      throw new RequestError(400, "Invalid history cursor");
    const rows = db
      .prepare(
        `SELECT id,actor_admin_id,previous_status,new_status,created_at,version FROM inquiry_status_events
      WHERE business_id=? AND inquiry_id=? AND id<? ORDER BY id DESC LIMIT 51`,
      )
      .all(
        business,
        id,
        before === null ? Number.MAX_SAFE_INTEGER : Number(before),
      );
    const events = rows.slice(0, 50).map((row) => ({
      id: row.id,
      actor: "Local administrator",
      previousStatus: row.previous_status,
      status: row.new_status,
      createdAt: row.created_at,
      version: row.version,
    }));
    return {
      events,
      nextCursor: rows.length > 50 ? String(events.at(-1).id) : null,
    };
  };
  const detail = (business, id) => {
    const row = scoped(business, id);
    return {
      ...item(row),
      question: row.question,
      expiresAt: row.expires_at,
      allowedStatuses: WORKFLOW[statusOf(row)],
      history: history(business, id),
    };
  };
  return {
    list(query) {
      params(query, ["business", "status", "cursor", "limit"]);
      const business = query.get("business"),
        status = query.get("status");
      if (business !== null && !isBusiness(business))
        throw new RequestError(400, "Invalid business filter");
      if (status !== null && ![...STATUSES, "legacy_closed"].includes(status))
        throw new RequestError(400, "Invalid status filter");
      const rawLimit = query.get("limit") ?? "25";
      if (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 50)
        throw new RequestError(400, "Invalid page limit");
      const limit = Number(rawLimit),
        where = [],
        values = [];
      if (business !== null) {
        where.push("business_id=?");
        values.push(business);
      }
      if (status !== null) {
        where.push("COALESCE(workflow_status,'legacy_closed')=?");
        values.push(status);
      }
      const cursor = query.get("cursor");
      if (cursor !== null) {
        let tuple;
        try {
          if (!/^[A-Za-z0-9_-]{1,256}$/.test(cursor)) throw new Error();
          tuple = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        } catch {
          throw new RequestError(400, "Invalid page cursor");
        }
        if (
          !Array.isArray(tuple) ||
          tuple.length !== 2 ||
          !Number.isSafeInteger(tuple[0]) ||
          tuple[0] <= 0 ||
          !uuid(tuple[1])
        )
          throw new RequestError(400, "Invalid page cursor");
        where.push("(created_at<? OR (created_at=? AND id<?))");
        values.push(tuple[0], tuple[0], tuple[1]);
      }
      const rows = db
        .prepare(
          `SELECT * FROM inquiries ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .all(...values, limit + 1);
      const page = rows.slice(0, limit),
        last = page.at(-1);
      return {
        inquiries: page.map(item),
        nextCursor:
          rows.length > limit
            ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString(
                "base64url",
              )
            : null,
      };
    },
    detail,
    history,
    transition(business, id, value, session, origin, now) {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, "status") ||
        !Object.hasOwn(value, "version") ||
        !STATUSES.includes(value.status) ||
        !Number.isSafeInteger(value.version) ||
        value.version < 1
      )
        throw new RequestError(400, "Invalid status update");
      db.exec("BEGIN IMMEDIATE");
      try {
        const actor = admin.session(session.hash, origin, now);
        if (!actor) throw new RequestError(401, "Authentication required");
        const row = scoped(business, id),
          previous = statusOf(row);
        if (row.version !== value.version)
          throw new RequestError(
            409,
            "Inquiry changed. Reload and review before updating.",
          );
        if (!WORKFLOW[previous].includes(value.status))
          throw new RequestError(400, "Status transition not allowed");
        if (
          db.prepare("SELECT count(*) AS n FROM inquiry_status_events").get()
            .n >= 10000
        )
          throw new RequestError(503, "Status history capacity reached");
        const time = Math.max(now, row.updated_at);
        const changed = db
          .prepare(
            "UPDATE inquiries SET workflow_status=?,updated_at=?,version=version+1 WHERE business_id=? AND id=? AND version=?",
          )
          .run(value.status, time, business, id, value.version);
        if (changed.changes !== 1)
          throw new RequestError(
            409,
            "Inquiry changed. Reload and review before updating.",
          );
        db.prepare(
          "INSERT INTO inquiry_status_events (business_id,inquiry_id,actor_admin_id,previous_status,new_status,created_at,version) VALUES (?,?,?,?,?,?,?)",
        ).run(
          business,
          id,
          actor.admin_id,
          previous,
          value.status,
          time,
          value.version + 1,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return detail(business, id);
    },
  };
}
