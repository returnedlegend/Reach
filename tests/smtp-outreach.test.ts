import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountHash } from "../src/lib/account-store";
import { openPantryDatabase } from "../src/lib/pantry-store";
import {
  addOrganizationContact,
  initializeOutreach,
} from "../src/lib/outreach-store";
import { createOutreachHandler } from "../src/lib/outreach";
import { dispatchOutreach } from "../src/lib/outreach-worker";
import { deliverMail, initializeMailSchema } from "../src/lib/mail-delivery";
import type {
  SmtpTransport,
  SmtpTransportFactory,
} from "../src/lib/smtp-delivery";
import type { SendMailOptions } from "nodemailer";

const ORIGIN = "https://reach.example.org";
const NOW = new Date("2026-10-22T12:00:00.000Z");
let directory: string;
let databasePath: string;
let userId: string;
let cookie: string;
let recipientId: string;
let handler: ReturnType<typeof createOutreachHandler>;
let setupDatabase: ReturnType<typeof openPantryDatabase>;

function smtpEnvironment() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REACH_APP_ORIGIN", ORIGIN);
  vi.stubEnv("REACH_EMAIL_PROVIDER", "smtp");
  vi.stubEnv("REACH_AI_PROVIDER", "");
  vi.stubEnv("REACH_AI_MODEL", "");
  vi.stubEnv("SMTP_HOST", "smtp.resend.com");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_SECURE", "true");
  vi.stubEnv("SMTP_USER", "resend");
  vi.stubEnv("SMTP_PASSWORD", "re_synthetic_smtp_key");
  vi.stubEnv("SMTP_FROM_EMAIL", "mail@example.org");
  vi.stubEnv("SMTP_FROM_NAME", "Reach fixture");
  vi.stubEnv("RESEND_API_KEY", "re_synthetic_inbound_key");
  vi.stubEnv("REACH_OUTREACH_REPLY_DOMAIN", "replies.reach.example");
  vi.stubEnv(
    "RESEND_INBOUND_WEBHOOK_SECRET",
    `whsec_${Buffer.from("smtp outreach fixture secret").toString("base64")}`,
  );
}

function makeTransportFactory(
  sendMail: (message: SendMailOptions) => Promise<unknown>,
): SmtpTransportFactory {
  return () => ({
    sendMail: sendMail as unknown as SmtpTransport["sendMail"],
    close: vi.fn(),
  });
}

async function request(path: string[], method = "GET", data?: unknown) {
  return handler(
    new Request(`${ORIGIN}/api/outreach/${path.join("/")}`, {
      method,
      headers: {
        ...(method === "GET"
          ? {}
          : { "content-type": "application/json", origin: ORIGIN }),
        cookie,
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(data ?? {}) }),
    }),
    path,
  );
}

