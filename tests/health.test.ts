import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { databaseHealth } from "../src/lib/health";
import { closeCommunityDatabases } from "../src/lib/community";
const folders: string[] = [];
afterEach(() => {
  closeCommunityDatabases();
  for (const p of folders.splice(0))
    rmSync(p, { recursive: true, force: true });
});
const path = () => {
  const p = mkdtempSync(join(tmpdir(), "reach-health-"));
  folders.push(p);
  return join(p, "app.sqlite");
};
describe("database readiness", () => {
  it("reports the real initialized database without exposing records or requiring optional providers", async () => {
    const result = databaseHealth(path());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: "ok" });
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  });
  it("reports corrupt storage as unavailable without disclosing paths or database errors", async () => {
    const file = path();
    writeFileSync(file, "invalid SQLite content");
    const result = databaseHealth(file);
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ status: "unavailable" });
  });
});
