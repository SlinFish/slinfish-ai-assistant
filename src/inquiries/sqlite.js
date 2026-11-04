import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBusiness } from "../businesses.js";
import { validateInquiry } from "./validation.js";
import { migrateAdminSchema, adminRepository } from "../admin/schema.js";
import { migrateManagement, managementRepository } from "./management.js";
const ROOT = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const APP_ID = 0x534c494e;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_INQUIRIES = 200;
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

function databasePath(input, requireExisting) {
  if (
    typeof input !== "string" ||
    !path.isAbsolute(input) ||
    input.includes("\0")
  )
    throw new Error("Invalid storage configuration");
  const parent = realpathSync(path.dirname(input)); // Require an existing private directory.
  if (inside(ROOT, path.resolve(input)) || inside(ROOT, parent))
    throw new Error("Storage must be outside the checkout");
  if (
    !statSync(parent).isDirectory() ||
    (process.platform !== "win32" && (statSync(parent).mode & 0o077) !== 0)
  )
    throw new Error("Private storage directory required");
  const file = path.join(parent, path.basename(input));
  let info;
  try {
    info = lstatSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (info) {
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      inside(ROOT, realpathSync(file)) ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    )
      throw new Error("Private regular database file required");
  } else {
    if (requireExisting) throw new Error("Existing database required");
    const handle = openSync(file, "wx", 0o600);
    closeSync(handle);
  }
  return file;
}

export function openInquiryStore(
  input,
  { requireExisting = false, allowMigration = true } = {},
) {
  const db = new DatabaseSync(databasePath(input, requireExisting));
  try {
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const appId = db.prepare("PRAGMA application_id").get().application_id;
    if (!allowMigration && ![2, 3].includes(version))
      throw new Error("Current schema required");
    if (version === 0) {
      const tables = db
        .prepare(
          "SELECT count(*) AS total FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        )
        .get().total;
      if (tables !== 0 || appId !== 0) throw new Error("Unrecognized database");
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        INSERT INTO app_metadata VALUES ('realm','fictional-demo');
        CREATE TABLE inquiries (
          id TEXT PRIMARY KEY CHECK(length(id)=36),
          business_id TEXT NOT NULL CHECK(business_id IN ('realestate','auto','retail','hotel')),
          name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
          contact TEXT NOT NULL CHECK(length(trim(contact)) BETWEEN 1 AND 150),
          question TEXT NOT NULL CHECK(length(trim(question)) BETWEEN 1 AND 400),
          consent INTEGER NOT NULL CHECK(consent=1),
          status TEXT NOT NULL CHECK(status IN ('new','contacted','qualified','closed')),
          created_at INTEGER NOT NULL CHECK(created_at>0),
          updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
          expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
          version INTEGER NOT NULL CHECK(version>=1)
        ) STRICT;
        CREATE INDEX inquiries_business_created ON inquiries(business_id,created_at,id);
        PRAGMA application_id=${APP_ID}; PRAGMA user_version=1; COMMIT;`);
    } else if (![1, 2, 3].includes(version) || appId !== APP_ID)
      throw new Error("Unsupported database");
    if (
      db.prepare("SELECT value FROM app_metadata WHERE key='realm'").get()
        ?.value !== "fictional-demo"
    )
      throw new Error("Incorrect storage realm");
    if (allowMigration) {
      migrateAdminSchema(db);
      migrateManagement(db);
    }
    db.exec("PRAGMA journal_mode=WAL;");
    const insert = db.prepare(`INSERT INTO inquiries
      (id,business_id,name,contact,question,consent,status,created_at,updated_at,expires_at,version)
      VALUES (?,?,?,?,?,1,'new',?,?,?,1)`);
    const get = db.prepare(
      "SELECT * FROM inquiries WHERE business_id=? AND id=?",
    );
    const count = db.prepare("SELECT count(*) AS total FROM inquiries");
    let closed = false;
    const admin = adminRepository(db);
    return {
      admin,
      management:
        db.prepare("PRAGMA user_version").get().user_version === 3
          ? managementRepository(db, admin)
          : undefined,
      save(value, now = Date.now()) {
        const inquiry = validateInquiry(value);
        const id = randomUUID();
        db.exec("BEGIN IMMEDIATE");
        try {
          if (count.get().total >= MAX_INQUIRIES)
            throw new Error("Storage capacity reached");
          insert.run(
            id,
            inquiry.business,
            inquiry.name,
            inquiry.contact,
            inquiry.question,
            now,
            now,
            now + RETENTION_MS,
          );
          db.exec("COMMIT");
          return id;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
      get(business, id) {
        if (!isBusiness(business) || typeof id !== "string") return undefined;
        return get.get(business, id);
      },
      close() {
        if (!closed) {
          closed = true;
          db.close();
        }
      },
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* no active migration */
    }
    db.close();
    throw error;
  }
}
