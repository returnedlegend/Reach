import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPantryDatabase } from "../src/lib/pantry-store";
import { closeCommunityDatabases } from "../src/lib/community";
import { accountHash } from "../src/lib/account-store";
import { publicDirectory } from "../src/lib/public-directory";
import { rankFoodWithAI } from "../src/lib/food-ai-ranking";
let dir: string;
afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
it("filters blocked owners from page resources and AI candidates without hiding ordinary pantries", async () => {
  dir = mkdtempSync(join(tmpdir(), "reach-directory-block-"));
  vi.stubEnv("REACH_COMMUNITY_DB", join(dir, "data.sqlite"));
  vi.stubEnv("REACH_COMMUNITY_ENABLED", "true");
  vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
  const db = openPantryDatabase(),
    now = new Date();
  const user = db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?, 'fixture','fixture','resident',1,?)",
  );
  user.run("reader", "reader", now.toISOString());
  user.run("owner", "owner", now.toISOString());
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash("a".repeat(64)),
    "reader",
    "2099-01-01T00:00:00.000Z",
  );
  const times = {
    startsAt: new Date(+now - 60000).toISOString(),
    endsAt: new Date(+now + 3600000).toISOString(),
  };
  const common = {
    ...times,
    title: "Blocked household groceries",
    description: "Fixture",
  };
  const offer = {
    ...common,
    pickupAreaId: "bryan",
    quantity: 2,
    allergens: "Wheat",
    storage: "Dry",
    useBy: new Date(+now + 86400000).toISOString().slice(0, 10),
    foodCategory: "dry-groceries",
    labelsIntact: true,
    noExcludedProducts: true,
    sealed: true,
    shelfStable: true,
    notHomemade: true,
    packagingUndamaged: true,
    notRecalled: true,
    privatePickupInstructions: "PRIVATE_SENTINEL",
    pickupIsPublicPlace: true,
    sharePickupInstructions: true,
  };
  const hotspot = {
    ...common,
    title: "Blocked hotspot groceries",
    organizerName: "Fixture",
    address: "Fixture, Bryan, TX",
    lat: 30.67,
    lng: -96.37,
    foodCategory: "Groceries",
    eligibility: "Unknown",
    accessibility: "Unknown",
    contact: "Fixture",
    pickupInstructions: "Check first",
  };
  const insert = db.prepare(
    "INSERT INTO records VALUES(?,?,'owner','approved',?,?,?,?,?,NULL)",
  );
  for (const [id, kind, data] of [
    ["offer", "offer", offer],
    ["hotspot", "hotspot", hotspot],
  ] as const)
    insert.run(
      id,
      kind,
      JSON.stringify(data),
      times.startsAt,
      times.endsAt,
      now.toISOString(),
      now.toISOString(),
    );
  expect(
    publicDirectory().resources.filter(
      (r) => r.communityOffer || r.communityHotspot,
    ),
  ).toHaveLength(2);
  db.prepare("INSERT INTO blocks VALUES('reader','owner',?)").run(
    now.toISOString(),
  );
  const cookie = "reach_community_session=" + "a".repeat(64);
  const directory = publicDirectory(cookie);
  expect(directory.error).toBe("");
  expect(directory.resources.length).toBeGreaterThan(0);
  expect(
    directory.resources.some((r) => r.communityOffer || r.communityHotspot),
  ).toBe(false);
  const generate = vi
    .fn()
    .mockResolvedValue({ status: "unavailable", reason: "Fixture", calls: 0 });
  await rankFoodWithAI("food in Bryan", {
    cookieHeader: cookie,
    now,
    generate,
  });
  expect(generate).toHaveBeenCalledOnce();
  expect(generate.mock.calls[0][0].prompt).not.toMatch(
    /Blocked household|Blocked hotspot|PRIVATE_SENTINEL|fixture-session/,
  );
  db.prepare("DELETE FROM blocks").run();
  db.prepare("INSERT INTO blocks VALUES('owner','reader',?)").run(
    now.toISOString(),
  );
  expect(
    publicDirectory(cookie).resources.some(
      (r) => r.communityOffer || r.communityHotspot,
    ),
  ).toBe(false);
  vi.stubEnv("REACH_COMMUNITY_ENABLED", "false");
  expect(
    publicDirectory().resources.some(
      (r) => r.communityOffer || r.communityHotspot,
    ),
  ).toBe(false);
});
