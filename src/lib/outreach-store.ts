import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AccountError, accountHash } from "./account-store";
import type {
  OutreachRecipient,
  OutreachMessage,
  OutreachFacts,
} from "./outreach-types";

export function initializeOutreach(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS outreach_recipients(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('organization','household')),pantry_id TEXT REFERENCES pantries(id),offer_id TEXT REFERENCES records(id) ON DELETE CASCADE,owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,email TEXT NOT NULL,source_url TEXT NOT NULL,enrolled_at TEXT NOT NULL,revoked_at TEXT,unsubscribe_token TEXT NOT NULL UNIQUE);
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_org_contact ON outreach_recipients(pantry_id,email) WHERE kind='organization';
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_offer_contact ON outreach_recipients(offer_id) WHERE kind='household';
    CREATE TABLE IF NOT EXISTS outreach_threads(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,recipient_id TEXT NOT NULL REFERENCES outreach_recipients(id) ON DELETE CASCADE,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,available_at TEXT NOT NULL,sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,delivery_id TEXT,reply_token TEXT NOT NULL UNIQUE,followup_expires TEXT,followup_remaining INTEGER NOT NULL DEFAULT 0,followup_hours INTEGER NOT NULL DEFAULT 24,parent_id TEXT REFERENCES outreach_threads(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS outreach_user_history ON outreach_threads(user_id,created_at);
    CREATE INDEX IF NOT EXISTS outreach_due ON outreach_threads(status,available_at);
    CREATE TABLE IF NOT EXISTS outreach_replies(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES outreach_threads(id) ON DELETE CASCADE,email_id TEXT NOT NULL UNIQUE,text TEXT NOT NULL,received_at TEXT NOT NULL,facts_json TEXT NOT NULL,reviewed_at TEXT,expires_at TEXT);
    CREATE TABLE IF NOT EXISTS outreach_events(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outreach_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
  `);
  if (
    !db
      .prepare("PRAGMA table_info(outreach_threads)")
      .all()
      .some((c) => c.name === "authorization_expires")
  )
    db.exec(
      "ALTER TABLE outreach_threads ADD COLUMN authorization_expires TEXT",
    );
  if (
    !db
      .prepare("PRAGMA table_info(outreach_replies)")
      .all()
      .some((c) => c.name === "pickup_json")
  )
    db.exec("ALTER TABLE outreach_replies ADD COLUMN pickup_json TEXT");
  if (
    !db
      .prepare("PRAGMA table_info(outreach_threads)")
      .all()
      .some((c) => c.name === "approved_contact_hash")
  )
    db.exec(
      "ALTER TABLE outreach_threads ADD COLUMN approved_contact_hash TEXT",
    );
}
export function contactFingerprint(recipient: Record<string, unknown>) {
  return accountHash(
    `${recipient.id}\n${recipient.email}\n${recipient.enrolled_at}`,
  );
}
export function outreachRate(
  db: DatabaseSync,
  key: string,
  limit: number,
  seconds: number,
  now: Date,
) {
  const r = db
    .prepare(
      "INSERT INTO outreach_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END WHERE reset_at<=? OR count<?",
    )
    .run(key, +now + seconds * 1000, +now, +now, +now, limit);
  if (!r.changes)
    throw new AccountError(
      429,
      "The outreach limit was reached. Try again later.",
    );
}
export function publicRecipient(r: Record<string, unknown>): OutreachRecipient {
  const email = String(r.email),
    [local, domain] = email.split("@");
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as OutreachRecipient["kind"],
    pantryId: r.pantry_id ? String(r.pantry_id) : null,
    offerId: r.offer_id ? String(r.offer_id) : null,
    sourceUrl: String(r.source_url),
    enrolledAt: String(r.enrolled_at),
    addressLabel:
      r.kind === "household" ? `${local.slice(0, 1)}…@${domain}` : email,
  };
}
export function activeRecipient(
  db: DatabaseSync,
  id: string,
  now = new Date(),
): Record<string, unknown> {
  const row = db
    .prepare(
      "SELECT * FROM outreach_recipients WHERE id=? AND revoked_at IS NULL",
    )
    .get(id);
  if (!row)
    throw new AccountError(
      404,
      "This contact is not enrolled for Reach outreach.",
    );
  if (
    row.kind === "organization" &&
    !db
      .prepare("SELECT 1 FROM pantries WHERE id=? AND active=1")
      .get(String(row.pantry_id))
  )
    throw new AccountError(409, "This pantry is no longer active.");
  if (row.kind === "household") {
    const donor = db
      .prepare("SELECT email,email_verified_at FROM users WHERE id=?")
      .get(String(row.owner_id));
    const offer = db
      .prepare("SELECT data,status,kind FROM records WHERE id=? AND owner_id=?")
      .get(String(row.offer_id), String(row.owner_id));
    const data = offer ? JSON.parse(String(offer.data)) : null;
    if (
      !donor?.email_verified_at ||
      donor.email !== row.email ||
      offer?.status !== "approved" ||
      offer.kind !== "offer" ||
      !data ||
      Date.parse(data.endsAt) <= +now ||
      Date.parse(data.startsAt) > +now + 7 * 86400000
    )
      throw new AccountError(
        409,
        "The enrolled household offer is no longer eligible for outreach.",
      );
  }
  return row;
}
export function createOutreachDraft(
  db: DatabaseSync,
  userId: string,
  recipientId: string,
  subject: string,
  body: string,
  now = new Date(),
) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO outreach_threads(id,user_id,recipient_id,subject,body,status,created_at,available_at,reply_token) VALUES(?,?,?,?,?,'draft',?,?,?)",
  ).run(
    id,
    userId,
    recipientId,
    subject,
    body,
    now.toISOString(),
    now.toISOString(),
    randomBytes(24).toString("hex"),
  );
  return id;
}
export function outreachHistory(
  db: DatabaseSync,
  userId: string,
): OutreachMessage[] {
  return db
    .prepare(
      "SELECT t.*,r.kind,r.pantry_id,r.offer_id,r.owner_id,r.name,r.email,r.source_url,r.enrolled_at,r.id AS contact_id FROM outreach_threads t JOIN outreach_recipients r ON r.id=t.recipient_id WHERE t.user_id=? ORDER BY t.created_at DESC,t.id DESC LIMIT 50",
    )
    .all(userId)
    .map((row) => {
      const reply = db
        .prepare(
          "SELECT * FROM outreach_replies WHERE thread_id=? ORDER BY received_at DESC,id DESC LIMIT 1",
        )
        .get(String(row.id));
      return {
        id: String(row.id),
        recipient: publicRecipient({ ...row, id: row.contact_id }),
        subject: String(row.subject),
        body: String(row.body),
        status: row.status as OutreachMessage["status"],
        createdAt: String(row.created_at),
        sentAt: row.sent_at ? String(row.sent_at) : null,
        followup:
          row.followup_expires && Number(row.followup_remaining) > 0
            ? {
                expiresAt: String(row.followup_expires),
                remaining: Number(row.followup_remaining),
                intervalHours: Number(row.followup_hours),
              }
            : null,
        reply: reply
          ? {
              id: String(reply.id),
              text: String(reply.text),
              receivedAt: String(reply.received_at),
              identity: "unverified-sender",
              facts: JSON.parse(String(reply.facts_json)) as OutreachFacts,
              reviewedAt: reply.reviewed_at ? String(reply.reviewed_at) : null,
              expiresAt: reply.expires_at ? String(reply.expires_at) : null,
            }
          : null,
      };
    });
}
export function syncOutreachDelivery(db: DatabaseSync) {
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='outreach_threads'")
      .get() ||
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='mail_deliveries'")
      .get()
  )
    return;
  db.exec(
    "UPDATE outreach_threads SET status=(SELECT CASE WHEN status='delivered' THEN 'delivered' WHEN status='bounced' THEN 'bounced' WHEN status='failed' THEN 'failed' ELSE outreach_threads.status END FROM mail_deliveries WHERE id=outreach_threads.delivery_id) WHERE status IN ('accepted','delivered') AND delivery_id IN (SELECT id FROM mail_deliveries)",
  );
  db.prepare(
    "UPDATE outreach_recipients SET revoked_at=? WHERE id IN (SELECT recipient_id FROM outreach_threads WHERE status='bounced') AND revoked_at IS NULL",
  ).run(new Date().toISOString());
}
export function recipientEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(value) &&
    !/[\r\n\0]/.test(value)
  );
}
export function unsubscribeRecipient(
  db: DatabaseSync,
  token: string,
  now = new Date(),
) {
  // Tokens are random private correlation capabilities, never account/session credentials.
  const row = db
    .prepare("SELECT id FROM outreach_recipients WHERE unsubscribe_token=?")
    .get(token);
  if (row) {
    db.prepare("UPDATE outreach_recipients SET revoked_at=? WHERE id=?").run(
      now.toISOString(),
      String(row.id),
    );
    db.prepare(
      "UPDATE outreach_threads SET status=CASE WHEN status IN ('draft','queued') THEN 'cancelled' ELSE status END,followup_remaining=0 WHERE recipient_id=?",
    ).run(String(row.id));
  }
  return { ok: true };
}
export function addOrganizationContact(
  db: DatabaseSync,
  input: {
    pantryId: string;
    name: string;
    email: string;
    sourceUrl: string;
    consentConfirmed: boolean;
  },
) {
  if (
    !input.consentConfirmed ||
    !recipientEmail(input.email) ||
    !input.name.trim() ||
    input.name.length > 150 ||
    !input.sourceUrl.startsWith("https://") ||
    !db
      .prepare("SELECT 1 FROM pantries WHERE id=? AND active=1")
      .get(input.pantryId)
  )
    throw new AccountError(
      400,
      "A verified organization contact, official source and participation consent are required.",
    );
  const id = randomUUID();
  db.prepare(
    "INSERT INTO outreach_recipients(id,kind,pantry_id,name,email,source_url,enrolled_at,unsubscribe_token) VALUES(?,'organization',?,?,?,?,?,?)",
  ).run(
    id,
    input.pantryId,
    input.name,
    input.email.toLowerCase(),
    input.sourceUrl,
    new Date().toISOString(),
    randomBytes(32).toString("hex"),
  );
  return id;
}
