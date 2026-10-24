import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCommunityDatabases } from "../src/lib/community";
import {
  openPantryDatabase,
  applyMaintainedReview,
  getPantryRecord,
} from "../src/lib/pantry-store";
const folders: string[] = [];
afterEach(() => {
  closeCommunityDatabases();
  for (const p of folders.splice(0))
    rmSync(p, { recursive: true, force: true });
});
describe("dated maintained review migration", () => {
  it("refreshes untouched imported evidence once and records history without inventing access", () => {
    const folder = mkdtempSync(join(tmpdir(), "reach-review-"));
    folders.push(folder);
    const db = openPantryDatabase(join(folder, "app.sqlite"));
    db.prepare("DELETE FROM pantry_migrations WHERE version=2").run();
    const id = "bedias-food-pantry";
    const old = JSON.parse(
      String(
        db.prepare("SELECT resource_json FROM pantries WHERE id=?").get(id)!
          .resource_json,
      ),
    );
    old.sources[0].checkedOn = "2026-10-21";
    old.accessibility = "Old source wording";
    db.prepare("UPDATE pantries SET resource_json=? WHERE id=?").run(
      JSON.stringify(old),
      id,
    );
    expect(applyMaintainedReview(db)).toBe(1);
    expect(getPantryRecord(id, db)).toMatchObject({
      version: 2,
      pedestrianPickup: "unknown",
      verificationStatus: "needs-confirmation",
    });
    expect(
      db
        .prepare(
          "SELECT action FROM pantry_history WHERE pantry_id=? ORDER BY version DESC LIMIT 1",
        )
        .get(id)!.action,
    ).toBe("maintained-review-2026-10-24");
    expect(applyMaintainedReview(db)).toBe(0);
  });
  it("does not overwrite manager-edited or archived records", () => {
    const folder = mkdtempSync(join(tmpdir(), "reach-review-preserve-"));
    folders.push(folder);
    const db = openPantryDatabase(join(folder, "app.sqlite"));
    db.prepare("DELETE FROM pantry_migrations WHERE version=2").run();
    db.prepare(
      "UPDATE pantries SET name='Operator update',version=2 WHERE id='bedias-food-pantry'",
    ).run();
    db.prepare(
      "UPDATE pantries SET active=0 WHERE id='grimes-mobile-pantry'",
    ).run();
    const before = db
      .prepare(
        "SELECT * FROM pantries WHERE id IN ('bedias-food-pantry','grimes-mobile-pantry') ORDER BY id",
      )
      .all();
    expect(applyMaintainedReview(db)).toBe(0);
    expect(
      db
        .prepare(
          "SELECT * FROM pantries WHERE id IN ('bedias-food-pantry','grimes-mobile-pantry') ORDER BY id",
        )
        .all(),
    ).toEqual(before);
  });
});
