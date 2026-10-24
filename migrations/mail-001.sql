-- Reference for new databases. initializeMailSchema also atomically upgrades old
-- INTEGER provider IDs to TEXT, preserving history, delivery IDs and outbox links.
-- Never persist recipients, bodies, action URLs, provider errors or credentials.
CREATE TABLE IF NOT EXISTS mail_deliveries(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,kind TEXT NOT NULL,provider TEXT NOT NULL,provider_message_id TEXT,rfc_message_id TEXT,status TEXT NOT NULL CHECK(status IN ('pending','accepted','preview','uncertain','failed','delayed','held','delivered','bounced')),error_code TEXT,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,event_at REAL);
CREATE UNIQUE INDEX IF NOT EXISTS mail_provider_message_id ON mail_deliveries(provider,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS mail_webhook_events(uuid TEXT PRIMARY KEY,received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail_rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
