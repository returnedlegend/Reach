import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeCommunityDatabases } from "../src/lib/community";
import {
  openPantryDatabase,
  listPantryResources,
} from "../src/lib/pantry-store";
import {
  createPublicCorrectionHandler,
  prunePublicCorrections,
} from "../src/lib/public-corrections";
let folder: string, database: string, id: string;
const now = new Date("2026-10-24T12:00Z");
const request = (description: string, origin = "https://reach.example") =>
  new Request("https://reach.example/api/pantries/test/report", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "reach-public-report-"));
  database = join(folder, "app.sqlite");
  vi.stubEnv("REACH_RELEASE_PROFILE", "core");
  vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example");
  id = listPantryResources(openPantryDatabase(database))[0].id;
});
afterEach(() => {
  closeCommunityDatabases();
  rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
describe("anonymous private correction reports", () => {
  it("records a bounded duplicate-safe suggestion without editing facts or requiring identity", async () => {
    const handle = createPublicCorrectionHandler(database, () => now);
    const db = openPantryDatabase(database);
    const before = db
      .prepare("SELECT resource_json FROM pantries WHERE id=?")
      .get(id);
    for (let i = 0; i < 2; i++)
      expect(
        (await handle(request("The pickup entrance needs a source check."), id))
          .status,
      ).toBe(202);
    const rows = db
      .prepare("SELECT submitted_by,status FROM pantry_corrections")
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ submitted_by: null, status: "pending" });
    expect(
      db.prepare("SELECT resource_json FROM pantries WHERE id=?").get(id),
    ).toEqual(before);
  });
  it("rejects cross-site, short and oversized reports and unknown destinations", async () => {
    const handle = createPublicCorrectionHandler(database, () => now);
    expect(
      (
        await handle(
          request("Please check these hours", "https://evil.example"),
          id,
        )
      ).status,
    ).toBe(403);
    expect((await handle(request("short"), id)).status).toBe(400);
    expect((await handle(request("a".repeat(2001)), id)).status).toBe(400);
    expect(
      (await handle(request("Please check these hours"), "missing-id")).status,
    ).toBe(404);
  });
  it("rate limits repeated requests and expires anonymous reports after 90 days", async () => {
    const handle = createPublicCorrectionHandler(database, () => now);
    for (let i = 0; i < 5; i++)
      expect(
        (await handle(request("Please check schedule number " + i), id)).status,
      ).toBe(202);
    expect(
      (await handle(request("Please check schedule number 6"), id)).status,
    ).toBe(429);
    expect(
      prunePublicCorrections(
        openPantryDatabase(database),
        new Date(+now + 91 * 86400000),
      ),
    ).toBe(5);
  });
});
