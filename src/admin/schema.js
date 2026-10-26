// Version 2 is additive: existing inquiries and their IDs/metadata are untouched.
export function migrateAdminSchema(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 2) return;
  if (version !== 1) throw new Error('Unsupported migration');
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE administrators (
      id INTEGER PRIMARY KEY CHECK(id=1),
      password_salt TEXT NOT NULL CHECK(length(password_salt)=32 AND password_salt NOT GLOB '*[^0-9a-f]*'),
      password_hash TEXT NOT NULL CHECK(length(password_hash)=128 AND password_hash NOT GLOB '*[^0-9a-f]*'),
      scrypt_n INTEGER NOT NULL CHECK(scrypt_n=32768),
      scrypt_r INTEGER NOT NULL CHECK(scrypt_r=8),
      scrypt_p INTEGER NOT NULL CHECK(scrypt_p=3),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      created_at INTEGER NOT NULL CHECK(created_at>0)
    ) STRICT;
    CREATE TABLE admin_sessions (
      token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
      admin_id INTEGER NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
      origin TEXT NOT NULL CHECK(length(origin) BETWEEN 1 AND 100),
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      idle_expires_at INTEGER NOT NULL,
      absolute_expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      CHECK(created_at>0 AND last_seen_at>=created_at AND idle_expires_at>created_at AND absolute_expires_at>=idle_expires_at)
    ) STRICT;
    CREATE INDEX admin_sessions_expiry ON admin_sessions(absolute_expires_at);
    PRAGMA user_version=2;
    COMMIT;`);
}
export function adminRepository(db) {
  return {
    hasAdmin: () => Boolean(db.prepare('SELECT 1 FROM administrators WHERE id=1').get()),
    getAdmin: () => db.prepare('SELECT * FROM administrators WHERE id=1').get(),
    createAdmin(record, now = Date.now()) {
      db.prepare('INSERT INTO administrators (id,password_salt,password_hash,scrypt_n,scrypt_r,scrypt_p,created_at) VALUES (1,?,?,?,?,?,?)')
        .run(record.password_salt, record.password_hash, record.scrypt_n, record.scrypt_r, record.scrypt_p, now);
    },
    createSession(hash, origin, now, idleMs, absoluteMs) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM admin_sessions WHERE revoked_at IS NOT NULL OR absolute_expires_at<=? OR idle_expires_at<=?').run(now, now);
        db.prepare('UPDATE admin_sessions SET revoked_at=? WHERE revoked_at IS NULL').run(now);
        db.prepare('INSERT INTO admin_sessions VALUES (?,1,?,?,?,?,?,NULL)').run(hash, origin, now, now, now + idleMs, now + absoluteMs);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    session(hash, origin, now) {
      return db.prepare(`SELECT s.* FROM admin_sessions s JOIN administrators a ON a.id=s.admin_id
        WHERE s.token_hash=? AND s.origin=? AND s.revoked_at IS NULL AND s.idle_expires_at>? AND s.absolute_expires_at>? AND a.enabled=1`).get(hash, origin, now, now);
    },
    touch(hash, now, idleMs) {
      db.prepare('UPDATE admin_sessions SET last_seen_at=?,idle_expires_at=min(?,absolute_expires_at) WHERE token_hash=? AND revoked_at IS NULL').run(now, now + idleMs, hash);
    },
    revoke(hash, now) { db.prepare('UPDATE admin_sessions SET revoked_at=? WHERE token_hash=?').run(now, hash); }
  };
}
