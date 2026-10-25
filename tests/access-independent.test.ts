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
});

afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("independent outreach authorization and privacy checks", () => {
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
