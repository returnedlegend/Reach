import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeCommunityDatabases,
  createModerator,
  openCommunityDatabase,
  setSoleModerator,
} from "../src/lib/community";
let folder: string, path: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "reach-sole-mod-"));
  path = join(folder, "community.sqlite");
});
afterEach(() => {
  closeCommunityDatabases();
  rmSync(folder, { recursive: true, force: true });
});
describe("trusted sole moderator assignment", () => {
  it("requires an existing verified identity and leaves roles intact on failure", () => {
    createModerator("existing", "long-fixture-password", path);
    const db = openCommunityDatabase(path);
    expect(() => setSoleModerator("missing@example.test", path)).toThrow(
      /verify it first/,
    );
    db.prepare("UPDATE users SET email=?").run("unverified@example.test");
    expect(() => setSoleModerator("unverified@example.test", path)).toThrow(
      /verify it first/,
    );
    expect(db.prepare("SELECT role FROM users").get()?.role).toBe("moderator");
    expect(() => setSoleModerator("invalid", path)).toThrow();
  });
  it("promotes only the verified target, demotes others and revokes their sessions without deleting posts", () => {
    createModerator("target", "long-fixture-password", path);
    createModerator("other", "long-fixture-password", path);
    const db = openCommunityDatabase(path);
    db.prepare(
      "UPDATE users SET role='resident',email=?,email_verified_at=? WHERE username='target'",
    ).run("owner@example.test", new Date().toISOString());
    const other = String(
      db.prepare("SELECT id FROM users WHERE username='other'").get()!.id,
    );
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      "fixture-token-hash",
      other,
      "2099-01-01T00:00:00.000Z",
    );
    db.prepare(
      "INSERT INTO records VALUES('fixture','hotspot',?,'draft','{}',?,?,?, ?,NULL)",
    ).run(other, "2099-01-01", "2099-01-02", "2026-01-01", "2026-01-01");
    expect(setSoleModerator(" OWNER@example.test ", path)).toEqual({
      revoked: 1,
    });
    expect(
      db.prepare("SELECT username FROM users WHERE role='moderator'").all(),
    ).toEqual([{ username: "target" }]);
    expect(
      db.prepare("SELECT role FROM users WHERE id=?").get(other)?.role,
    ).toBe("resident");
    expect(
      db
        .prepare("SELECT count(*) AS n FROM sessions WHERE user_id=?")
        .get(other)?.n,
    ).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM records").get()?.n).toBe(1);
    expect(setSoleModerator("owner@example.test", path)).toEqual({
      revoked: 0,
    });
  });
});
