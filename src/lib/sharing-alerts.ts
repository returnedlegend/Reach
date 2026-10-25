import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type SharingSubmissionKind = "submission";

/** Durable, idempotent operator alerts for public sharing submissions. */
export function initializeSharingAlerts(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS sharing_alert_outbox (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('submission')),
    status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','preview','uncertain','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error_code TEXT
  );
  CREATE INDEX IF NOT EXISTS sharing_alert_ready ON sharing_alert_outbox(status,available_at,created_at);`);
}

/** Safe to call alongside the submission write; duplicate IDs remain one alert. */
export function queueSharingAlert(
  db: DatabaseSync,
  submissionId: string,
  kind: SharingSubmissionKind,
): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(submissionId))
    throw new TypeError("Invalid sharing submission ID.");
  if (kind !== "submission")
    throw new TypeError("Invalid sharing submission kind.");
  initializeSharingAlerts(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sharing_alert_outbox
    (id,submission_id,kind,status,attempts,available_at,created_at,updated_at)
    VALUES(?,?,?,'queued',0,?,?,?) ON CONFLICT(submission_id) DO NOTHING`,
  ).run(randomUUID(), submissionId, kind, now, now, now);
}
