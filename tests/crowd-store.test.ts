import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountHash } from "../src/lib/account-store";
import {
  initializeCrowdSchema,
  pruneCrowdData,
  submitCrowdReport,
} from "../src/lib/crowd-store";
import { getCrowdSummary } from "../src/lib/crowd-store";
import {
  createPantry,
  openPantryDatabase,
  savePantryHours,
  getPantryRecord,
} from "../src/lib/pantry-store";
import { getPantryScheduleEvidence } from "../src/lib/pantry-store";
import type { PantryWindow } from "../src/lib/types";

const databases: DatabaseSync[] = [];
const directories: string[] = [];
function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,email_verified_at TEXT,name TEXT,username TEXT,pantry_role TEXT);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at TEXT);
    CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,reset_at INTEGER);
    CREATE TABLE pantries(id TEXT PRIMARY KEY,active INTEGER);
    CREATE TABLE pantry_managers(pantry_id TEXT,user_id TEXT);
    INSERT INTO users VALUES('user-1','person@example.test','2026-01-01T00:00:00Z','Person','person','user');
    INSERT INTO pantries VALUES('p1',1);`);
  const token = "a".repeat(64);
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    "user-1",
    "2030-01-01T00:00:00.000Z",
  );
  initializeCrowdSchema(db);
  return {
    db,
    request: new Request("https://reach.test/api", {
      headers: { cookie: `reach_community_session=${token}` },
    }),
  };
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("crowd storage privacy and deduplication", () => {
  it("stores aggregate values without account, session, or request identifiers", () => {
    const { db, request } = fixture();
    submitCrowdReport(
      db,
      request,
      "p1",
      { level: 2, waitMinutes: 30 },
      new Date("2026-01-05T16:00:00Z"),
    );
    const columns = (
      db.prepare("PRAGMA table_info(crowd_buckets)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(columns).not.toContain("user_id");
    expect(columns).not.toContain("session_id");
    expect(columns).not.toContain("ip");
    expect(
      db
        .prepare(
          "SELECT reports,level_sum,wait_sum,staff_reports FROM crowd_buckets",
        )
        .get(),
    ).toMatchObject({
      reports: 1,
      level_sum: 2,
      wait_sum: 30,
      staff_reports: 0,
    });
    expect(
      db
        .prepare("SELECT value FROM crowd_metadata WHERE key='dedup_secret'")
        .get(),
    ).toBeTruthy();
  });
  it("rejects a second report from the same account for the pantry and local day", () => {
    const { db, request } = fixture();
    submitCrowdReport(
      db,
      request,
      "p1",
      { level: 0 },
      new Date("2026-01-05T16:00:00Z"),
    );
    expect(() =>
      submitCrowdReport(
        db,
        request,
        "p1",
        { level: 3 },
        new Date("2026-01-05T18:00:00Z"),
      ),
    ).toThrow(/already reported/);
    expect(
      db.prepare("SELECT SUM(reports) reports FROM crowd_buckets").get(),
    ).toMatchObject({ reports: 1 });
  });

  it("prunes expired buckets and HMAC hashes without requiring a new report", () => {
    const { db } = fixture();
    const now = new Date("2026-05-04T14:00:00.000Z");
    const expiredBucket = new Date(
      now.getTime() - 90 * 86400000 - 1,
    ).toISOString();
    const recentBucket = new Date(now.getTime() - 60 * 86400000).toISOString();
    for (const slot of [expiredBucket, recentBucket]) {
      const localDate = slot.slice(0, 10);
      db.prepare(
        "INSERT INTO crowd_buckets(pantry_id,slot_start,local_date,weekday,hour,reports,level_sum,last_updated) VALUES('p1',?,?,1,9,3,3,?)",
      ).run(slot, localDate, slot);
    }
    db.prepare(
      "INSERT INTO crowd_dedup(dedupe_hash,expires_at) VALUES('expired',?),('fresh',?)",
    ).run(
      new Date(now.getTime() - 1).toISOString(),
      new Date(now.getTime() + 86400000).toISOString(),
    );

    expect(pruneCrowdData(db, now)).toEqual({ dedupHashes: 1, buckets: 1 });
    expect(
      db.prepare("SELECT COUNT(*) count FROM crowd_buckets").get(),
    ).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT dedupe_hash FROM crowd_dedup").all()).toEqual([
      { dedupe_hash: "fresh" },
    ]);
  });
  it("requires an authenticated verified actor and active pantry", () => {
    const { db } = fixture();
    expect(() =>
      submitCrowdReport(db, new Request("https://reach.test"), "p1", {
        level: 1,
      }),
    ).toThrow(/Sign in/);
    db.prepare("UPDATE users SET email_verified_at=NULL").run();
    const token = "a".repeat(64);
    const request = new Request("https://reach.test", {
      headers: { cookie: `reach_community_session=${token}` },
    });
    expect(() => submitCrowdReport(db, request, "p1", { level: 1 })).toThrow(
      /Verify your email/,
    );
    expect(
      db.prepare("SELECT COUNT(*) count FROM crowd_buckets").get(),
    ).toMatchObject({ count: 0 });
  });

  it("recommends the uniquely quieter future whole hour inside a verified distribution window", () => {
    const directory = mkdtempSync(join(tmpdir(), "reach-crowd-window-"));
    directories.push(directory);
    const db = openPantryDatabase(join(directory, "community.sqlite"));
    databases.push(db);
    initializeCrowdSchema(db);
    const pantryId = String(
      db.prepare("SELECT id FROM pantries ORDER BY id LIMIT 1").get()!.id,
    );
    const pantry = getPantryRecord(pantryId, db)!;
    const sourceId = getPantryScheduleEvidence(pantryId, db)?.sources.find(
      (source) => source.fictional !== true,
    )?.id;
    expect(sourceId).toBeTruthy();
    const window: PantryWindow = {
      id: "verified-monday",
      rule: { kind: "weekly", weekdays: [1] },
      opens: "09:00",
      closes: "12:00",
      appointmentRequired: false,
      policyKnown: true,
      sourceIds: [sourceId!],
    };
    savePantryHours(db, pantryId, [window], []);
    for (const date of ["2026-04-13", "2026-04-20", "2026-04-27"]) {
      for (const [hour, level] of [
        [10, 0],
        [11, 2],
      ]) {
        const slot = new Date(
          `${date}T${String(hour + 5).padStart(2, "0")}:00:00.000Z`,
        ).toISOString();
        db.prepare(
          "INSERT INTO crowd_buckets(pantry_id,slot_start,local_date,weekday,hour,reports,level_sum,wait_sum,wait_count,staff_reports,last_updated) VALUES(?,?,?,?,?,3,?,0,0,0,?)",
        ).run(pantryId, slot, date, 1, hour, level * 3, slot);
      }
    }
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-05-04T14:15:00.000Z"))
        ?.quieterWindow,
    ).toEqual({ weekday: 1, hour: 10 });
    db.prepare("UPDATE crowd_buckets SET level_sum=0 WHERE pantry_id=?").run(
      pantryId,
    );
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-05-04T14:15:00.000Z"))
        ?.quieterWindow,
    ).toBeNull();
  });

  it("suppresses recommendations when today's distribution policy is unknown, conflicting, or closed", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "reach-crowd-uncertain-window-"),
    );
    directories.push(directory);
    const db = openPantryDatabase(join(directory, "community.sqlite"));
    databases.push(db);
    initializeCrowdSchema(db);
    const pantryId = String(
      db.prepare("SELECT id FROM pantries ORDER BY id LIMIT 1").get()!.id,
    );
    const pantry = getPantryRecord(pantryId, db)!;
    const sourceId = getPantryScheduleEvidence(pantryId, db)?.sources.find(
      (source) => source.fictional !== true,
    )?.id!;
    const base: PantryWindow = {
      id: "known",
      rule: { kind: "weekly", weekdays: [1] },
      opens: "09:00",
      closes: "12:00",
      appointmentRequired: false,
      policyKnown: true,
      sourceIds: [sourceId],
    };
    for (const uncertain of [
      { ...base, id: "unknown-policy", policyKnown: false },
      { ...base, id: "source-conflict", conflictingSources: true },
      { ...base, id: "missing-source", sourceIds: ["unverified-source"] },
      { ...base, id: "appointment-required", appointmentRequired: true },
      { ...base, id: "appointment-unknown", appointmentRequired: undefined },
      { ...base, id: "registration-cutoff", registrationCutoff: "11:00" },
      { ...base, id: "distribution-cutoff", distributionCutoff: "11:00" },
    ]) {
      savePantryHours(db, pantryId, [base, uncertain], []);
      expect(
        getCrowdSummary(db, pantryId, new Date("2026-05-04T14:15:00.000Z"))
          ?.quieterWindow,
      ).toBeNull();
    }
    savePantryHours(db, pantryId, [base], ["2026-05-04"]);
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-05-04T14:15:00.000Z"))
        ?.quieterWindow,
    ).toBeNull();
    const current = db
      .prepare("SELECT resource_json FROM pantries WHERE id=?")
      .get(pantryId)!;
    const resource = JSON.parse(String(current.resource_json));
    db.prepare("UPDATE pantries SET resource_json=? WHERE id=?").run(
      JSON.stringify({
        ...resource,
        scheduleNotes: "Except game days, distribution is closed.",
      }),
      pantryId,
    );
    savePantryHours(db, pantryId, [base], []);
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-05-04T14:15:00.000Z"))
        ?.quieterWindow,
    ).toBeNull();
  });

  it("supports a new database pantry only when its current source still backs the window", () => {
    const directory = mkdtempSync(join(tmpdir(), "reach-crowd-new-pantry-"));
    directories.push(directory);
    const db = openPantryDatabase(join(directory, "community.sqlite"));
    databases.push(db);
    initializeCrowdSchema(db);
    db.prepare(
      "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES('fixture-admin','fixture-admin','not-used','salt','resident',1,?)",
    ).run(new Date().toISOString());
    const pantryId = "crowd-new-fixture";
    createPantry(
      db,
      {
        id: pantryId,
        name: "Fixture Pantry",
        address: "Local fixture",
        coordinates: null,
        hours: "Distribution hours verified.",
        eligibility: "Fixture eligibility.",
        notes: "",
        sources: [
          {
            title: "Fixture source",
            url: "https://example.test/pantry",
            checkedOn: "2026-04-01",
          },
        ],
      },
      "fixture-admin",
      null,
      null,
    );
    const window: PantryWindow = {
      id: "current-source",
      rule: { kind: "weekly", weekdays: [1] },
      opens: "09:00",
      closes: "12:00",
      appointmentRequired: false,
      policyKnown: true,
      sourceIds: ["source-0"],
    };
    savePantryHours(db, pantryId, [window], []);
    for (const date of ["2026-04-13", "2026-04-20", "2026-04-27"]) {
      for (const [hour, level] of [
        [10, 0],
        [11, 2],
      ]) {
        const slot = new Date(
          `${date}T${String(hour + 5).padStart(2, "0")}:00:00.000Z`,
        ).toISOString();
        db.prepare(
          "INSERT INTO crowd_buckets(pantry_id,slot_start,local_date,weekday,hour,reports,level_sum,wait_sum,wait_count,staff_reports,last_updated) VALUES(?,?,?,?,?,3,?,0,0,0,?)",
        ).run(pantryId, slot, date, 1, hour, level * 3, slot);
      }
    }
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-05-04T14:15:00.000Z"))
        ?.quieterWindow,
    ).toEqual({ weekday: 1, hour: 10 });
    const row = db
      .prepare("SELECT resource_json FROM pantries WHERE id=?")
      .get(pantryId)!;
    const resource = JSON.parse(String(row.resource_json));
    db.prepare("UPDATE pantries SET resource_json=? WHERE id=?").run(
      JSON.stringify({
        ...resource,
        sources: [
          {
            title: "Replacement source",
            url: "https://example.test/replacement",
            checkedOn: "2026-04-02",
          },
        ],
      }),
      pantryId,
    );
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-05-04T14:15:00.000Z"))
        ?.quieterWindow,
    ).toBeNull();
  });
});