async function draftAndAuthorize() {
  const history = await request([], "GET");
  expect(history.status, await history.clone().text()).toBe(200);
  const created = await request(["draft"], "POST", {
    recipientId,
    question: "Do you have produce available today?",
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const draft = (await created.json()).message as {
    id: string;
    subject: string;
    body: string;
  };
  const authorized = await request([draft.id, "authorize"], "POST", {
    subject: draft.subject,
    body: draft.body,
    authorized: true,
  });
  expect(authorized.status).toBe(202);
  return draft.id;
}

beforeEach(() => {
  smtpEnvironment();
  directory = mkdtempSync(join(tmpdir(), "reach-smtp-outreach-"));
  databasePath = join(directory, "community.sqlite");
  userId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const db = (setupDatabase = openPantryDatabase(databasePath));
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,name) VALUES(?,?,?,'','resident',1,?,?,?,'Synthetic SMTP test actor')",
  ).run(
    userId,
    userId,
    "fixture-only-no-login",
    NOW.toISOString(),
    `${userId}@example.org`,
    NOW.toISOString(),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    userId,
    "2030-01-01T00:00:00.000Z",
  );
  cookie = `reach_community_session=${token}`;
  initializeOutreach(db);
  initializeMailSchema(db);
  const pantryId = String(
    db
      .prepare("SELECT id FROM pantries WHERE active=1 ORDER BY id LIMIT 1")
      .get()!.id,
  );
  recipientId = addOrganizationContact(db, {
    pantryId,
    name: "Synthetic enrolled pantry",
    email: "smtp-contact@example.org",
    sourceUrl: "https://example.org/synthetic-contact",
    consentConfirmed: true,
  });
  handler = createOutreachHandler(databasePath, { now: () => NOW });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setupDatabase.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("reviewed outreach over the shared SMTP delivery boundary", () => {
  it("dispatches a reviewed queue through deliverMail, persists accepted SMTP metadata, and does not send twice", async () => {
    const threadId = await draftAndAuthorize();
    const sendMail = vi.fn(async (message: SendMailOptions) => ({
      accepted: ["smtp-contact@example.org"],
      rejected: [],
      messageId: String(message.messageId),
      response: "250 OK",
    }));
    const smtpTransportFactory = makeTransportFactory(sendMail);
    const send: typeof deliverMail = (db, mail) =>
      deliverMail(db, mail, { smtpTransportFactory });
    const db = openPantryDatabase(databasePath);
    const first = await dispatchOutreach(db, { now: () => NOW, send });
    const second = await dispatchOutreach(db, { now: () => NOW, send });
    expect(first.accepted).toBe(1);
    expect(second.processed).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const thread = db
      .prepare("SELECT status,delivery_id FROM outreach_threads WHERE id=?")
      .get(threadId) as { status: string; delivery_id: string };
    expect(thread.status).toBe("accepted");
    expect(
      db
        .prepare(
          "SELECT provider,status,provider_message_id,rfc_message_id FROM mail_deliveries WHERE id=?",
        )
        .get(thread.delivery_id),
    ).toMatchObject({
      provider: "smtp",
      status: "accepted",
      provider_message_id: null,
      rfc_message_id: expect.stringMatching(/^<reach\..+@example\.org>$/),
    });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM mail_deliveries WHERE status='delivered'",
        )
        .get()?.count,
    ).toBe(0);
  });

  it("records ambiguous relay acceptance once and leaves the reviewed inquiry uncertain", async () => {
    const threadId = await draftAndAuthorize();
    const sendMail = vi.fn().mockRejectedValue(
      Object.assign(new Error("synthetic transport failure"), {
        code: "ECONNECTION",
        command: "DATA",
      }),
    );
    const smtpTransportFactory = makeTransportFactory(sendMail);
    const send: typeof deliverMail = (db, mail) =>
      deliverMail(db, mail, { smtpTransportFactory });
    const db = openPantryDatabase(databasePath);
    const first = await dispatchOutreach(db, { now: () => NOW, send });
    const second = await dispatchOutreach(db, {
      now: () => new Date(+NOW + 60_000),
      send,
    });
    expect(first.uncertain).toBe(1);
    expect(second.processed).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const thread = db
      .prepare("SELECT status,delivery_id FROM outreach_threads WHERE id=?")
      .get(threadId) as { status: string; delivery_id: string };
    expect(thread.status).toBe("uncertain");
    expect(
      db
        .prepare(
          "SELECT provider,status,error_code FROM mail_deliveries WHERE id=?",
        )
        .get(thread.delivery_id),
    ).toEqual({
      provider: "smtp",
      status: "uncertain",
      error_code: "ambiguous",
    });
  });

  it("requires configured inbound reply handling for SMTP authorization and worker dispatch", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_INBOUND_WEBHOOK_SECRET", "");
    vi.stubEnv("REACH_OUTREACH_REPLY_DOMAIN", "");
    const created = await request(["draft"], "POST", {
      recipientId,
      question: "Do you have produce available today?",
    });
    expect(created.status).toBe(201);
    const draft = (await created.json()).message as {
      id: string;
      subject: string;
      body: string;
    };
    const authorized = await request([draft.id, "authorize"], "POST", {
      subject: draft.subject,
      body: draft.body,
      authorized: true,
    });
    expect(authorized.status).toBe(503);

    const db = openPantryDatabase(databasePath);
    db.prepare("UPDATE outreach_threads SET status='queued' WHERE id=?").run(
      draft.id,
    );
    const sendMail = vi.fn();
    const send: typeof deliverMail = (database, mail) =>
      deliverMail(database, mail, {
        smtpTransportFactory: makeTransportFactory(sendMail),
      });
    const result = await dispatchOutreach(db, { now: () => NOW, send });
    expect(result.unavailable).toBe(true);
    expect(result.processed).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
