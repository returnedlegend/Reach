import { closeCommunityDatabases } from "../src/lib/community";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openPantryDatabase } from "../src/lib/pantry-store";
import { accountHash } from "../src/lib/account-store";
import { createVolunteerHandler } from "../src/lib/volunteer";
import { createCommunityHandler } from "../src/lib/community";
import { createAccountHandler } from "../src/lib/account";
import { hashAccountPasswordSync } from "../src/lib/auth-password";
import { initializeVolunteerSchema } from "../src/lib/volunteer-store";
import { initializeNotifications } from "../src/lib/notifications-store";

type Client = { id: string; cookie: string };
let dir: string,
  db: DatabaseSync,
  path: string,
  pantry: string,
  donor: Client,
  manager: Client,
  volunteer: Client,
  other: Client;
let handle: ReturnType<typeof createVolunteerHandler>;
const password = "volunteer-test-password";
const hashed = hashAccountPasswordSync(password);
function user(id: string, verified = true, participation = true): Client {
  const stamp = new Date().toISOString(),
    token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at) VALUES(?,?,?,?,'resident',1,?,?,?)",
  ).run(
    id,
    id,
    hashed,
    "",
    stamp,
    `${id}@example.test`,
    verified ? stamp : null,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    id,
    new Date(Date.now() + 3600000).toISOString(),
  );
  db.prepare("INSERT INTO notification_preferences VALUES(?,1,1,1,?,?)").run(
    id,
    +participation,
    stamp,
  );
  return { id, cookie: `reach_community_session=${token}` };
}
function offer(id = "food", opts: Record<string, unknown> = {}) {
  const stamp = new Date().toISOString(),
    starts = new Date(Date.now() - 60000).toISOString(),
    ends = new Date(Date.now() + 3600000).toISOString();
  const data = {
    title: "Sealed rice",
    description: "Food",
    pickupAreaId: "bryan",
    quantity: 2,
    allergens: "Soy",
    storage: "Dry",
    useBy: "2028-01-01",
    foodCategory: "dry-groceries",
    privatePickupInstructions: "Private library meeting notes",
    sharePickupInstructions: true,
    ...opts,
  };
  db.prepare(
    "INSERT INTO records VALUES(?,'offer',?,'approved',?,?,?,?,?,NULL)",
  ).run(id, donor.id, JSON.stringify(data), starts, ends, stamp, stamp);
  return id;
}
async function call(
  pathname: string,
  method = "GET",
  body?: unknown,
  client?: Client,
) {
  return handle(
    new Request(`http://localhost/api/volunteer/${pathname}`, {
      method,
      headers: {
        ...(method === "GET"
          ? {}
          : { origin: "http://localhost", "content-type": "application/json" }),
        ...(client ? { cookie: client.cookie } : {}),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    }),
  );
}
async function run(offerId = "food") {
  const response = await call("", "POST", { offerId, pantryId: pantry }, donor);
  expect(response.status).toBe(201);
  return (await response.json()).run.id as string;
}
async function open(offerId = "food") {
  const id = await run(offerId);
  expect((await call(`${id}/approve`, "POST", {}, manager)).status).toBe(200);
  return id;
}
beforeEach(() => {
  process.env.REACH_COMMUNITY_ENABLED = "true";
  dir = mkdtempSync(join(tmpdir(), "reach-volunteer-"));
  path = join(dir, "db.sqlite");
  db = openPantryDatabase(path);
  initializeVolunteerSchema(db);
  initializeNotifications(db);
  handle = createVolunteerHandler(path);
  pantry = String(
    db.prepare("SELECT id FROM pantries WHERE active=1 LIMIT 1").get()!.id,
  );
  donor = user("donor");
  manager = user("manager");
  volunteer = user("volunteer");
  other = user("other");
  db.prepare("INSERT INTO pantry_managers VALUES(?,?,?,?)").run(
    pantry,
    manager.id,
    donor.id,
    new Date().toISOString(),
  );
  offer();
});
afterEach(() => {
  closeCommunityDatabases();
  delete process.env.REACH_COMMUNITY_ENABLED;
  rmSync(dir, { recursive: true, force: true });
});
describe("donation runs on existing moderated food offers", () => {
  it("reserves one existing offer after pantry review, prevents direct food requests, and exposes no private data publicly", async () => {
    const id = await run();
    expect(
      (await call("", "POST", { offerId: "food", pantryId: pantry }, donor))
        .status,
    ).toBe(409);
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(409);
    expect((await call(`${id}/approve`, "POST", {}, donor)).status).toBe(403);
    const community = createCommunityHandler(path, { allowRegistration: true });
    expect(
      (await community(new Request("http://localhost/api/community/discovery")))
        .status,
    ).toBe(200);
    const discovery = await (
      await community(new Request("http://localhost/api/community/discovery"))
    ).json();
    expect(discovery.offers).toHaveLength(0);
    const request = await community(
      new Request("http://localhost/api/community/offers/food/request", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
          cookie: other.cookie,
        },
        body: JSON.stringify({ pickupConsent: true }),
      }),
    );
    expect(request.status).toBe(409);
    expect((await call(`${id}/approve`, "POST", {}, manager)).status).toBe(200);
    const publicJson = await (await call("")).json();
    expect(publicJson.runs).toHaveLength(1);
    expect(JSON.stringify(publicJson)).not.toMatch(
      /example.test|Private library|donorId|volunteerId/,
    );
  });
  it("requires verified participation and explicit strict pickup consent", async () => {
    const id = await open();
    const unverified = user("unverified", false),
      inactive = user("inactive", true, false);
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, unverified))
        .status,
    ).toBe(403);
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, inactive))
        .status,
    ).toBe(403);
    expect((await call(`${id}/claim`, "POST", {}, volunteer)).status).toBe(400);
    expect(
      (
        await call(
          `${id}/claim`,
          "POST",
          { pickupConsent: true, volunteerId: other.id },
          volunteer,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, donor))
        .status,
    ).toBe(403);
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, manager))
        .status,
    ).toBe(403);
  });
  it("allows only one concurrent claimant, enforces pickup IDOR, and deduplicates events", async () => {
    const id = await open();
    const results = await Promise.all([
      call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer),
      call(`${id}/claim`, "POST", { pickupConsent: true }, other),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const selected = String(
        db
          .prepare("SELECT volunteer_id FROM volunteer_runs WHERE id=?")
          .get(id)!.volunteer_id,
      ),
      winner = selected === volunteer.id ? volunteer : other,
      loser = winner === volunteer ? other : volunteer;
    expect((await call(`${id}/pickup`, "GET", undefined, loser)).status).toBe(
      403,
    );
    expect((await call(`${id}/pickup`, "GET", undefined, manager)).status).toBe(
      403,
    );
    expect(
      (await (await call(`${id}/pickup`, "GET", undefined, winner)).json())
        .instructions,
    ).toBe("Private library meeting notes");
    const count = Number(
      db
        .prepare(
          "SELECT COUNT(*) n FROM notification_outbox WHERE kind='assignment-confirmed' AND resource_id=?",
        )
        .get(id)!.n,
    );
    expect(count).toBe(3);
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, winner))
        .status,
    ).toBe(409);
    expect(
      Number(
        db
          .prepare(
            "SELECT COUNT(*) n FROM notification_outbox WHERE kind='assignment-confirmed' AND resource_id=?",
          )
          .get(id)!.n,
      ),
    ).toBe(count);
    expect((await call(`${id}/complete`, "POST", {}, loser)).status).toBe(403);
  });
  it("prevents conflicting recipient requests and invalid or inactive pantry/offers", async () => {
    db.prepare(
      "INSERT INTO requests VALUES('request','food',?,'requested',1,?,?)",
    ).run(other.id, new Date().toISOString(), new Date().toISOString());
    expect(
      (await call("", "POST", { offerId: "food", pantryId: pantry }, donor))
        .status,
    ).toBe(409);
    db.prepare("DELETE FROM requests").run();
    expect(
      (
        await call(
          "",
          "POST",
          { offerId: "food", pantryId: "invented-pantry" },
          donor,
        )
      ).status,
    ).toBe(404);
    db.prepare("UPDATE records SET status='pending' WHERE id='food'").run();
    expect(
      (await call("", "POST", { offerId: "food", pantryId: pantry }, donor))
        .status,
    ).toBe(409);
    db.prepare(
      "UPDATE records SET status='approved',ends_at=? WHERE id='food'",
    ).run(new Date(Date.now() - 60000).toISOString());
    expect(
      (await call("", "POST", { offerId: "food", pantryId: pantry }, donor))
        .status,
    ).toBe(409);
  });
  it("blocks mutual access and keeps consent private after release/cancellation", async () => {
    const id = await open();
    db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(
      donor.id,
      volunteer.id,
      new Date().toISOString(),
    );
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(403);
    expect(
      (await (await call("", "GET", undefined, volunteer)).json()).runs,
    ).toHaveLength(0);
    db.prepare("DELETE FROM blocks").run();
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(200);
    expect((await call(`${id}/release`, "POST", {}, volunteer)).status).toBe(
      200,
    );
    expect(
      (await call(`${id}/pickup`, "GET", undefined, volunteer)).status,
    ).toBe(403);
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, other))
        .status,
    ).toBe(200);
    expect((await call(`${id}/cancel`, "POST", {}, donor)).status).toBe(200);
    expect((await call(`${id}/pickup`, "GET", undefined, other)).status).toBe(
      403,
    );
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, other))
        .status,
    ).toBe(409);
  });
  it("requires pickup start for explicit donor/pantry completion and ends the existing offer", async () => {
    const id = await open();
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(200);
    db.prepare("UPDATE records SET starts_at=? WHERE id='food'").run(
      new Date(Date.now() + 60000).toISOString(),
    );
    expect((await call(`${id}/complete`, "POST", {}, manager)).status).toBe(
      409,
    );
    db.prepare("UPDATE records SET starts_at=? WHERE id='food'").run(
      new Date(Date.now() - 60000).toISOString(),
    );
    expect((await call(`${id}/complete`, "POST", {}, volunteer)).status).toBe(
      403,
    );
    expect((await call(`${id}/complete`, "POST", {}, manager)).status).toBe(
      200,
    );
    expect(
      db.prepare("SELECT status FROM records WHERE id='food'").get()!.status,
    ).toBe("ended");
    expect(
      db.prepare("SELECT status FROM volunteer_runs WHERE id=?").get(id)!
        .status,
    ).toBe("completed");
    expect((await call(`${id}/complete`, "POST", {}, donor)).status).toBe(409);
  });
  it("releases a deleted volunteer and cascades donor private data via actual account deletion", async () => {
    const id = await open();
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(200);
    const account = createAccountHandler(path);
    async function remove(client: Client) {
      return account(
        new Request("http://localhost/api/account/delete", {
          method: "DELETE",
          headers: {
            origin: "http://localhost",
            "content-type": "application/json",
            cookie: client.cookie,
          },
          body: JSON.stringify({ password, confirmation: "DELETE" }),
        }),
      );
    }
    expect((await remove(volunteer)).status).toBe(200);
    const released = db
      .prepare("SELECT * FROM volunteer_runs WHERE id=?")
      .get(id)!;
    expect(released.status).toBe("open");
    expect(released.volunteer_id).toBeNull();
    expect(released.pickup_consent).toBe(0);
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, other))
        .status,
    ).toBe(200);
    expect((await remove(donor)).status).toBe(200);
    expect(
      db.prepare("SELECT 1 FROM volunteer_runs WHERE id=?").get(id),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT 1 FROM records WHERE id='food'").get(),
    ).toBeUndefined();
    expect((await call(`${id}/pickup`, "GET", undefined, other)).status).toBe(
      404,
    );
  });
  it("cancels runs when the real pantry is archived or the approved offer is removed", async () => {
    const id = await open();
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(200);
    db.prepare("UPDATE pantries SET active=0 WHERE id=?").run(pantry);
    expect(
      db.prepare("SELECT status FROM volunteer_runs WHERE id=?").get(id)!
        .status,
    ).toBe("cancelled");
    expect(
      (await call(`${id}/pickup`, "GET", undefined, volunteer)).status,
    ).toBe(403);
  });
  it("enforces one active assignment across separate runs and independent SQLite connections", async () => {
    const id = await open();
    offer("second");
    const second = await open("second");
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(200);
    expect(
      (
        await call(
          `${second}/claim`,
          "POST",
          { pickupConsent: true },
          volunteer,
        )
      ).status,
    ).toBe(409);
    const connection = new DatabaseSync(path);
    connection.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    expect(() =>
      connection
        .prepare(
          "UPDATE volunteer_runs SET status='assigned',volunteer_id=?,pickup_consent=1 WHERE id=?",
        )
        .run(volunteer.id, second),
    ).toThrow();
    connection.close();
  });
  it("requires mutual pickup sharing and preserves safe cancellation after a block", async () => {
    const id = await open();
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(200);
    const record = db
      .prepare("SELECT data FROM records WHERE id='food'")
      .get()!;
    const data = JSON.parse(String(record.data));
    data.sharePickupInstructions = false;
    db.prepare("UPDATE records SET data=? WHERE id='food'").run(
      JSON.stringify(data),
    );
    expect(
      (await call(`${id}/pickup`, "GET", undefined, volunteer)).status,
    ).toBe(403);
    expect((await call(`${id}/pickup`, "GET", undefined, donor)).status).toBe(
      200,
    );
    db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(
      manager.id,
      volunteer.id,
      new Date().toISOString(),
    );
    const mine = await (await call("mine", "GET", undefined, volunteer)).json();
    expect(mine.runs[0].canViewPickup).toBe(false);
    expect(mine.runs[0].canRelease).toBe(true);
    expect((await call(`${id}/release`, "POST", {}, volunteer)).status).toBe(
      200,
    );
    expect(
      (await call(`${id}/claim`, "POST", { pickupConsent: true }, volunteer))
        .status,
    ).toBe(403);
    expect((await call(`${id}/cancel`, "POST", {}, donor)).status).toBe(200);
  });
  it("bounds opportunity notices, excludes ineligible people, and rotates daily recipients", async () => {
    for (let i = 0; i < 25; i++) user(`candidate${String(i).padStart(2, "0")}`);
    const unverified = user("unverified", false),
      inactive = user("inactive", true, false);
    db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(
      donor.id,
      volunteer.id,
      new Date().toISOString(),
    );
    const id = await open();
    const notices = db
      .prepare(
        "SELECT user_id FROM notification_outbox WHERE resource_id=? AND kind='new-opportunity'",
      )
      .all(id);
    expect(notices).toHaveLength(20);
    expect(notices.map((n) => n.user_id)).not.toEqual(
      expect.arrayContaining([
        donor.id,
        manager.id,
        volunteer.id,
        unverified.id,
        inactive.id,
      ]),
    );
    for (const excluded of [
      donor.id,
      manager.id,
      volunteer.id,
      unverified.id,
      inactive.id,
    ])
      expect(notices.some((n) => n.user_id === excluded)).toBe(false);
    offer("second");
    const second = await open("second");
    const rotated = db
      .prepare(
        "SELECT user_id FROM notification_outbox WHERE resource_id=? AND kind='new-opportunity'",
      )
      .all(second);
    expect(rotated.length).toBe(6);
    expect(
      rotated.some((n) => notices.some((first) => first.user_id === n.user_id)),
    ).toBe(false);
  });
  it("keeps the pilot gate and mutation origin protection", async () => {
    const response = await handle(
      new Request("http://localhost/api/volunteer/", {
        method: "POST",
        headers: {
          origin: "https://outside.example",
          "content-type": "application/json",
          cookie: donor.cookie,
        },
        body: JSON.stringify({ offerId: "food", pantryId: pantry }),
      }),
    );
    expect(response.status).toBe(403);
    delete process.env.REACH_COMMUNITY_ENABLED;
    expect((await call("")).status).toBe(404);
  });
});
