-- Idempotently applied by initializeAccountSchema. An attachment has its own
-- purpose-specific token table; users.email changes only after verification.
CREATE TABLE IF NOT EXISTS account_email_claims(
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL COLLATE NOCASE,
 password_version INTEGER NOT NULL,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_claim_expiry ON account_email_claims(expires_at);
INSERT OR IGNORE INTO account_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
