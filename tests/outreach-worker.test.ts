import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeMailSchema,
  MailDeliveryError,
} from "../src/lib/mail-delivery";
import {
  contactFingerprint,
  initializeOutreach,
} from "../src/lib/outreach-store";
import { dispatchOutreach } from "../src/lib/outreach-worker";
import type { deliverMail } from "../src/lib/mail-delivery";

const USER = "user-1",
  RECIPIENT = "recipient-1",
  PARENT = "00000000-0000-4000-8000-000000000001";
const BASE = new Date("2026-10-22T12:00:00.000Z");
type Send = NonNullable<
  NonNullable<Parameters<typeof dispatchOutreach>[1]>["send"]
>;
const sent: Awaited<ReturnType<typeof deliverMail>> = {
  id: "mock-delivery",
  status: "accepted",
};

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,email_verified_at TEXT);
    CREATE TABLE pantries(id TEXT PRIMARY KEY,active INTEGER NOT NULL);
    CREATE TABLE records(id TEXT PRIMARY KEY);
    CREATE TABLE blocks(user_id TEXT NOT NULL,blocked_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(user_id,blocked_id));
  `);
  initializeMailSchema(db);
  initializeOutreach(db);
  db.prepare("INSERT INTO users VALUES(?,?,?)").run(
    USER,
    "requester@example.org",
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare("INSERT INTO pantries VALUES(?,1)").run("pantry-1");
  db.prepare(
    "INSERT INTO outreach_recipients(id,kind,pantry_id,name,email,source_url,enrolled_at,unsubscribe_token) VALUES(?,'organization',?,?,?,?,?,?)",
  ).run(
    RECIPIENT,
    "pantry-1",
    "Synthetic pantry",
    "contact@example.org",
    "https://example.org/contact",
    BASE.toISOString(),
    "a".repeat(64),
  );
  return db;
}

function createThread(
  db: DatabaseSync,
  options: {
    id?: string;
    status?: string;
    sentAt?: Date | null;
    followupRemaining?: number;
    followupHours?: number;
    followupExpires?: Date | null;
    authorizationExpires?: Date;
    deliveryId?: string | null;
  } = {},
) {
  const id = options.id || PARENT;
  const recipient = db
    .prepare("SELECT * FROM outreach_recipients WHERE id=?")
    .get(RECIPIENT) as Record<string, unknown>;
  db.prepare(
    `INSERT INTO outreach_threads(
    id,user_id,recipient_id,subject,body,status,created_at,available_at,sent_at,attempts,delivery_id,
    reply_token,followup_expires,followup_remaining,followup_hours,parent_id,authorization_expires,approved_contact_hash
  ) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?, ?,?,NULL,?,?)`,
  ).run(
    id,
    USER,
    RECIPIENT,
    "Synthetic question",
    "Synthetic approved body",
    options.status || "accepted",
    BASE.toISOString(),
    BASE.toISOString(),
    options.sentAt === null ? null : (options.sentAt || BASE).toISOString(),
    options.deliveryId || null,
    ("b" + id.replace(/-/g, "")).slice(0, 48).padEnd(48, "b"),
    options.followupExpires === null
      ? null
      : (
          options.followupExpires || new Date(+BASE + 48 * 3600000)
        ).toISOString(),
    options.followupRemaining ?? 0,
    options.followupHours ?? 24,
    (
      options.authorizationExpires || new Date(+BASE + 96 * 3600000)
    ).toISOString(),
    contactFingerprint(recipient),
  );
  return id;
}

const advance = (hours: number) => new Date(+BASE + hours * 3600000);
const defaultSend = () => vi.fn<Send>().mockResolvedValue(sent);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REACH_EMAIL_PROVIDER", "preview");
  vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example.org");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("outreach worker follow-up and delivery states", () => {
  it("sends only after the opted-in 24-hour interval, within expiry, and no more than the authorized count", async () => {
    const db = fixture();
    try {
      createThread(db, {
        followupRemaining: 1,
        followupHours: 24,
        followupExpires: advance(48),
      });
      const send = defaultSend();
      expect(
        (await dispatchOutreach(db, { now: () => advance(23), send }))
          .processed,
      ).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(
        (await dispatchOutreach(db, { now: () => advance(24), send })).accepted,
      ).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) count FROM outreach_threads WHERE parent_id=?",
          )
          .get(PARENT)?.count,
      ).toBe(1);
      expect(
        db
          .prepare("SELECT followup_remaining FROM outreach_threads WHERE id=?")
          .get(PARENT)?.followup_remaining,
      ).toBe(0);
      expect(
        (await dispatchOutreach(db, { now: () => advance(36), send }))
          .processed,
      ).toBe(0);
      expect(
        (await dispatchOutreach(db, { now: () => advance(48), send }))
          .processed,
      ).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("does not follow up without opt-in or after a reply", async () => {
    const db = fixture();
    try {
      createThread(db, { id: PARENT, followupRemaining: 0 });
      const repliedId = "00000000-0000-4000-8000-000000000002";
      createThread(db, {
        id: repliedId,
        followupRemaining: 1,
        followupExpires: advance(48),
      });
      db.prepare(
        "INSERT INTO outreach_replies(id,thread_id,email_id,text,received_at,facts_json) VALUES(?,?,?,?,?,?)",
      ).run(
        "00000000-0000-4000-8000-000000000003",
        repliedId,
        "reply-1",
        "Thanks",
        BASE.toISOString(),
        "{}",
      );
      const send = defaultSend();
      const result = await dispatchOutreach(db, {
        now: () => advance(30),
        send,
      });
      expect(result.processed).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(
        db
          .prepare("SELECT followup_remaining FROM outreach_threads WHERE id=?")
          .get(repliedId)?.followup_remaining,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it("stops queued follow-ups after cancellation or recipient suppression", async () => {
    for (const stop of ["cancel", "suppress"] as const) {
      const db = fixture();
      try {
        createThread(db, {
          followupRemaining: 1,
          followupExpires: advance(48),
        });
        if (stop === "cancel")
          db.prepare(
            "UPDATE outreach_threads SET status='cancelled' WHERE id=?",
          ).run(PARENT);
        else
          db.prepare(
            "UPDATE outreach_recipients SET revoked_at=? WHERE id=?",
          ).run(advance(12).toISOString(), RECIPIENT);
        const send = defaultSend();
        const result = await dispatchOutreach(db, {
          now: () => advance(24),
          send,
        });
        expect(send).not.toHaveBeenCalled();
        if (stop === "cancel") expect(result.processed).toBe(0);
        else expect(result.cancelled).toBe(1);
      } finally {
        db.close();
      }
    }
  });

  it("syncs a bounce into recipient suppression and blocks a later follow-up", async () => {
    const db = fixture();
    try {
      createThread(db, {
        followupRemaining: 1,
        followupExpires: advance(48),
        deliveryId: "delivery-bounced",
      });
      db.prepare(
        `INSERT INTO mail_deliveries(id,user_id,kind,provider,status,created_at,updated_at)
        VALUES(? ,?,'outreach','smtp','bounced',?,?)`,
      ).run("delivery-bounced", USER, BASE.toISOString(), BASE.toISOString());
      const send = defaultSend();
      const result = await dispatchOutreach(db, {
        now: () => advance(24),
        send,
      });
      expect(result.processed).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(
        db.prepare("SELECT status FROM outreach_threads WHERE id=?").get(PARENT)
          ?.status,
      ).toBe("bounced");
      expect(
        db
          .prepare("SELECT revoked_at FROM outreach_recipients WHERE id=?")
          .get(RECIPIENT)?.revoked_at,
      ).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it("backs off and retries a known pre-accept failure once due while uncertain delivery is never retried", async () => {
    const db = fixture();
    try {
      createThread(db, {
        status: "queued",
        sentAt: null,
        authorizationExpires: advance(96),
      });
      const send = vi
        .fn<Send>()
        .mockRejectedValueOnce(new MailDeliveryError("throttled", true))
        .mockResolvedValueOnce(sent);
      expect(
        (await dispatchOutreach(db, { now: () => BASE, send })).retried,
      ).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        db
          .prepare(
            "SELECT status,attempts,available_at FROM outreach_threads WHERE id=?",
          )
          .get(PARENT),
      ).toMatchObject({
        status: "queued",
        attempts: 1,
        available_at: new Date(+BASE + 60000).toISOString(),
      });
      expect(
        (await dispatchOutreach(db, { now: () => BASE, send })).processed,
      ).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        (
          await dispatchOutreach(db, {
            now: () => new Date(+BASE + 60000),
            send,
          })
        ).accepted,
      ).toBe(1);
      expect(send).toHaveBeenCalledTimes(2);
      expect(
        db
          .prepare("SELECT status,attempts FROM outreach_threads WHERE id=?")
          .get(PARENT),
      ).toMatchObject({ status: "accepted", attempts: 2 });
    } finally {
      db.close();
    }

    const uncertainDb = fixture();
    try {
      createThread(uncertainDb, {
        status: "queued",
        sentAt: null,
        authorizationExpires: advance(96),
      });
      const uncertainSend = vi
        .fn<Send>()
        .mockResolvedValue({ id: "uncertain-delivery", status: "uncertain" });
      expect(
        (
          await dispatchOutreach(uncertainDb, {
            now: () => BASE,
            send: uncertainSend,
          })
        ).uncertain,
      ).toBe(1);
      expect(
        (
          await dispatchOutreach(uncertainDb, {
            now: () => advance(2),
            send: uncertainSend,
          })
        ).processed,
      ).toBe(0);
      expect(uncertainSend).toHaveBeenCalledTimes(1);
      expect(
        uncertainDb
          .prepare(
            "SELECT status,followup_remaining FROM outreach_threads WHERE id=?",
          )
          .get(PARENT),
      ).toMatchObject({ status: "uncertain", followup_remaining: 0 });
    } finally {
      uncertainDb.close();
    }
  });
});
