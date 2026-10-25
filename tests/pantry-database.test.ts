import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { foodResources } from "../src/data/resources";
import { realPantries } from "../src/data/real-pantries";
import { summarizeResource } from "../src/lib/resource-summary";
import { planVisits } from "../src/lib/planner";
import { demoData, demoDefaults } from "../src/data/demo";
import type { Pantry } from "../src/lib/types";
import { createPantryHandler } from "../src/lib/pantry-api";
import {
  getPantryRecord,
  getPantryScheduleEvidence,
  getPantryInventory,
  importPantries,
  listPantryResources,
  listPlannerPantries,
  openPantryDatabase,
} from "../src/lib/pantry-store";
let dir: string,
  db: DatabaseSync,
  handle: ReturnType<typeof createPantryHandler>;
let admin: string,
  user: string,
  manager: string,
  moderator: string,
  unverified: string;
const first = foodResources[0].id,
  second = foodResources[1].id;
function seed(
  id: string,
  role = "user",
  verified = true,
  legacyRole = "resident",
) {
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,name,pantry_role) VALUES(?,?,?,?,?,1,?,?,?,?,?)",
  ).run(
    id,
    id,
    "hash",
    "salt",
    legacyRole,
    new Date().toISOString(),
    `${id}@example.com`,
    verified ? new Date().toISOString() : null,
    id,
    role,
  );
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    createHash("sha256").update(token).digest("hex"),
    id,
    new Date(Date.now() + 3600000).toISOString(),
  );
  return `reach_community_session=${token}`;
}
async function call(
  path = "",
  method = "GET",
  data?: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) {
  return handle(
    new Request(`http://localhost/api/pantries/${path}`, {
      method,
      headers: {
        ...(method !== "GET"
          ? { "content-type": "application/json", origin: "http://localhost" }
          : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(method !== "GET" ? { body: JSON.stringify(data ?? {}) } : {}),
    }),
    path.split("?")[0].split("/").filter(Boolean),
  );
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reach-pantries-"));
  const path = join(dir, "test.sqlite");
  db = openPantryDatabase(path);
  handle = createPantryHandler(path);
  admin = seed("admin", "administrator");
  user = seed("user");
  manager = seed("manager");
  moderator = seed("moderator", "user", true, "moderator");
  unverified = seed("unverified", "user", false);
});
afterEach(() => {
  vi.unstubAllEnvs();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("persistent pantry database", () => {
  it("imports 53 records idempotently, retaining source dates, planner metadata and unknown inventory", () => {
    expect(listPantryResources(db)).toHaveLength(53);
    expect(importPantries(db)).toBe(0);
    for (const source of foodResources) {
      const p = getPantryRecord(source.id, db)!;
      expect(p.sources).toEqual(source.sources);
      expect(p.city).toBe(source.city);
      expect(p.postalCode).toBe(source.postalCode);
      expect(p.website).toBe(source.website ?? null);
      expect(p.hours).toBe(source.hours);
      expect(p.lastVerified).toBe(
        source.sources
          .map((s) => s.checkedOn)
          .filter(Boolean)
          .sort()
          .at(-1),
      );
      expect(getPantryInventory(source.id, db)).toEqual([]);
    }
    const planner = listPlannerPantries(db).find((p) => p.id === first)!;
    const original = realPantries.find((p) => p.id === first)!;
    expect(planner.documents).toEqual(original.documents);
    expect(planner.windows).toEqual(original.windows);
    expect(db.prepare("SELECT count(*) n FROM pantry_history").get()!.n).toBe(
      53,
    );
    expect(db.prepare("SELECT version FROM pantry_migrations").all()).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
  });
  it("creates and edits through strict validated administrator API and rejects stale versions", async () => {
    const response = await call(
      "",
      "POST",
      { name: "New pantry", address: "12 Main St" },
      admin,
    );
    expect(response.status).toBe(201);
    const p = (await response.json()).pantry;
    expect(p.coordinates).toBeNull();
    expect(p.windows).toEqual([]);
    expect(p.hours).toContain("not verified");
    expect(
      (
        await call(
          p.id,
          "PATCH",
          { version: 1, name: "Updated", coordinates: { lat: 91, lng: 0 } },
          admin,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          p.id,
          "PATCH",
          { version: 1, website: "javascript:alert(1)" },
          admin,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call(p.id, "PATCH", { version: 1, role: "administrator" }, admin))
        .status,
    ).toBe(400);
    expect(
      (await call(p.id, "PATCH", { version: 1, name: "Updated" }, admin))
        .status,
    ).toBe(200);
    expect(
      (await call(p.id, "PATCH", { version: 1, name: "Stale" }, admin)).status,
    ).toBe(409);
    expect(getPantryRecord(p.id, db)!.name).toBe("Updated");
    expect(
      db
        .prepare("SELECT count(*) n FROM pantry_history WHERE pantry_id=?")
        .get(p.id)!.n,
    ).toBe(2);
  });
  it("isolates assigned managers across pantries and never elevates community moderators", async () => {
    expect(
      (
        await call(
          "assignments",
          "POST",
          { pantryId: first, email: "manager@example.com", assign: true },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          first,
          "PATCH",
          { version: 1, name: "Managed pantry" },
          manager,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          second,
          "PATCH",
          { version: 1, name: "Unauthorized" },
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(second, "PATCH", { version: 1, name: "Unauthorized" }, user))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          second,
          "PATCH",
          { version: 1, name: "Unauthorized" },
          moderator,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          first + "/archive",
          "POST",
          { confirmation: "Managed pantry" },
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "assignments",
          "POST",
          { pantryId: second, email: "manager@example.com", assign: true },
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "assignments",
          "POST",
          { pantryId: second, email: "unverified@example.com", assign: true },
          admin,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await (await call("management", "GET", undefined, manager)).json()
      ).pantries.map((p: { id: string }) => p.id),
    ).toEqual([first]);
  });
  it("archives with confirmation, removes public planner/map entries, retains edits across reimport and restores history", async () => {
    expect(
      (await call(first, "PATCH", { version: 1, name: "Edited pantry" }, admin))
        .status,
    ).toBe(200);
    expect(
      (await call(first + "/archive", "POST", { confirmation: "wrong" }, admin))
        .status,
    ).toBe(400);
    expect(
      (
        await call(
          first + "/archive",
          "POST",
          { confirmation: "Edited pantry" },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(listPantryResources(db).map((p) => p.id)).not.toContain(first);
    expect(listPlannerPantries(db).map((p) => p.id)).not.toContain(first);
    expect((await call(first)).status).toBe(404);
    expect(importPantries(db)).toBe(0);
    expect(getPantryRecord(first, db)!.active).toBe(false);
    expect(getPantryRecord(first, db)!.name).toBe("Edited pantry");
    expect(
      (
        await call(
          first + "/restore",
          "POST",
          { confirmation: "Edited pantry" },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(getPantryRecord(first, db)!.version).toBe(4);
    expect(listPantryResources(db)).toHaveLength(53);
    expect(
      db
        .prepare(
          "SELECT action FROM pantry_history WHERE pantry_id=? ORDER BY version",
        )
        .all(first)
        .map((r) => r.action),
    ).toEqual(["import", "update", "archive", "restore"]);
  });
  it("requires reviewed corrections to apply a transactionally audited explicit change", async () => {
    const response = await call(
      first + "/corrections",
      "POST",
      { description: "Address needs review" },
      user,
    );
    expect(response.status).toBe(201);
    const c = await response.json();
    expect(
      (
        await call(
          `corrections/${c.id}/review`,
          "POST",
          {
            decision: "approve",
            notes: "Reviewed",
            changes: { version: 1, address: "Reviewed address" },
          },
          user,
        )
      ).status,
    ).toBe(403);
    expect(getPantryRecord(first, db)!.address).toBe(foodResources[0].address);
    expect(
      (
        await call(
          `corrections/${c.id}/review`,
          "POST",
          { decision: "approve", notes: "Reviewed" },
          admin,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          `corrections/${c.id}/review`,
          "POST",
          {
            decision: "approve",
            notes: "Provider confirmed",
            changes: { version: 1, address: "Reviewed address" },
          },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(getPantryRecord(first, db)!.address).toBe("Reviewed address");
    expect(
      db.prepare("SELECT status FROM pantry_corrections WHERE id=?").get(c.id)!
        .status,
    ).toBe("approved");
    expect(
      (
        await call(
          `corrections/${c.id}/review`,
          "POST",
          { decision: "reject", notes: "Again" },
          admin,
        )
      ).status,
    ).toBe(409);
  });
  it("saves real hours, closures and inventory while server stamping updates and retaining history", async () => {
    const windows = [
      {
        id: "monday",
        rule: { kind: "weekly", weekdays: [1] },
        opens: "09:00",
        closes: "11:00",
        policyKnown: false,
        sourceIds: [],
      },
    ];
    expect(
      (
        await call(
          first + "/hours",
          "PUT",
          { windows, closures: ["2026-12-25"], version: 1 },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(
      listPlannerPantries(db).find((p) => p.id === first)!.windows,
    ).toEqual(windows);
    expect(getPantryRecord(first, db)!.hours).toContain("09:00");
    const item = {
      category: "Produce",
      status: "limited",
      quantity: null,
      source: "Pantry staff",
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    expect(
      (
        await call(
          first + "/inventory",
          "PUT",
          { items: [item], version: 2 },
          admin,
        )
      ).status,
    ).toBe(200);
    const saved = getPantryInventory(first, db)[0];
    expect(saved.updatedAt).not.toBe(item.updatedAt);
    expect(saved.quantity).toBeNull();
    expect(getPantryRecord(first, db)!.version).toBe(3);
    const history = db
      .prepare(
        "SELECT snapshot_json FROM pantry_history WHERE pantry_id=? AND version=3",
      )
      .get(first)!;
    expect(
      JSON.parse(String(history.snapshot_json)).inventory[0].category,
    ).toBe("Produce");
  });
  it("permits favorites before verification, protects them by owner and excludes archives", async () => {
    expect(
      (await call("favorites", "POST", { id: first }, unverified)).status,
    ).toBe(200);
    expect(
      (await (await call("favorites", "GET", undefined, user)).json())
        .favorites,
    ).toEqual([]);
    expect(
      (
        await call(
          first + "/corrections",
          "POST",
          { description: "Change" },
          unverified,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("favorites", "POST", { id: first }, undefined)).status,
    ).toBe(401);
    expect(
      (
        await call(
          first + "/archive",
          "POST",
          { confirmation: foodResources[0].name },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(
      (await (await call("favorites", "GET", undefined, unverified)).json())
        .favorites,
    ).toEqual([]);
    db.prepare("DELETE FROM sessions WHERE user_id='unverified'").run();
    db.prepare("DELETE FROM users WHERE id='unverified'").run();
    expect(db.prepare("SELECT count(*) n FROM pantry_favorites").get()!.n).toBe(
      0,
    );
  });
  it("rejects cross-origin and oversized mutation requests", async () => {
    expect(
      (
        await call(first, "PATCH", { version: 1, name: "No" }, admin, {
          origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          first,
          "PATCH",
          { version: 1, name: "x".repeat(70000) },
          admin,
        )
      ).status,
    ).toBe(413);
  });
  it("rechecks ownership after streamed input and denies a revoked manager", async () => {
    db.prepare("INSERT INTO pantry_managers VALUES(?,?,?,?)").run(
      first,
      "manager",
      "admin",
      new Date().toISOString(),
    );
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const request = new Request(`http://localhost/api/pantries/${first}`, {
      method: "PATCH",
      headers: {
        cookie: manager,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: string });
    const response = handle(request, [first]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    db.prepare(
      "DELETE FROM pantry_managers WHERE pantry_id=? AND user_id=?",
    ).run(first, "manager");
    controller!.enqueue(
      new TextEncoder().encode(
        JSON.stringify({ version: 1, name: "Revoked edit" }),
      ),
    );
    controller!.close();
    expect((await response).status).toBe(403);
    expect(getPantryRecord(first, db)!.name).toBe(foodResources[0].name);
  });
  it("rolls back a stale correction approval without marking the suggestion reviewed", async () => {
    const c = await (
      await call(
        first + "/corrections",
        "POST",
        { description: "Provider address correction" },
        user,
      )
    ).json();
    await call(first, "PATCH", { version: 1, name: "Newer change" }, admin);
    const response = await call(
      `corrections/${c.id}/review`,
      "POST",
      {
        decision: "approve",
        notes: "Stale review",
        changes: { version: 1, address: "Stale address" },
      },
      admin,
    );
    expect(response.status).toBe(409);
    expect(
      db.prepare("SELECT status FROM pantry_corrections WHERE id=?").get(c.id)!
        .status,
    ).toBe("pending");
    expect(
      db
        .prepare("SELECT count(*) n FROM pantry_history WHERE pantry_id=?")
        .get(first)!.n,
    ).toBe(2);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("refreshes public schedule summaries and planner policies from current hours and closures", async () => {
    const id = "first-united-methodist";
    // Synthetic reviewed route is only a test fixture; production links remain untouched.
    const original = JSON.parse(
      String(
        db.prepare("SELECT planner_json FROM pantries WHERE id=?").get(id)!
          .planner_json,
      ),
    ) as Pantry;
    original.directWalks = [
      {
        originId: demoDefaults.originId,
        minutes: 5,
        miles: 0.2,
        reviewed: true,
      },
    ];
    db.prepare(
      "UPDATE pantries SET planner_json=?,resource_json=json_remove(resource_json,'$.scheduleNotes') WHERE id=?",
    ).run(JSON.stringify(original), id);
    expect(getPantryRecord(id, db)!.scheduleNotes).toContain("game");
    const windows = [
      {
        id: "current-monday",
        rule: { kind: "weekly", weekdays: [1] },
        opens: "09:00",
        closes: "11:00",
        policyKnown: true,
        appointmentRequired: true,
        sourceIds: original.windows[0].sourceIds,
      },
    ];
    expect(
      (
        await call(
          id + "/hours",
          "PUT",
          { windows, closures: [], version: 1 },
          admin,
        )
      ).status,
    ).toBe(200);
    let resource = listPantryResources(db).find((p) => p.id === id)!;
    expect(
      summarizeResource(resource, new Date("2026-10-19T14:30:00Z"))
        .availabilityLabel,
    ).toBe("Published distribution window");
    expect(resource.scheduleNotes).not.toMatch(/except game days|game-day/);
    const input = {
      ...demoDefaults,
      date: "2026-10-19",
      mode: "walk" as const,
      earliestDeparture: "09:00",
      latestReturn: "12:00",
      appointmentStatus: "not-booked" as const,
    };
    const plan = () =>
      planVisits(input, {
        ...demoData,
        pantries: listPlannerPantries(db).filter((p) => p.id === id),
      })[0];
    expect(plan().reasons).toContain(
      "An appointment is required and has not been booked.",
    );
    const changed = windows.map((w) => ({
      ...w,
      appointmentRequired: false,
      policyKnown: false,
    }));
    expect(
      (
        await call(
          id + "/hours",
          "PUT",
          { windows: changed, closures: [], version: 2 },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(plan().reasons).toContain(
      "Pickup or eligibility policy needs confirmation.",
    );
    resource = listPantryResources(db).find((p) => p.id === id)!;
    expect(
      summarizeResource(resource, new Date("2026-10-19T14:30:00Z"))
        .availabilityLabel,
    ).toBe("Check before visiting");
    expect(
      (
        await call(
          id + "/hours",
          "PUT",
          {
            windows: windows.map((w) => ({ ...w, appointmentRequired: false })),
            closures: ["2026-10-19"],
            version: 3,
          },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(plan().reasons).toEqual(["Pantry is closed on this date."]);
    expect(
      (
        await call(
          id + "/archive",
          "POST",
          { confirmation: original.name },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(listPantryResources(db).some((p) => p.id === id)).toBe(false);
    expect(plan()).toBeUndefined();
  });
  it("honors current note uncertainty and clears structured hours after a freeform schedule change", async () => {
    const windows = [
      {
        id: "current-monday",
        rule: { kind: "weekly", weekdays: [1] },
        opens: "09:00",
        closes: "11:00",
        policyKnown: true,
        sourceIds: [],
      },
    ];
    expect(
      (
        await call(
          first + "/hours",
          "PUT",
          { windows, closures: ["2026-12-25"], version: 1 },
          admin,
        )
      ).status,
    ).toBe(200);
    const now = new Date("2026-10-19T14:30:00Z");
    expect(
      summarizeResource(getPantryRecord(first, db)!, now).availabilityLabel,
    ).toBe("Published distribution window");
    expect(
      (
        await call(
          first,
          "PATCH",
          {
            notes: "Provider may close on game-day weekends. Confirm the date.",
            version: 2,
          },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(
      summarizeResource(getPantryRecord(first, db)!, now).availabilityLabel,
    ).toBe("Check before visiting");
    expect(
      (
        await call(
          first,
          "PATCH",
          {
            hours: "New hours are being confirmed; call before visiting.",
            version: 3,
          },
          admin,
        )
      ).status,
    ).toBe(200);
    const current = getPantryRecord(first, db)!;
    expect(current.windows).toEqual([]);
    expect(current.closures).toEqual(["2026-12-25"]);
    expect(current.hours).toContain("New hours");
    const planner = listPlannerPantries(db).find((p) => p.id === first)!;
    expect(planner.windows).toEqual([]);
    const result = planVisits(
      { ...demoDefaults, mode: "walk", date: "2026-10-19" },
      { ...demoData, pantries: [planner] },
    )[0];
    expect(result.reasons).toEqual([
      "Pantry hours are missing. Confirm before traveling.",
    ]);
  });
  it("quarantines original walking links after a coordinate or address move while preserving source snapshots", async () => {
    const original = JSON.parse(
      String(
        db.prepare("SELECT planner_json FROM pantries WHERE id=?").get(first)!
          .planner_json,
      ),
    ) as Pantry;
    original.directWalks = [
      {
        originId: demoDefaults.originId,
        minutes: 5,
        miles: 0.2,
        reviewed: true,
      },
    ];
    original.walkConnections = [
      { stopId: "reviewed-stop", minutes: 3, miles: 0.1, reviewed: true },
    ];
    db.prepare("UPDATE pantries SET planner_json=? WHERE id=?").run(
      JSON.stringify(original),
      first,
    );
    const current = () => listPlannerPantries(db).find((p) => p.id === first)!;
    expect(current().directWalks).toEqual(original.directWalks);
    expect(
      (
        await call(
          first,
          "PATCH",
          { name: "Updated pantry name", version: 1 },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(current().walkConnections).toEqual(original.walkConnections);
    const coordinates = getPantryRecord(first, db)!.coordinates!;
    const moved = { lat: coordinates.lat + 0.01, lng: coordinates.lng };
    expect(
      (await call(first, "PATCH", { coordinates: moved, version: 2 }, admin))
        .status,
    ).toBe(200);
    expect(current().coordinates).toEqual({ lat: moved.lat, lon: moved.lng });
    expect(current().directWalks).toEqual([]);
    expect(current().walkConnections).toEqual([]);
    expect(
      JSON.parse(
        String(
          db.prepare("SELECT planner_json FROM pantries WHERE id=?").get(first)!
            .planner_json,
        ),
      ).directWalks,
    ).toEqual(original.directWalks);
    expect(
      (await call(first, "PATCH", { coordinates, version: 3 }, admin)).status,
    ).toBe(200);
    expect(current().directWalks).toEqual(original.directWalks);
    expect(
      (
        await call(
          first,
          "PATCH",
          { address: "New pickup address", version: 4 },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(current().address).toBe("New pickup address");
    expect(current().directWalks).toEqual([]);
    expect(current().walkConnections).toEqual([]);
    expect(current().missingInformation).toContain(
      "Pickup location changed; previous walking routes require a new review.",
    );
  });
  it("uses current schedule sources while retaining the immutable original attribution snapshot", async () => {
    const original = JSON.parse(
      String(
        db.prepare("SELECT planner_json FROM pantries WHERE id=?").get(first)!
          .planner_json,
      ),
    ) as Pantry;
    const evidence = getPantryScheduleEvidence(first, db)!;
    expect(evidence.windows).toEqual(getPantryRecord(first, db)!.windows);
    expect(evidence.sources.map((s) => s.id)).toContain(
      original.windows[0].sourceIds[0],
    );
    expect(
      (await call(first, "PATCH", { sources: [], version: 1 }, admin)).status,
    ).toBe(200);
    expect(getPantryScheduleEvidence(first, db)!.sources).toEqual([]);
    expect(
      listPlannerPantries(db).find((p) => p.id === first)!.sources,
    ).toEqual([]);
    expect(
      JSON.parse(
        String(
          db.prepare("SELECT planner_json FROM pantries WHERE id=?").get(first)!
            .planner_json,
        ),
      ).sources,
    ).toEqual(original.sources);
    expect(
      (
        await call(
          first + "/archive",
          "POST",
          { confirmation: foodResources[0].name },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(getPantryScheduleEvidence(first, db)).toBeNull();
  });
  it("uses the configured public origin behind a proxy and fails closed for invalid production origin", async () => {
    // This case exercises intentionally enabled account management, not the default core release.
    vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
    vi.stubEnv("REACH_RELEASE_ACCOUNTS", "true");
    const request = (origin: string) =>
      new Request("http://0.0.0.0:3000/api/pantries/favorites", {
        method: "POST",
        headers: {
          cookie: user,
          origin,
          "content-type": "application/json",
          host: "internal-service:3000",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "http",
        },
        body: JSON.stringify({ id: first }),
      });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example");
    expect(
      (await handle(request("https://reach.example"), ["favorites"])).status,
    ).toBe(200);
    expect(
      (await handle(request("https://attacker.example"), ["favorites"])).status,
    ).toBe(403);
    vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example/invalid-path");
    expect(
      (await handle(request("https://reach.example"), ["favorites"])).status,
    ).toBe(503);
    vi.stubEnv("REACH_APP_ORIGIN", undefined);
    vi.stubEnv("REACH_COMMUNITY_ORIGIN", undefined);
    expect(
      (await handle(request("http://0.0.0.0:3000"), ["favorites"])).status,
    ).toBe(503);
  });
  it("uses only a validated direct loopback host for unconfigured local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REACH_APP_ORIGIN", undefined);
    vi.stubEnv("REACH_COMMUNITY_ORIGIN", undefined);
    const request = (host: string, origin: string) =>
      new Request("http://0.0.0.0:3000/api/pantries/favorites", {
        method: "POST",
        headers: {
          cookie: user,
          origin,
          host,
          "content-type": "application/json",
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ id: first }),
      });
    expect(
      (
        await handle(request("localhost:3000", "http://localhost:3000"), [
          "favorites",
        ])
      ).status,
    ).toBe(200);
    expect(
      (
        await handle(request("attacker.example", "http://attacker.example"), [
          "favorites",
        ])
      ).status,
    ).toBe(503);
  });
  it("keeps computed schedule source identities stable across reordering and invalidates replaced evidence", async () => {
    const original = getPantryRecord(first, db)!;
    const originalIds = original.scheduleSources.map((source) => source.id);
    const added = {
      title: "Provider schedule update",
      url: "https://provider.example/current-hours",
      checkedOn: "2026-10-20",
    };
    expect(
      (
        await call(
          first,
          "PATCH",
          { sources: [...original.sources, added], version: 1 },
          admin,
        )
      ).status,
    ).toBe(200);
    let current = getPantryRecord(first, db)!;
    const addedId = current.scheduleSources.find(
      (source) => source.url === added.url,
    )!.id;
    expect(addedId).toMatch(/^current-[a-f0-9]{64}$/);
    for (const id of originalIds)
      expect(current.scheduleSources.map((source) => source.id)).toContain(id);
    const windows = [
      {
        id: "updated-monday",
        rule: { kind: "weekly", weekdays: [1] },
        opens: "09:00",
        closes: "11:00",
        policyKnown: true,
        sourceIds: [addedId],
      },
    ];
    expect(
      (
        await call(
          first + "/hours",
          "PUT",
          { windows, closures: [], version: 2 },
          admin,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          first,
          "PATCH",
          { sources: [added, ...original.sources], version: 3 },
          admin,
        )
      ).status,
    ).toBe(200);
    current = getPantryRecord(first, db)!;
    expect(
      current.scheduleSources.find((source) => source.url === added.url)!.id,
    ).toBe(addedId);
    const replacement = {
      title: "Different provider evidence",
      url: "https://provider.example/different-source",
      checkedOn: "2026-10-20",
    };
    expect(
      (
        await call(
          first,
          "PATCH",
          { sources: [replacement, ...original.sources], version: 4 },
          admin,
        )
      ).status,
    ).toBe(200);
    const detail = await (await call(first)).json();
    expect(
      detail.pantry.scheduleSources.map((source: { id: string }) => source.id),
    ).not.toContain(addedId);
    expect(detail.pantry.windows[0].sourceIds).toEqual([addedId]);
    expect(
      getPantryScheduleEvidence(first, db)!.sources.map((source) => source.id),
    ).not.toContain(addedId);
    expect(
      listPlannerPantries(db)
        .find((p) => p.id === first)!
        .sources.map((source) => source.id),
    ).not.toContain(addedId);
    const stored = JSON.parse(
      String(
        db.prepare("SELECT resource_json FROM pantries WHERE id=?").get(first)!
          .resource_json,
      ),
    );
    expect(stored).not.toHaveProperty("scheduleSources");
    for (const row of db
      .prepare("SELECT snapshot_json FROM pantry_history WHERE pantry_id=?")
      .all(first)) {
      expect(JSON.parse(String(row.snapshot_json)).pantry).not.toHaveProperty(
        "scheduleSources",
      );
    }
  });
});
