import { closeCommunityDatabases } from "../src/lib/community";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { accountHash } from "../src/lib/account-store";
import { openPantryDatabase } from "../src/lib/pantry-store";
import {
  addOrganizationContact,
  initializeOutreach,
} from "../src/lib/outreach-store";
import { createOutreachHandler } from "../src/lib/outreach";
import { dispatchOutreach } from "../src/lib/outreach-worker";
import { initializeMailSchema } from "../src/lib/mail-schema";
import { privateAvailability } from "../src/lib/access-service";
import { chicagoNow } from "../src/lib/journey";
import { shiftDate } from "../src/lib/time";

const origin = "https://reach.example";
const instant = new Date();
type Actor = { id: string; cookie: string };
let directory: string;
let database: string;
let actor: Actor;
let other: Actor;
let third: Actor;
let recipientId: string;
let pantryId: string;
let handle: ReturnType<typeof createOutreachHandler>;

function addActor(id = randomUUID()): Actor {
  const db = openPantryDatabase(database);
  const token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,name) VALUES(?,?,?,'','resident',1,?,?,?,'Test account')",
  ).run(
    id,
    id,
    "fixture-only-no-login",
    instant.toISOString(),
    `${id}@example.org`,
    instant.toISOString(),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    id,
    "2030-01-01T00:00:00.000Z",
  );
  return { id, cookie: `reach_community_session=${token}` };
}

async function call(
  path: string[] = [],
  method = "GET",
  data?: unknown,
  client?: Actor,
  sameOrigin = true,
) {
  return handle(
    new Request(`${origin}/api/outreach/${path.join("/")}`, {
      method,
      headers: {
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
        ...(method !== "GET" && sameOrigin ? { origin } : {}),
        ...(client ? { cookie: client.cookie } : {}),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(data ?? {}) }),
    }),
    path,
  );
}

async function createDraft(client = actor) {
  const response = await call(
    ["draft"],
    "POST",
    { recipientId, question: "Do you have produce available today?" },
    client,
  );
  expect(response.status).toBe(201);
  return (await response.json()).message as {
    id: string;
    subject: string;
    body: string;
    status: string;
  };
}

async function authorize(
  id: string,
  subject: string,
  body: string,
  client = actor,
) {
  return call(
    [id, "authorize"],
    "POST",
    {
      subject,
      body,
      authorized: true,
    },
    client,
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-access-independent-"));
  database = join(directory, "community.sqlite");
  vi.stubEnv("REACH_APP_ORIGIN", origin);
  vi.stubEnv("REACH_EMAIL_PROVIDER", "preview");
  vi.stubEnv("REACH_AI_PROVIDER", "");
  vi.stubEnv("REACH_AI_MODEL", "");
  vi.stubEnv("NODE_ENV", "test");
  actor = addActor();
  other = addActor();
  third = addActor();
  const db = openPantryDatabase(database);
  initializeOutreach(db);
  const pantry = db
    .prepare("SELECT id FROM pantries WHERE active=1 ORDER BY id LIMIT 1")
    .get();
  pantryId = String(pantry!.id);
  recipientId = addOrganizationContact(db, {
    pantryId,
    name: "Participating Pantry",
    email: "pantry-contact@example.org",
    sourceUrl: "https://pantry.example.org/contact",
    consentConfirmed: true,
  });
  handle = createOutreachHandler(database, { now: () => instant });
});

afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("independent outreach authorization and privacy checks", () => {
  it("requires a verified session, keeps history owner-scoped, and returns private no-store data", async () => {
    const unauthorized = await call();
    expect(unauthorized.status).toBe(401);
    const draft = await createDraft(actor);
    const own = await call([], "GET", undefined, actor);
    const response = await own.json();
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect(
      response.messages.map((message: { id: string }) => message.id),
    ).toContain(draft.id);
    // Organization recipients are trusted, opt-in contacts; the private address is
    // used for delivery and currently also appears in the reviewed recipient label.
    expect(JSON.stringify(response)).not.toMatch(
      /account_locations|latitude|longitude/,
    );

    const otherHistory = await call([], "GET", undefined, other);
    expect((await otherHistory.json()).messages).toEqual([]);
    const privateMessage = await call(
      [draft.id, "authorize"],
      "POST",
      {
        subject: draft.subject,
        body: draft.body,
        authorized: true,
      },
      other,
    );
    expect(privateMessage.status).toBe(404);
    expect(await privateMessage.json()).toEqual({
      error: "Outreach message was not found.",
    });
  });

  it("requires explicit reviewed authorization, preserves the disclosure, and queues once", async () => {
    const draft = await createDraft();
    const omittedConsent = await call(
      [draft.id, "authorize"],
      "POST",
      {
        subject: draft.subject,
        body: draft.body,
      },
      actor,
    );
    expect(omittedConsent.status).toBe(400);
    expect((await omittedConsent.json()).error).not.toMatch(
      /SQL|database|exception/i,
    );
    expect(
      openPantryDatabase(database)
        .prepare("SELECT status FROM outreach_threads WHERE id=?")
        .get(draft.id)!.status,
    ).toBe("draft");

    const missingDisclosure = await authorize(
      draft.id,
      draft.subject,
      "Hello, please tell me if food is available.",
    );
    expect(missingDisclosure.status).toBe(400);
    const queued = await authorize(draft.id, draft.subject, draft.body);
    expect(queued.status).toBe(202);
    expect((await queued.json()).message.status).toBe("queued");
    expect((await authorize(draft.id, draft.subject, draft.body)).status).toBe(
      409,
    );
    expect(
      openPantryDatabase(database)
        .prepare(
          "SELECT COUNT(*) AS count FROM outreach_threads WHERE user_id=? AND recipient_id=? AND status='queued'",
        )
        .get(actor.id, recipientId)!.count,
    ).toBe(1);
    const db = openPantryDatabase(database);
    initializeMailSchema(db);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM mail_deliveries").get()!.count,
    ).toBe(0);
  });

  it("rejects cross-origin mutations and suppresses a recipient without exposing its address", async () => {
    const draft = await createDraft();
    expect(
      (
        await call(
          [draft.id, "authorize"],
          "POST",
          {
            subject: draft.subject,
            body: draft.body,
            authorized: true,
          },
          actor,
          false,
        )
      ).status,
    ).toBe(403);
    expect((await authorize(draft.id, draft.subject, draft.body)).status).toBe(
      202,
    );

    const db = openPantryDatabase(database);
    const token = String(
      db
        .prepare("SELECT unsubscribe_token FROM outreach_recipients WHERE id=?")
        .get(recipientId)!.unsubscribe_token,
    );
    const unsubscribed = await call(
      ["unsubscribe"],
      "POST",
      { token },
      undefined,
    );
    expect(unsubscribed.status).toBe(200);
    const unsubscribeResult = await unsubscribed.json();
    expect(unsubscribeResult).toEqual({ ok: true });
    expect(
      db
        .prepare("SELECT revoked_at FROM outreach_recipients WHERE id=?")
        .get(recipientId)!.revoked_at,
    ).toBe(instant.toISOString());
    expect(
      db
        .prepare(
          "SELECT status,followup_remaining FROM outreach_threads WHERE id=?",
        )
        .get(draft.id),
    ).toMatchObject({ status: "cancelled", followup_remaining: 0 });
    expect(JSON.stringify(unsubscribeResult)).not.toContain(
      "pantry-contact@example.org",
    );
  });

  it("enforces persistent draft rate limits and the worker does not resend a completed queue item", async () => {
    let last: Response | undefined;
    for (let index = 0; index < 13; index++)
      last = await call(
        ["draft"],
        "POST",
        {
          recipientId,
          question: "Do you have food available today?",
        },
        actor,
      );
    expect(last!.status).toBe(429);
    expect(
      openPantryDatabase(database)
        .prepare(
          "SELECT COUNT(*) AS count FROM outreach_threads WHERE user_id=? AND status='draft'",
        )
        .get(actor.id)!.count,
    ).toBe(12);

    const draft = await createDraft(other);
    const queued = await authorize(draft.id, draft.subject, draft.body, other);
    expect(queued.status).toBe(202);
    const send = vi.fn(async () => ({
      id: "fixture-delivery-id",
      status: "accepted" as const,
    }));
    const db = openPantryDatabase(database);
    const first = await dispatchOutreach(db, { now: () => instant, send });
    const second = await dispatchOutreach(db, { now: () => instant, send });
    expect(first.accepted).toBe(1);
    expect(second.processed).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare("SELECT status,delivery_id FROM outreach_threads WHERE id=?")
        .get(draft.id),
    ).toMatchObject({ status: "accepted", delivery_id: "fixture-delivery-id" });

    const expiringDraft = await createDraft(third);
    expect(
      (
        await authorize(
          expiringDraft.id,
          expiringDraft.subject,
          expiringDraft.body,
          third,
        )
      ).status,
    ).toBe(202);
    const expiry = new Date(+instant + 25 * 3600000);
    const expiredDispatch = await dispatchOutreach(db, {
      now: () => expiry,
      send,
    });
    expect(expiredDispatch.cancelled).toBe(1);
    expect(
      db
        .prepare("SELECT status FROM outreach_threads WHERE id=?")
        .get(expiringDraft.id)!.status,
    ).toBe("cancelled");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("cancels a queued inquiry when the enrolled contact changes after approval", async () => {
    const draft = await createDraft();
    expect((await authorize(draft.id, draft.subject, draft.body)).status).toBe(
      202,
    );
    const db = openPantryDatabase(database);
    const approvedHash = db
      .prepare("SELECT approved_contact_hash FROM outreach_threads WHERE id=?")
      .get(draft.id)!.approved_contact_hash;
    expect(approvedHash).toBeTruthy();
    db.prepare("UPDATE outreach_recipients SET email=? WHERE id=?").run(
      "changed-contact@example.org",
      recipientId,
    );

    const send = vi.fn(async () => ({
      id: "should-not-send",
      status: "accepted" as const,
    }));
    const result = await dispatchOutreach(db, { now: () => instant, send });

    expect(result.cancelled).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(
      db
        .prepare(
          "SELECT status,delivery_id,approved_contact_hash FROM outreach_threads WHERE id=?",
        )
        .get(draft.id),
    ).toMatchObject({
      status: "cancelled",
      delivery_id: null,
      approved_contact_hash: approvedHash,
    });
  });

  it("makes a reviewed sender report available only to its requesting account and only before expiry", () => {
    const db = openPantryDatabase(database);
    const reportDate = chicagoNow(instant).date;
    const threadId = randomUUID();
    db.prepare(
      "INSERT INTO outreach_threads(id,user_id,recipient_id,subject,body,status,created_at,available_at,sent_at,reply_token) VALUES(?,?,?,'subject','body','replied',?,?,?,?)",
    ).run(
      threadId,
      actor.id,
      recipientId,
      instant.toISOString(),
      instant.toISOString(),
      instant.toISOString(),
      randomBytes(24).toString("hex"),
    );
    db.prepare(
      "INSERT INTO outreach_replies(id,thread_id,email_id,text,received_at,facts_json,reviewed_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      threadId,
      randomUUID(),
      "We have produce today.",
      instant.toISOString(),
      JSON.stringify({
        availability: "available",
        date: reportDate,
        pickupStart: null,
        pickupEnd: null,
        foodType: "produce",
        requirements: "",
        supportingText: "We have produce today.",
        uncertainty: [],
      }),
      instant.toISOString(),
      new Date(+instant + 3600000).toISOString(),
    );

    const own = privateAvailability(
      db,
      actor.id,
      pantryId,
      reportDate,
      instant,
    );
    expect(own.availability).toMatchObject({
      status: "available",
      expiresAt: new Date(+instant + 3600000).toISOString(),
    });
    expect(own.availability.source).toContain("Private");
    expect(
      privateAvailability(db, other.id, pantryId, reportDate, instant)
        .availability.status,
    ).toBe("unknown");
    expect(
      privateAvailability(db, undefined, pantryId, reportDate, instant)
        .availability.status,
    ).toBe("unknown");
    expect(
      privateAvailability(
        db,
        actor.id,
        pantryId,
        reportDate,
        new Date(+instant + 3600000),
      ).availability.status,
    ).toBe("unknown");
  });
});
