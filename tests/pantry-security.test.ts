import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createPantryHandler } from "../src/lib/pantry-api";
import { accountHash } from "../src/lib/account-store";
import { getPantryRecord, openPantryDatabase } from "../src/lib/pantry-store";

const origin = "https://reach.example";
let directory: string, database: string, firstId: string, secondId: string;
let handle: ReturnType<typeof createPantryHandler>;
type Client = { id: string; cookie: string; email: string };
function client(
  role: "user" | "administrator" = "user",
  verified = true,
  communityRole = "resident",
): Client {
  const db = openPantryDatabase(database),
    id = randomUUID(),
    token = randomBytes(32).toString("hex"),
    email = `${id}@example.org`;
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,pantry_role) VALUES(?,?,?, ?,?,1,?,?,?,?)",
  ).run(
    id,
    id,
    "fixture-no-password-login",
    "",
    communityRole,
    new Date().toISOString(),
    email,
    verified ? new Date().toISOString() : null,
    role,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    id,
    new Date(Date.now() + 3600000).toISOString(),
  );
  return { id, cookie: `reach_community_session=${token}`, email };
}
async function call(
  path = "",
  method = "GET",
  data?: unknown,
  actor?: Client,
  headers: Record<string, string> = {},
) {
  return handle(
    new Request(`${origin}/api/pantries/${path}`, {
      method,
      headers: {
        ...(method !== "GET"
          ? { origin, "content-type": "application/json" }
          : {}),
        ...(actor ? { cookie: actor.cookie } : {}),
        ...headers,
      },
      ...(method !== "GET" ? { body: JSON.stringify(data ?? {}) } : {}),
    }),
    path.split("?")[0].split("/").filter(Boolean),
  );
}
beforeEach(() => {
  vi.stubEnv("REACH_APP_ORIGIN", origin);
  directory = mkdtempSync(join(tmpdir(), "reach-pantry-security-"));
  database = join(directory, "community.sqlite");
  const db = openPantryDatabase(database);
  [firstId, secondId] = db
    .prepare("SELECT id FROM pantries ORDER BY id LIMIT 2")
    .all()
    .map((row) => String(row.id));
  handle = createPantryHandler(database);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("independent pantry authorization", () => {
  it("keeps community moderators and unverified administrators outside pantry administration", async () => {
    const moderator = client("user", true, "moderator"),
      unverified = client("administrator", false);
    for (const actor of [moderator, unverified]) {
      expect((await call("audit", "GET", undefined, actor)).status).toBe(403);
      expect(
        (
          await call(
            "",
            "POST",
            { name: "Unauthorized", address: "Example address" },
            actor,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            firstId,
            "PATCH",
            { name: "Unauthorized", version: 1 },
            actor,
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (await call(firstId, "PATCH", { name: "Unauthorized", version: 1 }))
        .status,
    ).toBe(401);
    expect((await (await call(firstId)).json()).permissions.canEdit).toBe(
      false,
    );
  });

  it("limits managers to their assigned pantry and immediately applies revocation", async () => {
    const administrator = client("administrator"),
      manager = client();
    expect(
      (
        await call(
          "assignments",
          "POST",
          { pantryId: firstId, email: manager.email, assign: true },
          administrator,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          firstId,
          "PATCH",
          { version: 1, notes: "Verified by assigned manager" },
          manager,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          secondId,
          "PATCH",
          { version: 1, notes: "Unauthorized" },
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `${secondId}/inventory`,
          "PUT",
          { version: 1, items: [] },
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "assignments",
          "POST",
          { pantryId: secondId, email: manager.email, assign: true },
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          `${firstId}/archive`,
          "POST",
          {
            confirmation: getPantryRecord(
              firstId,
              openPantryDatabase(database),
            )!.name,
          },
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "assignments",
          "POST",
          { pantryId: firstId, email: manager.email, assign: false },
          administrator,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          firstId,
          "PATCH",
          { version: 2, notes: "Revoked manager" },
          manager,
        )
      ).status,
    ).toBe(403);
    expect(
      getPantryRecord(secondId, openPantryDatabase(database))!.version,
    ).toBe(1);
  });

  it("requires explicit archive confirmation and hides archived rows from public reads and favorites", async () => {
    const administrator = client("administrator"),
      user = client();
    expect(
      (await call("favorites", "POST", { id: firstId }, user)).status,
    ).toBe(200);
    expect(
      (
        await call(
          `${firstId}/archive`,
          "POST",
          { confirmation: "wrong" },
          administrator,
        )
      ).status,
    ).toBe(400);
    const name = getPantryRecord(firstId, openPantryDatabase(database))!.name;
    expect(
      (
        await call(
          `${firstId}/archive`,
          "POST",
          { confirmation: name },
          administrator,
        )
      ).status,
    ).toBe(200);
    expect((await call(firstId)).status).toBe(404);
    expect((await call(firstId, "GET", undefined, user)).status).toBe(404);
    expect(
      (await (await call("favorites", "GET", undefined, user)).json())
        .favorites,
    ).toEqual([]);
    expect(
      (await call("?includeArchived=true", "GET", undefined, user)).status,
    ).toBe(403);
    expect((await call(firstId, "GET", undefined, administrator)).status).toBe(
      200,
    );
    expect(
      (
        await call(
          `${firstId}/restore`,
          "POST",
          { confirmation: name },
          administrator,
        )
      ).status,
    ).toBe(200);
    expect((await call(firstId)).status).toBe(200);
    expect(
      (await (await call("favorites", "GET", undefined, user)).json())
        .favorites,
    ).toEqual([firstId]);
  });

  it("rejects unsafe links, injected fields, cross-origin writes and stale overwrites", async () => {
    const administrator = client("administrator");
    for (const extra of [
      { website: "javascript:alert(1)" },
      { sources: [{ title: "Injected", url: "data:text/html,attack" }] },
      { active: false },
      { id: secondId },
      { pantry_role: "administrator" },
    ]) {
      expect(
        (await call(firstId, "PATCH", { version: 1, ...extra }, administrator))
          .status,
      ).toBe(400);
    }
    expect(
      (
        await call(
          firstId,
          "PATCH",
          { version: 1, name: "Cross origin" },
          administrator,
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          firstId,
          "PATCH",
          { version: 1, name: "First writer" },
          administrator,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          firstId,
          "PATCH",
          { version: 1, name: "Stale writer" },
          administrator,
        )
      ).status,
    ).toBe(409);
    expect(getPantryRecord(firstId, openPantryDatabase(database))!.name).toBe(
      "First writer",
    );
    expect(
      openPantryDatabase(database)
        .prepare("SELECT count(*) n FROM pantry_history WHERE pantry_id=?")
        .get(firstId)!.n,
    ).toBe(2);
  });

  it("lets users suggest corrections without editing official records or reviewing their own proposal", async () => {
    const user = client(),
      administrator = client("administrator"),
      before = getPantryRecord(firstId, openPantryDatabase(database))!;
    const proposal = await call(
      `${firstId}/corrections`,
      "POST",
      { description: "Please check distribution hours" },
      user,
    );
    expect(proposal.status).toBe(201);
    const id = (await proposal.json()).id;
    expect(
      (
        await call(
          `corrections/${id}/review`,
          "POST",
          {
            decision: "approve",
            notes: "Self-approved",
            changes: { version: 1, hours: "Always open" },
          },
          user,
        )
      ).status,
    ).toBe(403);
    expect(getPantryRecord(firstId, openPantryDatabase(database))!.hours).toBe(
      before.hours,
    );
    expect(
      (
        await call(
          `corrections/${id}/review`,
          "POST",
          { decision: "reject", notes: "No supporting evidence" },
          administrator,
        )
      ).status,
    ).toBe(200);
    expect(
      getPantryRecord(firstId, openPantryDatabase(database))!.version,
    ).toBe(before.version);
    expect(
      (
        await call(
          `corrections/${id}/review`,
          "POST",
          { decision: "reject", notes: "Again" },
          administrator,
        )
      ).status,
    ).toBe(409);
  });
});
