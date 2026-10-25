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
  vi.stubEnv("SMTP_HOST", "smtp.example.org");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_SECURE", "true");
  vi.stubEnv("SMTP_USER", "mailer");
  vi.stubEnv("SMTP_PASSWORD", "synthetic-password");
  vi.stubEnv("SMTP_FROM_EMAIL", "mail@example.org");
  vi.stubEnv("SMTP_FROM_NAME", "Reach fixture");
  vi.stubEnv("REACH_OUTREACH_REPLY_EMAIL", "replies@reach.example");
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
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      replyTo: "replies@reach.example",
    });
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

  it("rejects automatic follow-up consent while retaining the draft for a reviewed primary send", async () => {
    const created = await request(["draft"], "POST", {
      recipientId,
      question: "Do you have produce available today?",
    });
    const draft = (await created.json()).message;
    const result = await request([draft.id, "authorize"], "POST", {
      subject: draft.subject,
      body: draft.body,
      authorized: true,
      followup: { optIn: true, intervalHours: 24, expiresInHours: 48, max: 1 },
    });
    expect(result.status).toBe(400);
    expect(await result.text()).toContain("Turn off follow-ups");
    expect(
      setupDatabase
        .prepare(
          "SELECT status,followup_remaining FROM outreach_threads WHERE id=?",
        )
        .get(draft.id),
    ).toMatchObject({ status: "draft", followup_remaining: 0 });
    expect(
      (
        await request([draft.id, "authorize"], "POST", {
          subject: draft.subject,
          body: draft.body,
          authorized: true,
        })
      ).status,
    ).toBe(202);
  });

  it("cancels existing automatic SMTP follow-ups and future consent while still sending a reviewed primary inquiry", async () => {
    const primaryId = await draftAndAuthorize();
    const primary = setupDatabase
      .prepare("SELECT * FROM outreach_threads WHERE id=?")
      .get(primaryId)!;
    const parentId = randomUUID(),
      childId = randomUUID();
    const insert = (overrides: Record<string, string | number | null>) => {
      const row = { ...primary, ...overrides };
      const columns = Object.keys(row);
      setupDatabase
        .prepare(
          `INSERT INTO outreach_threads (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        )
        .run(...Object.values(row));
    };
    insert({
      id: parentId,
      reply_token: randomBytes(24).toString("hex"),
      status: "accepted",
      sent_at: new Date(+NOW - 25 * 3600000).toISOString(),
      followup_remaining: 1,
      followup_expires: new Date(+NOW + 48 * 3600000).toISOString(),
    });
    insert({
      id: childId,
      reply_token: randomBytes(24).toString("hex"),
      parent_id: parentId,
      status: "queued",
      available_at: new Date(+NOW + 3600000).toISOString(),
    });
    const send = vi.fn(async () => ({
      id: "primary-fixture-delivery",
      status: "accepted" as const,
    }));
    const result = await dispatchOutreach(setupDatabase, {
      now: () => NOW,
      send,
    });
    expect(result).toMatchObject({ accepted: 1, cancelled: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      setupDatabase
        .prepare("SELECT status FROM outreach_threads WHERE id=?")
        .get(primaryId)?.status,
    ).toBe("accepted");
    expect(
      setupDatabase
        .prepare(
          "SELECT status,followup_remaining FROM outreach_threads WHERE id=?",
        )
        .get(parentId),
    ).toMatchObject({ status: "accepted", followup_remaining: 0 });
    expect(
      setupDatabase
        .prepare("SELECT status FROM outreach_threads WHERE id=?")
        .get(childId)?.status,
    ).toBe("cancelled");
    expect(
      setupDatabase
        .prepare("SELECT COUNT(*) AS count FROM outreach_threads")
        .get()?.count,
    ).toBe(3);
    await dispatchOutreach(setupDatabase, {
      now: () => new Date(+NOW + 26 * 3600000),
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("requires a monitored reply mailbox for SMTP authorization and worker dispatch", async () => {
    vi.stubEnv("REACH_OUTREACH_REPLY_EMAIL", "");
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
