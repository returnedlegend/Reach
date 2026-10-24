import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeCommunityDatabases,
  openCommunityDatabase,
} from "../src/lib/community";

const directories: string[] = [];
function isolatedPath() {
  const directory = mkdtempSync(join(tmpdir(), "reach-database-lifecycle-"));
  directories.push(directory);
  return join(directory, "app.sqlite");
}
afterEach(() => {
  closeCommunityDatabases();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("SQLite connection lifecycle", () => {
  it("reuses open connections and reopens a caller-closed native handle", () => {
    const path = isolatedPath();
    const original = openCommunityDatabase(path);
    expect(openCommunityDatabase(path)).toBe(original);
    original.close();
    const reopened = openCommunityDatabase(path);
    expect(reopened === original).toBe(false);
    expect(reopened.isOpen).toBe(true);
    expect(
      reopened.prepare("SELECT count(*) AS count FROM users").get()?.count,
    ).toBe(0);
  });

  it("releases every cached handle so isolated SQLite files can be removed", () => {
    const paths = [isolatedPath(), isolatedPath()];
    const handles = paths.map((path) => openCommunityDatabase(path));
    closeCommunityDatabases();
    closeCommunityDatabases(); // Shutdown is safe to repeat.
    expect(handles.every((handle) => !handle.isOpen)).toBe(true);
    for (const path of paths) {
      rmSync(path);
      expect(existsSync(path)).toBe(false);
    }
  });
});
