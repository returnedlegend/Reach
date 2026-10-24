import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  NotificationEvent,
  NotificationPreferences,
} from "./notification-types";

export const notificationSchema = `
CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,pantry INTEGER NOT NULL DEFAULT 0 CHECK(pantry IN(0,1)),volunteer INTEGER NOT NULL DEFAULT 0 CHECK(volunteer IN(0,1)),pickup INTEGER NOT NULL DEFAULT 0 CHECK(pickup IN(0,1)),volunteer_participation INTEGER NOT NULL DEFAULT 0 CHECK(volunteer_participation IN(0,1)),updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_outbox(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_key TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN('security','pantry','volunteer','pickup')),kind TEXT NOT NULL,resource_type TEXT,resource_id TEXT,status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','accepted','delivered','failed','uncertain','preview','suppressed')),attempts INTEGER NOT NULL DEFAULT 0,available_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,delivery_id TEXT,error_code TEXT,UNIQUE(event_key,user_id));
CREATE INDEX IF NOT EXISTS notification_pending ON notification_outbox(status,available_at,id);
CREATE INDEX IF NOT EXISTS notification_owner ON notification_outbox(user_id,created_at);
CREATE TABLE IF NOT EXISTS notification_unsubscribe(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notification_unsubscribe_expiry ON notification_unsubscribe(expires_at);
CREATE TABLE IF NOT EXISTS notification_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO notification_migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`;
export function initializeNotifications(db: DatabaseSync) {
  db.exec(notificationSchema);
}
export function getNotificationPreferences(
  db: DatabaseSync,
  userId: string,
): NotificationPreferences {
  initializeNotifications(db);
  const row = db
    .prepare("SELECT * FROM notification_preferences WHERE user_id=?")
    .get(userId);
  return {
    pantry: !!row?.pantry,
    volunteer: !!row?.volunteer,
    pickup: !!row?.pickup,
    volunteerParticipation: !!row?.volunteer_participation,
  };
}
export function saveNotificationPreferences(
  db: DatabaseSync,
  userId: string,
  p: NotificationPreferences,
  at = new Date(),
) {
  initializeNotifications(db);
  db.prepare(
    `INSERT INTO notification_preferences VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET pantry=excluded.pantry,volunteer=excluded.volunteer,pickup=excluded.pickup,volunteer_participation=excluded.volunteer_participation,updated_at=excluded.updated_at`,
  ).run(
    userId,
    +p.pantry,
    +p.volunteer,
    +p.pickup,
    +p.volunteerParticipation,
    at.toISOString(),
  );
  for (const category of ["pantry", "volunteer", "pickup"] as const)
    if (!p[category])
      db.prepare(
        "UPDATE notification_outbox SET status='suppressed',updated_at=? WHERE user_id=? AND category=? AND status='queued'",
      ).run(at.toISOString(), userId, category);
}
/** Called within the business mutation's transaction. No network or nested transaction. */
export function queueNotification(
  db: DatabaseSync,
  event: NotificationEvent,
  at = new Date(),
) {
  initializeNotifications(db);
  const user = db
    .prepare("SELECT email,email_verified_at FROM users WHERE id=?")
    .get(event.userId);
  if (!user?.email || !user.email_verified_at) return;
  if (
    event.category !== "security" &&
    !getNotificationPreferences(db, event.userId)[event.category]
  )
    return;
  db.prepare(
    `INSERT OR IGNORE INTO notification_outbox(id,user_id,event_key,category,kind,resource_type,resource_id,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    randomUUID(),
    event.userId,
    event.eventKey,
    event.category,
    event.kind,
    event.resourceType ?? null,
    event.resourceId ?? null,
    at.toISOString(),
    at.toISOString(),
    at.toISOString(),
  );
}
export function createUnsubscribeToken(
  db: DatabaseSync,
  userId: string,
  at = new Date(),
) {
  initializeNotifications(db);
  db.prepare("DELETE FROM notification_unsubscribe WHERE expires_at<=?").run(
    at.toISOString(),
  );
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO notification_unsubscribe VALUES(?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    userId,
    new Date(+at + 30 * 86400000).toISOString(),
  );
  return token;
}
export function consumeUnsubscribeToken(
  db: DatabaseSync,
  token: string,
  at = new Date(),
) {
  initializeNotifications(db);
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  const hash = createHash("sha256").update(token).digest("hex");
  const row = db
    .prepare(
      "SELECT user_id FROM notification_unsubscribe WHERE token_hash=? AND expires_at>?",
    )
    .get(hash, at.toISOString());
  if (!row) return;
  const id = String(row.user_id),
    old = getNotificationPreferences(db, id);
  saveNotificationPreferences(
    db,
    id,
    { ...old, pantry: false, volunteer: false, pickup: false },
    at,
  );
  db.prepare("DELETE FROM notification_unsubscribe WHERE token_hash=?").run(
    hash,
  );
}
