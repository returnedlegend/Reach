import { featureEnabled } from "./release-features";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const ACCOUNT_COOKIE = "reach_community_session";
export type AccountActor = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  role: "user" | "administrator";
};
export class AccountError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function accountFail(status: number, message: string): never {
  throw new AccountError(status, message);
}
export function accountHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function accountTransaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
/** Additive migration preserves every existing community identity and session. */
export function initializeAccountSchema(db: DatabaseSync): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  for (const [name, definition] of Object.entries({
    email: "TEXT COLLATE NOCASE",
    email_verified_at: "TEXT",
    name: "TEXT NOT NULL DEFAULT ''",
    pantry_role:
      "TEXT NOT NULL DEFAULT 'user' CHECK(pantry_role IN ('user','administrator'))",
    preferences: "TEXT NOT NULL DEFAULT '{}'",
    password_version: "INTEGER NOT NULL DEFAULT 0",
  }))
    if (!columns.has(name))
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS account_email ON users(email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS account_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account_email_claims(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,email TEXT NOT NULL COLLATE NOCASE,password_version INTEGER NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS account_claim_expiry ON account_email_claims(expires_at);
    CREATE INDEX IF NOT EXISTS account_token_owner ON account_tokens(user_id,purpose);
    CREATE INDEX IF NOT EXISTS account_session_owner ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS account_locations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,label TEXT NOT NULL,lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS account_location_owner ON account_locations(user_id);
    CREATE TABLE IF NOT EXISTS account_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT OR IGNORE INTO account_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    INSERT OR IGNORE INTO account_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
}
export function accountSessionTokens(request: Request): string[] {
  return (request.headers.get("cookie") || "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(`${ACCOUNT_COOKIE}=`))
    .map((v) => v.slice(ACCOUNT_COOKIE.length + 1))
    .filter((v) => /^[a-f0-9]{64}$/.test(v))
    .slice(0, 3);
}
export function getAccountActor(
  db: DatabaseSync,
  request: Request,
  at = new Date(),
): AccountActor | null {
  if (!featureEnabled("accounts")) return null;
  for (const token of accountSessionTokens(request)) {
    const row = db
      .prepare(
        "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?",
      )
      .get(accountHash(token), at.toISOString());
    if (row)
      return {
        id: String(row.id),
        email: row.email === null ? null : String(row.email),
        emailVerified: !!row.email_verified_at,
        name: String(row.name || row.username),
        role: row.pantry_role as AccountActor["role"],
      };
  }
  return null;
}
export function requireAccountActor(
  db: DatabaseSync,
  request: Request,
  options: { verified?: boolean } = {},
): AccountActor {
  const actor =
    getAccountActor(db, request) || accountFail(401, "Sign in to continue.");
  if (options.verified && !actor.emailVerified)
    accountFail(403, "Verify your email address to continue.");
  return actor;
}
/** Persistent limits intentionally ignore untrusted proxy/IP headers. */
export function accountRate(
  db: DatabaseSync,
  key: string,
  limit: number,
  seconds: number,
  at = Date.now(),
) {
  accountTransaction(db, () => {
    db.prepare("DELETE FROM rate_limits WHERE reset_at<=?").run(at);
    const row = db
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .get(`account:${key}`);
    if (row && Number(row.count) >= limit)
      accountFail(429, "Too many attempts. Try again later.");
    db.prepare(
      "INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    ).run(`account:${key}`, at + seconds * 1000);
  });
}
