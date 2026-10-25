import { closeCommunityDatabases } from "../src/lib/community";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  createCommunityHandler,
  createModerator,
  openCommunityDatabase,
} from "../src/lib/community";

const password = "test-password-is-long";
let directory: string,
  database: string,
  handle: ReturnType<typeof createCommunityHandler>;
type Client = { cookie: string; id: string; username: string };
async function call(
  path: string,
  method = "GET",
  data?: unknown,
  client?: Client,
  extra: Record<string, string> = {},
) {
  return handle(
    new Request(`http://localhost/api/community/${path}`, {
      method,
      headers: {
        ...(method !== "GET"
          ? { "content-type": "application/json", origin: "http://localhost" }
          : {}),
        ...(client ? { cookie: client.cookie } : {}),
        ...extra,
      },
      ...(method !== "GET" ? { body: JSON.stringify(data ?? {}) } : {}),
    }),
  );
}
async function signup(username: string): Promise<Client> {
  const res = await call("auth/signup", "POST", {
    username,
    password,
    adultConfirmed: true,
  });
  expect(res.status).toBe(201);
  const data = await res.json();
  return {
    cookie: res.headers.get("set-cookie")!.split(";")[0],
    id: data.user.id,
    username,
  };
}
async function moderator(): Promise<Client> {
  createModerator("moderator", password, database);
  const res = await call("auth/login", "POST", {
    username: "moderator",
    password,
  });
  const data = await res.json();
  return {
    cookie: res.headers.get("set-cookie")!.split(";")[0],
    id: data.user.id,
    username: "moderator",
  };
}
function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: "Sealed rice",
    description: "Unopened shelf-stable food",
    pickupAreaId: "bryan",
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    quantity: 1,
    allergens: "Check label: may contain soy",
    storage: "Keep dry",
    useBy: "2028-12-31",
    foodCategory: "dry-groceries",
    labelsIntact: true,
    noExcludedProducts: true,
    sealed: true,
    shelfStable: true,
    notHomemade: true,
    packagingUndamaged: true,
    notRecalled: true,
    privatePickupInstructions:
      "Meet at the public library entrance, never a home.",
    pickupIsPublicPlace: true,
    sharePickupInstructions: true,
    ...overrides,
  };
}
async function offer(owner: Client, mod?: Client) {
  const made = await call("offers", "POST", draft(), owner);
  expect(made.status).toBe(201);
  const id = (await made.json()).record.id;
  if (mod) {
    expect((await call(`offers/${id}/submit`, "POST", {}, owner)).status).toBe(
      200,
    );
    expect(
      (await call(`moderation/offers/${id}/approve`, "POST", {}, mod)).status,
    ).toBe(200);
  }
  return id as string;
}
async function request(id: string, client: Client) {
  const res = await call(
    `offers/${id}/request`,
    "POST",
    { pickupConsent: true },
    client,
  );
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-community-"));
  database = join(directory, "community.sqlite");
  handle = createCommunityHandler(database, { allowRegistration: true });
  process.env.REACH_COMMUNITY_ENABLED = "true";
});
afterEach(() => {
  closeCommunityDatabases();
  delete process.env.REACH_COMMUNITY_ENABLED;
  rmSync(directory, { recursive: true, force: true });
});

