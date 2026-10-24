import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { accountHash } from "../src/lib/account-store";
import { openPantryDatabase } from "../src/lib/pantry-store";
import {
  getCrowdSummary,
  initializeCrowdSchema,
  submitCrowdReport,
} from "../src/lib/crowd-store";
import { chicagoParts } from "../src/lib/crowd";
import { POST } from "../src/app/api/crowd/[pantryId]/route";

let directory: string, database: string, pantryId: string;
function reporter() {
  const db = openPantryDatabase(database),
    id = randomUUID(),
    token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at) VALUES(?,?,?,'','resident',1,?,?,?)",
  ).run(
    id,
    id,
    "fixture-no-password-login",
    "2026-01-01T00:00:00.000Z",
    `${id}@example.org`,
    "2026-01-01T00:00:00.000Z",
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    id,
    "2030-01-01T00:00:00.000Z",
  );
  return {
    id,
    request: new Request("https://reach.example/api", {
      headers: { cookie: `reach_community_session=${token}` },
    }),
  };
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-crowd-security-"));
  database = join(directory, "community.sqlite");
  const db = openPantryDatabase(database);
  pantryId = String(
    db.prepare("SELECT id FROM pantries ORDER BY id LIMIT 1").get()!.id,
  );
  initializeCrowdSchema(db);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("independent crowd privacy and evidence checks", () => {
  it("cancels oversized chunked requests without reading the full body", async () => {
    vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example");
    let reads = 0,
      cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++;
          controller.enqueue(new Uint8Array(600));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("https://reach.example/api/crowd/pantry", {
      method: "POST",
      headers: {
        origin: "https://reach.example",
        "content-type": "application/json",
      },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: string });
    const response = await POST(request, {
      params: Promise.resolve({ pantryId: "pantry" }),
    });
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(reads).toBe(2);
  });

  it("does not publish a historical pattern supplied by one recurring person", () => {
    const db = openPantryDatabase(database),
      person = reporter();
    for (const day of [4, 11, 18, 25])
      submitCrowdReport(
        db,
        person.request,
        pantryId,
        { level: 3 },
        new Date(`2026-05-${day.toString().padStart(2, "0")}T14:00:00.000Z`),
      );
    submitCrowdReport(
      db,
      person.request,
      pantryId,
      { level: 3 },
      new Date("2026-06-01T14:00:00.000Z"),
    );
    const summary = getCrowdSummary(
      db,
      pantryId,
      new Date("2026-06-01T14:10:00.000Z"),
    )!;
    expect(summary.days[1].hours[9]).toMatchObject({
      level: null,
      status: "insufficient",
    });
    expect(summary.recent).toBeNull();
  });

  it("does not treat two people spanning local midnight as three recent contributors", () => {
    const db = openPantryDatabase(database),
      first = reporter(),
      second = reporter();
    submitCrowdReport(
      db,
      first.request,
      pantryId,
      { level: 3 },
      new Date("2026-05-04T04:55:00.000Z"),
    );
    submitCrowdReport(
      db,
      first.request,
      pantryId,
      { level: 3 },
      new Date("2026-05-04T05:05:00.000Z"),
    );
    submitCrowdReport(
      db,
      second.request,
      pantryId,
      { level: 3 },
      new Date("2026-05-04T05:06:00.000Z"),
    );
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-05-04T05:07:00.000Z"))!
        .recent,
    ).toBeNull();
  });

  it("averages waiting times only over reports that actually supplied a wait", () => {
    const db = openPantryDatabase(database),
      people = Array.from({ length: 6 }, () => reporter());
    for (const day of [4, 11, 18])
      for (let index = 0; index < (day === 4 ? 6 : 3); index++) {
        const input =
          day === 4
            ? index < 3
              ? { level: 1, waitMinutes: 30 }
              : { level: 1 }
            : { level: 1, waitMinutes: 0 };
        submitCrowdReport(
          db,
          people[index].request,
          pantryId,
          input,
          new Date(`2026-05-${String(day).padStart(2, "0")}T14:00:00.000Z`),
        );
      }
    const summary = getCrowdSummary(
      db,
      pantryId,
      new Date("2026-05-18T14:10:00.000Z"),
    )!;
    expect(summary.days[1].hours[9]).toMatchObject({
      status: "observed",
      level: 1,
      waitMinutes: 10,
    });
  });

  it("deduplicates the repeated fall-back hour and does not keep expired reports current", () => {
    const db = openPantryDatabase(database),
      people = [reporter(), reporter(), reporter()];
    const before = new Date("2026-11-01T06:30:00.000Z"),
      after = new Date("2026-11-01T07:30:00.000Z");
    expect(chicagoParts(before)).toEqual(chicagoParts(after));
    for (const person of people)
      submitCrowdReport(db, person.request, pantryId, { level: 1 }, before);
    expect(() =>
      submitCrowdReport(db, people[0].request, pantryId, { level: 3 }, after),
    ).toThrow(/already reported/);
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-11-01T06:35:00.000Z"))!
        .recent,
    ).not.toBeNull();
    expect(
      getCrowdSummary(db, pantryId, new Date("2026-11-01T07:35:00.000Z"))!
        .recent,
    ).toBeNull();
    expect(
      getCrowdSummary(db, pantryId, new Date("2027-02-01T00:00:00.000Z"))!
        .days.flatMap((day) => day.hours)
        .every((hour) => hour.status === "insufficient"),
    ).toBe(true);
  });

  it("rejects archived pantries and expires short-lived dedup records on later submissions", () => {
    const db = openPantryDatabase(database),
      person = reporter();
    submitCrowdReport(
      db,
      person.request,
      pantryId,
      { level: 2 },
      new Date("2026-05-04T14:00:00.000Z"),
    );
    const first = db.prepare("SELECT * FROM crowd_dedup").get()!;
    expect(JSON.stringify(first)).not.toContain(person.id);
    submitCrowdReport(
      db,
      person.request,
      pantryId,
      { level: 2 },
      new Date("2026-05-07T14:00:00.000Z"),
    );
    expect(
      db
        .prepare("SELECT 1 FROM crowd_dedup WHERE dedupe_hash=?")
        .get(String(first.dedupe_hash)),
    ).toBeUndefined();
    db.prepare("UPDATE pantries SET active=0 WHERE id=?").run(pantryId);
    expect(() =>
      submitCrowdReport(db, reporter().request, pantryId, { level: 1 }),
    ).toThrow(/Pantry not found/);
    expect(getCrowdSummary(db, pantryId)).toBeNull();
  });
});
