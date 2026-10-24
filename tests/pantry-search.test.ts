import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccessHandler } from "../src/lib/access-service";
import { accessJourneyLookup } from "../src/lib/access-routing";
import { openPantryDatabase, savePantryHours } from "../src/lib/pantry-store";
import { closeCommunityDatabases } from "../src/lib/community";
import {
  accessInput,
  FIXED_NOW,
  syntheticCandidate,
  syntheticWindow,
} from "./fixtures/access-scenarios";
import type { AccessCandidate } from "../src/lib/access-engine";
import type { JourneyResult } from "../src/lib/osm-services";
let folder: string, path: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "reach-search-"));
  path = join(folder, "app.sqlite");
  vi.stubEnv("REACH_APP_ORIGIN", "http://localhost");
  vi.stubEnv("REACH_ACCESS_CANDIDATES", "1");
  vi.stubEnv("REACH_COMMUNITY_ENABLED", "false");
  vi.stubEnv("REACH_AI_PROVIDER", "disabled");
});
afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});
function add(candidates: AccessCandidate[]) {
  const db = openPantryDatabase(path);
  db.exec("UPDATE pantries SET active=0");
  for (const c of candidates) {
    db.prepare(
      "INSERT INTO pantries(id,name,address,resource_json,planner_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      c.resource.id,
      c.resource.name,
      c.resource.address,
      JSON.stringify(c.resource),
      JSON.stringify(c.pantry),
      FIXED_NOW.toISOString(),
      FIXED_NOW.toISOString(),
    );
    savePantryHours(db, c.resource.id, c.pantry.windows, []);
  }
}
function handler(seen: number[]) {
  return createAccessHandler(path, {
    now: () => FIXED_NOW,
    routeFactory: (input, opts) =>
      accessJourneyLookup(input, {
        ...opts,
        route: async (request) => {
          seen.push(request.destination.lng);
          return {
            status: "available",
            distanceMiles: 0.5,
            durationMinutes: 10,
            label: "Synthetic test route",
            steps: [],
            paths: [],
            attribution: [],
          } satisfies JourneyResult;
        },
      }),
  });
}
const request = (extra = {}) =>
  new Request("http://localhost/api/access/plan", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ input: accessInput(), ...extra }),
  });
describe("budgeted pantry search uses feasible candidates rather than nearest records", () => {
  it("does not let the nearest closed site consume the sole candidate slot", async () => {
    add([
      syntheticCandidate("closed", {
        coordinates: { lat: 30, lng: -96.001 },
        window: syntheticWindow({
          opens: "06:00",
          closes: "07:00",
          registrationCutoff: "06:45",
        }),
      }),
      syntheticCandidate("open", { coordinates: { lat: 30, lng: -96.02 } }),
    ]);
    const seen: number[] = [];
    const r = await handler(seen)(request());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(seen).toEqual([-96.02]);
    expect(body.recommendation.selectedId).toBe("open");
    expect(body.recommendation.comparison.staticallyExcludedPantries).toBe(1);
  });
  it("reports the unexamined site when the actual candidate budget is exhausted", async () => {
    add([
      syntheticCandidate("a"),
      syntheticCandidate("b", { coordinates: { lat: 30, lng: -96.02 } }),
    ]);
    const seen: number[] = [];
    const r = await handler(seen)(request());
    const body = await r.json();
    expect(seen).toHaveLength(1);
    expect(body.recommendation.comparison.complete).toBe(false);
    expect(body.recommendation.comparison.routeLimitReached).toBe(true);
    expect(body.recommendation.comparison.unresolvedPantries).toBe(1);
  });
  it("uses candidate identity rather than an origin matching some other verified stop to permit routing", async () => {
    add([
      syntheticCandidate("verified-closed", {
        coordinates: accessInput().origin,
        window: syntheticWindow({
          opens: "06:00",
          closes: "07:00",
          registrationCutoff: "06:45",
        }),
      }),
      syntheticCandidate("unverified", {
        verificationStatus: "needs-confirmation",
      }),
    ]);
    const seen: number[] = [];
    const r = await handler(seen)(request());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(seen).toEqual([]);
    expect(
      body.options.find((o: { id: string }) => o.id === "unverified").outbound,
    ).toBeNull();
    expect(body.recommendation.selectedId).toBeNull();
  });
  it("honors explicit destination checks without recommending unverified locations", async () => {
    add([
      syntheticCandidate("unverified", {
        verificationStatus: "needs-confirmation",
      }),
    ]);
    const seen: number[] = [];
    const r = await handler(seen)(request({ destinationId: "unverified" }));
    const body = await r.json();
    expect(seen).toHaveLength(1);
    expect(body.recommendation.selectedId).toBeNull();
    expect(body.recommendation.comparison.scope).toBe("selected-destination");
  });
  it("fails closed on invalid candidate-limit configuration", async () => {
    add([syntheticCandidate("a")]);
    vi.stubEnv("REACH_ACCESS_CANDIDATES", "25");
    const seen: number[] = [];
    const r = await handler(seen)(request());
    expect(r.status).toBe(503);
    expect(seen).toEqual([]);
  });
});