describe("development community authentication and request boundaries", () => {
  it("is available by default without a legacy community flag", async () => {
    delete process.env.REACH_COMMUNITY_ENABLED;
    const result = await call("discovery");
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ hotspots: [], offers: [] });
    expect(existsSync(database)).toBe(true);
  });
  it("requires adult affirmation, strong passwords and strict schemas without role escalation", async () => {
    for (const data of [
      { username: "alice", password, adultConfirmed: false },
      { username: "alice", password: "short", adultConfirmed: true },
      { username: "alice", password, adultConfirmed: true, role: "moderator" },
    ])
      expect((await call("auth/signup", "POST", data)).status).toBe(400);
    const alice = await signup("alice");
    expect(
      (await (await call("me", "GET", undefined, alice)).json()).user.role,
    ).toBe("resident");
    expect((await call("moderation", "GET", undefined, alice)).status).toBe(
      403,
    );
  });
  it("stores salted hashes and opaque expiring sessions, and invalidates logout", async () => {
    const alice = await signup("alice"),
      db = openCommunityDatabase(database),
      row = db.prepare("SELECT * FROM users").get()!;
    expect(row.password_hash).not.toBe(password);
    expect(String(row.salt).length).toBe(32);
    const session = db.prepare("SELECT * FROM sessions").get()!;
    expect(session.token_hash).not.toBe(alice.cookie.split("=")[1]);
    const login = await call("auth/login", "POST", {
      username: "alice",
      password,
    });
    expect(login.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Strict",
    );
    expect((await call("auth/logout", "POST", {}, alice)).status).toBe(200);
    expect(
      (await (await call("me", "GET", undefined, alice)).json()).user,
    ).toBeNull();
    db.prepare(
      "UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'",
    ).run();
    const stale = {
      ...alice,
      cookie: login.headers.get("set-cookie")!.split(";")[0],
    };
    expect(
      (await (await call("me", "GET", undefined, stale)).json()).user,
    ).toBeNull();
  });
  it("rejects cross-origin, missing-origin, non-JSON, huge, and malformed mutations", async () => {
    const alice = await signup("alice");
    expect(
      (
        await call("auth/logout", "POST", {}, alice, {
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    const base = {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: "{}",
    };
    expect(
      (
        await handle(
          new Request("http://localhost/api/community/auth/logout", base),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("auth/logout", "POST", {}, alice, {
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect(
      (await call("offers", "POST", { description: "x".repeat(9000) }, alice))
        .status,
    ).toBe(413);
    expect(
      (
        await handle(
          new Request("http://localhost/api/community/auth/logout", {
            ...base,
            headers: { ...base.headers, origin: "http://localhost" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("applies database global and account rate limits without trusting client-IP headers", async () => {
    await signup("alice");
    let status = 0;
    for (let i = 0; i < 11; i++)
      status = (
        await call(
          "auth/login",
          "POST",
          { username: "alice", password: "wrong-but-long-password" },
          undefined,
          { "x-forwarded-for": `192.0.2.${i}` },
        )
      ).status;
    expect(status).toBe(429);
    const db = openCommunityDatabase(database);
    db.prepare(
      "INSERT OR REPLACE INTO rate_limits VALUES('global:requests',600,?)",
    ).run(Date.now() + 60000);
    expect((await call("discovery")).status).toBe(429);
  });
});
describe("moderation, privacy and food constraints", () => {
  it("keeps drafts and pending offers private, redacts pickup notes/usernames, and protects edits", async () => {
    const alice = await signup("alice"),
      bob = await signup("bob"),
      mod = await moderator(),
      id = await offer(alice);
    expect((await (await call("discovery")).json()).offers).toHaveLength(0);
    expect((await call(`offers/${id}`, "PATCH", draft(), bob)).status).toBe(
      403,
    );
    await call(`offers/${id}/submit`, "POST", {}, alice);
    const pending = await (
      await call("moderation", "GET", undefined, mod)
    ).json();
    expect(JSON.stringify(pending.offers)).not.toContain(
      "privatePickupInstructions",
    );
    await call(`moderation/offers/${id}/approve`, "POST", {}, mod);
    const publicData = await (await call("discovery")).json();
    expect(publicData.offers).toHaveLength(1);
    expect(JSON.stringify(publicData)).not.toContain(
      "privatePickupInstructions",
    );
    expect(JSON.stringify(publicData)).not.toContain("alice");
    expect((await call(`offers/${id}`, "PATCH", draft(), alice)).status).toBe(
      409,
    );
  });
  it("requires food safety attestations, a known approximate area and valid bounded windows", async () => {
    const alice = await signup("alice");
    for (const changes of [
      { sealed: false },
      { labelsIntact: false },
      { noExcludedProducts: false },
      { foodCategory: "alcohol" },
      { shelfStable: false },
      { packagingUndamaged: false },
      { notRecalled: false },
      { pickupAreaId: "home" },
      { lat: 30.6 },
      { useBy: "2020-01-01" },
      { useBy: "2027-02-30" },
      { endsAt: new Date(Date.now() + 8 * 86400000).toISOString() },
    ])
      expect((await call("offers", "POST", draft(changes), alice)).status).toBe(
        400,
      );
  });
  it("requires moderator approval before either household offers or hotspots are public", async () => {
    const owner = await signup("organizer"),
      mod = await moderator();
    const db = openCommunityDatabase(database);
    db.prepare("UPDATE users SET role='organizer' WHERE id=?").run(owner.id);
    const hotspot = await call(
      "hotspots",
      "POST",
      {
        title: "Fixture hotspot",
        description: "Fixture only",
        organizerName: "Fixture organizer",
        address: "Fixture venue, Bryan",
        lat: 30.67,
        lng: -96.37,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        foodCategory: "Groceries",
        eligibility: "Confirm",
        accessibility: "Unknown",
        contact: "Fixture",
        pickupInstructions: "Confirm before going",
      },
      owner,
    );
    expect(hotspot.status).toBe(201);
    const hotspotId = (await hotspot.json()).record.id;
    const offerId = await offer(owner);
    for (const [kind, id] of [
      ["hotspots", hotspotId],
      ["offers", offerId],
    ]) {
      expect(
        (await call(`${kind}/${id}/submit`, "POST", {}, owner)).status,
      ).toBe(200);
      expect(
        db.prepare("SELECT status FROM records WHERE id=?").get(id)?.status,
      ).toBe("pending");
      expect(
        JSON.stringify(await (await call("discovery")).json()),
      ).not.toContain(id);
      expect(
        (await call(`moderation/${kind}/${id}/approve`, "POST", {}, owner))
          .status,
      ).toBe(403);
      expect(
        (await call(`moderation/${kind}/${id}/approve`, "POST", {}, mod))
          .status,
      ).toBe(200);
      expect(JSON.stringify(await (await call("discovery")).json())).toContain(
        id,
      );
    }
  });
  it("gates organizers and prevents self-approval", async () => {
    const alice = await signup("alice"),
      mod = await moderator();
    expect((await call("hotspots", "POST", {}, alice)).status).toBe(403);
    await call("organizer-request", "POST", {}, alice);
    expect(
      (
        await call(
          `moderation/organizers/${alice.id}/approve`,
          "POST",
          {},
          alice,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(`moderation/organizers/${alice.id}/approve`, "POST", {}, mod))
        .status,
    ).toBe(200);
    expect(
      (await (await call("me", "GET", undefined, alice)).json()).user.role,
    ).toBe("organizer");
  });
  it("removes expired listings using current timestamps and records takedown/report resolution", async () => {
    const alice = await signup("alice"),
      bob = await signup("bob"),
      mod = await moderator(),
      id = await offer(alice, mod),
      rid = await request(id, bob);
    await call(`requests/${rid}/accept`, "POST", {}, alice);
    const report = await call(
      "reports",
      "POST",
      { targetType: "offer", targetId: id, reason: "Packaging concern" },
      bob,
    );
    expect(report.status).toBe(201);
    let queue = await (await call("moderation", "GET", undefined, mod)).json();
    const reportId = queue.reports[0].id;
    expect(
      (
        await call(
          `moderation/offers/${id}/remove`,
          "POST",
          { reason: "Unsafe packaging" },
          mod,
        )
      ).status,
    ).toBe(200);
    expect(
      (await call(`requests/${rid}/pickup`, "GET", undefined, bob)).status,
    ).toBe(403);
    expect(
      (await (await call("mine", "GET", undefined, bob)).json()).requests[0]
        .status,
    ).toBe("cancelled");
    await call(
      `moderation/reports/${reportId}/resolve`,
      "POST",
      { reason: "Listing removed" },
      mod,
    );
    queue = await (await call("moderation", "GET", undefined, mod)).json();
    expect(queue.reports).toHaveLength(0);
    expect(
      queue.audit.find((v: { action: string }) => v.action === "resolve-report")
        .reason,
    ).toBe("Listing removed");
    const other = await offer(alice, mod);
    openCommunityDatabase(database)
      .prepare(
        "UPDATE records SET ends_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(other);
    expect((await (await call("discovery")).json()).offers).toHaveLength(0);
    expect(
      (
        await call(
          `offers/${other}/request`,
          "POST",
          { pickupConsent: true },
          bob,
        )
      ).status,
    ).toBe(409);
  });
});
describe("transactional reservations and pickup consent", () => {
  it("allows one accepted request under racing attempts and rejects duplicate requests", async () => {
    const alice = await signup("alice"),
      bob = await signup("bob"),
      carol = await signup("carol"),
      mod = await moderator(),
      id = await offer(alice, mod),
      first = await request(id, bob),
      second = await request(id, carol);
    expect(
      (await call(`offers/${id}/request`, "POST", { pickupConsent: true }, bob))
        .status,
    ).toBe(409);
    const results = await Promise.all([
      call(`requests/${first}/accept`, "POST", {}, alice),
      call(`requests/${second}/accept`, "POST", {}, alice),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT COUNT(*) n FROM requests WHERE status='accepted'")
        .get()?.n,
    ).toBe(1);
    expect((await (await call("discovery")).json()).offers).toHaveLength(0);
  });
  it("reveals pickup notes only to owner and mutually consenting accepted recipient", async () => {
    const alice = await signup("alice"),
      bob = await signup("bob"),
      carol = await signup("carol"),
      mod = await moderator(),
      id = await offer(alice, mod),
      rid = await request(id, bob);
    expect(
      (await call(`requests/${rid}/pickup`, "GET", undefined, bob)).status,
    ).toBe(403);
    await call(`requests/${rid}/accept`, "POST", {}, alice);
    expect(
      (await call(`requests/${rid}/pickup`, "GET", undefined, bob)).status,
    ).toBe(200);
    expect(
      (await call(`requests/${rid}/pickup`, "GET", undefined, carol)).status,
    ).toBe(403);
    expect(
      (await call(`requests/${rid}/pickup`, "GET", undefined, mod)).status,
    ).toBe(403);
    const db = openCommunityDatabase(database),
      row = db.prepare("SELECT data FROM records WHERE id=?").get(id)!;
    const data = JSON.parse(String(row.data));
    data.sharePickupInstructions = false;
    db.prepare("UPDATE records SET data=? WHERE id=?").run(
      JSON.stringify(data),
      id,
    );
    expect(
      (await call(`requests/${rid}/pickup`, "GET", undefined, bob)).status,
    ).toBe(403);
  });
  it("cancels blocked interactions, hides discovery and protects private pickup", async () => {
    const alice = await signup("alice"),
      bob = await signup("bob"),
      mod = await moderator(),
      id = await offer(alice, mod),
      rid = await request(id, bob);
    await call(`requests/${rid}/accept`, "POST", {}, alice);
    await call("blocks", "POST", { userId: alice.id }, bob);
    expect(
      (await call(`requests/${rid}/pickup`, "GET", undefined, bob)).status,
    ).toBe(403);
    expect(
      (await (await call("mine", "GET", undefined, bob)).json()).requests[0]
        .status,
    ).toBe("cancelled");
    expect(
      (await (await call("discovery", "GET", undefined, bob)).json()).offers,
    ).toHaveLength(0);
    expect(
      (await call(`offers/${id}/request`, "POST", { pickupConsent: true }, bob))
        .status,
    ).toBe(403);
  });
  it("lets the accepted recipient collect once and rejects collection after expiry", async () => {
    const alice = await signup("alice"),
      bob = await signup("bob"),
      mod = await moderator(),
      id = await offer(alice, mod),
      rid = await request(id, bob);
    await call(`requests/${rid}/accept`, "POST", {}, alice);
    expect(
      (await call(`requests/${rid}/collect`, "POST", {}, bob)).status,
    ).toBe(200);
    expect(
      (await call(`requests/${rid}/collect`, "POST", {}, bob)).status,
    ).toBe(409);
    const other = await offer(alice, mod),
      rid2 = await request(other, bob);
    await call(`requests/${rid2}/accept`, "POST", {}, alice);
    openCommunityDatabase(database)
      .prepare(
        "UPDATE records SET ends_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(other);
    expect(
      (await call(`requests/${rid2}/collect`, "POST", {}, bob)).status,
    ).toBe(409);
  });
});

describe("deployment and media regression checks", () => {
  it("checks direct Host when Next rewrites its request URL and ignores forwarded authority", async () => {
    const request = (origin: string, forwarded?: string) =>
      new Request("http://0.0.0.0:3000/api/community/auth/signup", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin,
          "content-type": "application/json",
          ...(forwarded ? { "x-forwarded-host": forwarded } : {}),
        },
        body: JSON.stringify({
          username: "alice",
          password,
          adultConfirmed: true,
        }),
      });
    expect(
      (await handle(request("https://evil.example", "evil.example"))).status,
    ).toBe(403);
    expect((await handle(request("http://localhost:3000"))).status).toBe(201);
    // Windows exposes ACLs rather than POSIX permission bits.
    if (process.platform !== "win32")
      expect(statSync(database).mode & 0o777).toBe(0o600);
  });
  it("gates sanitized media and prevents replacing an approved photo", async () => {
    const alice = await signup("alice"),
      bob = await signup("bob"),
      mod = await moderator(),
      id = await offer(alice);
    const image = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const photo = {
      dataUrl: `data:image/png;base64,${image.toString("base64")}`,
    };
    expect((await call(`offers/${id}/photo`, "POST", photo, bob)).status).toBe(
      403,
    );
    const added = await call(`offers/${id}/photo`, "POST", photo, alice);
    expect(added.status).toBe(200);
    expect((await added.json()).record.photoUrl).toBe(
      `/api/community/media/${id}`,
    );
    expect((await call(`media/${id}`)).status).toBe(404);
    const privateImage = await call(`media/${id}`, "GET", undefined, alice);
    expect(privateImage.status).toBe(200);
    expect(privateImage.headers.get("content-type")).toBe("image/jpeg");
    expect(privateImage.headers.get("cache-control")).toBe("no-store");
    await call(`offers/${id}/submit`, "POST", {}, alice);
    await call(`moderation/offers/${id}/approve`, "POST", {}, mod);
    expect((await call(`media/${id}`)).status).toBe(200);
    expect(
      (await call(`offers/${id}/photo`, "POST", photo, alice)).status,
    ).toBe(409);
    await call(
      `moderation/offers/${id}/remove`,
      "POST",
      { reason: "Privacy concern" },
      mod,
    );
    expect((await call(`media/${id}`)).status).toBe(404);
  });
  it("reserves scheduled offers but refuses collection until the window begins", async () => {
    const alice = await signup("alice"),
      bob = await signup("bob"),
      mod = await moderator();
    const created = await call(
        "offers",
        "POST",
        draft({ startsAt: new Date(Date.now() + 60000).toISOString() }),
        alice,
      ),
      id = (await created.json()).record.id;
    await call(`offers/${id}/submit`, "POST", {}, alice);
    await call(`moderation/offers/${id}/approve`, "POST", {}, mod);
    expect(
      (await (await call("discovery")).json()).offers[0].availability,
    ).toBe("scheduled");
    const rid = await request(id, bob);
    await call(`requests/${rid}/accept`, "POST", {}, alice);
    expect(
      (await call(`requests/${rid}/collect`, "POST", {}, bob)).status,
    ).toBe(409);
  });
  it("retains bounded audit and complete resolved report evidence", async () => {
    const alice = await signup("alice"),
      mod = await moderator(),
      id = await offer(alice, mod),
      db = openCommunityDatabase(database);
    await call(
      "reports",
      "POST",
      { targetType: "offer", targetId: id, reason: "Food label is unreadable" },
      alice,
    );
    const report = db.prepare("SELECT * FROM reports").get()!;
    await call(
      `moderation/reports/${report.id}/resolve`,
      "POST",
      { reason: "Listing removed" },
      mod,
    );
    expect(
      db.prepare("SELECT * FROM reports WHERE id=?").get(report.id)?.reason,
    ).toBe("Food label is unreadable");
    expect(
      db.prepare("SELECT resolved_at FROM reports WHERE id=?").get(report.id)
        ?.resolved_at,
    ).toBeTruthy();
    const insert = db.prepare(
      "INSERT INTO audit(actor_id,action,target_id,created_at) VALUES(?,'test',?,?)",
    );
    for (let i = 0; i < 1001; i++)
      insert.run(alice.id, id, new Date().toISOString());
    await call("organizer-request", "POST", {}, alice);
    expect(db.prepare("SELECT COUNT(*) n FROM audit").get()?.n).toBe(1000);
  });
});
