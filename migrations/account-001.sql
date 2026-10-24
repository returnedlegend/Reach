-- Reference migration, applied idempotently by initializeAccountSchema in
-- src/lib/account-store.ts, which checks existing columns before each ALTER.
-- Do not execute blindly against an already-migrated database.
ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN pantry_role TEXT NOT NULL DEFAULT 'user' CHECK(pantry_role IN ('user','administrator'));
ALTER TABLE users ADD COLUMN preferences TEXT NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS account_email ON users(email) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS account_tokens(
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_token_owner ON account_tokens(user_id,purpose);
CREATE INDEX IF NOT EXISTS account_session_owner ON sessions(user_id);
CREATE TABLE IF NOT EXISTS account_locations(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 label TEXT NOT NULL,lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
 lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_location_owner ON account_locations(user_id);
CREATE TABLE IF NOT EXISTS account_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO account_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
