-- Crowd reports are folded directly into five-minute pantry-local buckets.
-- Do not add reporter, session, address, coordinates, IP, or submission IDs here.
CREATE TABLE IF NOT EXISTS crowd_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crowd_buckets(
  pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE, slot_start TEXT NOT NULL, local_date TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
  reports INTEGER NOT NULL CHECK(reports > 0), level_sum INTEGER NOT NULL,
  wait_sum INTEGER NOT NULL DEFAULT 0, wait_count INTEGER NOT NULL DEFAULT 0,
  staff_reports INTEGER NOT NULL DEFAULT 0, last_updated TEXT NOT NULL,
  PRIMARY KEY(pantry_id,slot_start)
);
CREATE INDEX IF NOT EXISTS crowd_bucket_history ON crowd_buckets(pantry_id,slot_start);
CREATE TABLE IF NOT EXISTS crowd_dedup(dedupe_hash TEXT PRIMARY KEY,expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS crowd_dedup_expiry ON crowd_dedup(expires_at);
