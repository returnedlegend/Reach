import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountHash } from "../src/lib/account-store";
import { openPantryDatabase } from "../src/lib/pantry-store";
import { initializeOutreach } from "../src/lib/outreach-store";
import { createAccessHandler } from "../src/lib/access-service";
import { chicagoNow } from "../src/lib/journey";
import { shiftDate } from "../src/lib/time";

const origin = "https://reach-household.example";
const now = new Date();
const dirs: string[] = [];
type Actor = { id: string; cookie: string };
function actor(db: ReturnType<typeof openPantryDatabase>, email: string): Actor {
  const id = randomUUID(), token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,name) VALUES(?,?,?,'','resident',1,?,?,?,'Access test')")
    .run(id, id, "fixture-only", now.toISOString(), email, now.toISOString());
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(accountHash(token), id, "2035-01-01T00:00:00.000Z");
  return { id, cookie: `reach_community_session=${token}` };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "reach-access-household-"));
  dirs.push(dir);
  const database = join(dir, "community.sqlite");
  const db = openPantryDatabase(database);
  initializeOutreach(db);
  const requester = actor(db, "requester@example.org");
  const donor = actor(db, "donor@example.org");
  const other = actor(db, "other@example.org");
  const offerId = randomUUID(), recipientId = randomUUID(), threadId = randomUUID();
  const pickup = { lat: 30.645678, lng: -96.312345 };
  const date = shiftDate(chicagoNow(now).date, 1);
  const expires = new Date(+now + 36 * 3600000).toISOString();
  const offer = {
    title: "Synthetic household offer", description: "Synthetic data only", pickupAreaId: "bryan",
    startsAt: new Date(+now - 3600000).toISOString(), endsAt: new Date(+now + 5 * 86400000).toISOString(),
    quantity: 1, allergens: "none stated", storage: "sealed", useBy: date,
    foodCategory: "sealed-snacks", labelsIntact: true, noExcludedProducts: true, sealed: true,
    shelfStable: true, notHomemade: true, packagingUndamaged: true, notRecalled: true,
    privatePickupInstructions: "Private details omitted", pickupIsPublicPlace: true,
    sharePickupInstructions: true,
  };
  db.prepare("INSERT INTO records(id,kind,owner_id,status,data,starts_at,ends_at,created_at,updated_at) VALUES(?,'offer',?,'approved',?,?,?,?,?)")
    .run(offerId, donor.id, JSON.stringify(offer), offer.startsAt, offer.endsAt, now.toISOString(), now.toISOString());
  db.prepare("INSERT INTO requests(id,offer_id,requester_id,status,pickup_consent,created_at,updated_at) VALUES(?,?,?,'accepted',1,?,?)")
    .run(randomUUID(), offerId, requester.id, now.toISOString(), now.toISOString());
  db.prepare("INSERT INTO outreach_recipients(id,kind,offer_id,owner_id,name,email,source_url,enrolled_at,unsubscribe_token) VALUES(?,'household',?,?,?,?,?,?,?)")
    .run(recipientId, offerId, donor.id, "Synthetic donor", "donor@example.org", `${origin}/food-hotspots`, now.toISOString(), randomBytes(32).toString("hex"));
  db.prepare("INSERT INTO outreach_threads(id,user_id,recipient_id,subject,body,status,created_at,available_at,sent_at,reply_token) VALUES(?,?,?,? ,?,'delivered',?,?,?,?)")
    .run(threadId, requester.id, recipientId, "Synthetic subject", "Synthetic body", now.toISOString(), now.toISOString(), now.toISOString(), randomBytes(24).toString("hex"));
  db.prepare("INSERT INTO outreach_replies(id,thread_id,email_id,text,received_at,facts_json,reviewed_at,expires_at,pickup_json) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(randomUUID(), threadId, `email-${randomUUID()}`, "Synthetic reviewed reply", now.toISOString(), JSON.stringify({
      availability: "available", date, pickupStart: "09:00", pickupEnd: "11:00", foodType: "sealed snacks",
    }), now.toISOString(), expires, JSON.stringify(pickup));
  return { db, database, requester, donor, other, offerId, recipientId, date, pickup, handler: createAccessHandler(database) };
}

function accessRequest(input: { date: string; destinationId?: string }, who?: Actor) {
  const body = {
    input: {
      origin: { lat: 30.62, lng: -96.34 }, date: input.date, departure: "08:00", mode: "walking",
      maxWalkingMinutes: 90, maxWalkingMiles: 8, fareBudget: 0, maxTransfers: 0,
      mobility: "standard", appointment: "booked", eligibilityConfirmed: true,
      dietaryPreference: "", dietaryRequired: false, visitMinutes: 20,
      arrivalBufferMinutes: 10, allowWaiting: true,
    },
    ...(input.destinationId ? { destinationId: input.destinationId } : {}),
  };
  return new Request(`${origin}/api/access`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...(who ? { cookie: who.cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("REACH_COMMUNITY_ENABLED", "true");
  vi.stubEnv("OSM_ROUTER_MODE", "disabled");
  vi.stubEnv("REACH_ACCESS_CANDIDATES", "1");
  vi.stubEnv("REACH_APP_ORIGIN", origin);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("private household access candidate boundary", () => {
  it("includes the requester's accepted household pickup with its exact confirmed point and hides it from other accounts and anonymous searches", async () => {
    const f = setup();
    const own = await f.handler(accessRequest({ date: f.date, destinationId: f.offerId }, f.requester));
    expect(own.status).toBe(200);
    const result = await own.json();
    const candidate = result.options.find((option: { id: string }) => option.id === f.offerId);
    expect(candidate).toMatchObject({
      id: f.offerId, kind: "household", resource: { coordinates: f.pickup, address: "Private public meeting point from your accepted pickup request" },
    });
    expect(JSON.stringify(candidate)).not.toContain("30.62798"); // Never substitute the city-area marker.

    for (const who of [f.other, undefined]) {
      const hidden = await f.handler(accessRequest({ date: f.date, destinationId: f.offerId }, who));
      expect(hidden.status).toBe(404);
      expect(await hidden.text()).not.toContain(JSON.stringify(f.pickup));
    }
  });

  it("hides the private candidate when acceptance, consent, enrollment, owner separation, or report freshness is revoked", async () => {
    const f = setup();
    const get = () => f.handler(accessRequest({ date: f.date, destinationId: f.offerId }, f.requester));
    const expectHidden = async () => expect((await get()).status).toBe(404);

    // The real schema requires pickup_consent=1; bypass the check in this isolated fixture
    // to exercise the access query's explicit consent predicate as defense in depth.
    f.db.exec("PRAGMA ignore_check_constraints=ON");
    f.db.prepare("UPDATE requests SET pickup_consent=0 WHERE offer_id=?").run(f.offerId);
    f.db.exec("PRAGMA ignore_check_constraints=OFF");
    await expectHidden();
    f.db.prepare("UPDATE requests SET pickup_consent=1 WHERE offer_id=?").run(f.offerId);

    f.db.prepare("UPDATE requests SET status='requested' WHERE offer_id=?").run(f.offerId);
    await expectHidden();
    f.db.prepare("UPDATE requests SET status='accepted' WHERE offer_id=?").run(f.offerId);

    f.db.prepare("UPDATE outreach_recipients SET revoked_at=? WHERE id=?").run(now.toISOString(), f.recipientId);
    await expectHidden();
    f.db.prepare("UPDATE outreach_recipients SET revoked_at=NULL WHERE id=?").run(f.recipientId);

    f.db.prepare("UPDATE records SET status='cancelled' WHERE id=?").run(f.offerId);
    await expectHidden();
    f.db.prepare("UPDATE records SET status='approved' WHERE id=?").run(f.offerId);

    // No block existed, insert one to model either party blocking the other.
    f.db.prepare("INSERT INTO blocks(user_id,blocked_id,created_at) VALUES(?,?,?)").run(f.requester.id, f.donor.id, now.toISOString());
    await expectHidden();
    f.db.prepare("DELETE FROM blocks WHERE user_id=? AND blocked_id=?").run(f.requester.id, f.donor.id);

    f.db.prepare("UPDATE outreach_replies SET expires_at=? WHERE thread_id=(SELECT id FROM outreach_threads WHERE recipient_id=?)").run(new Date(+now - 1000).toISOString(), f.recipientId);
    await expectHidden();
  });

  it("keeps the candidate but withholds routable coordinates if the reviewed reply has no precise pickup point", async () => {
    const f = setup();
    f.db.prepare("UPDATE outreach_replies SET pickup_json=NULL WHERE thread_id=(SELECT id FROM outreach_threads WHERE recipient_id=?)").run(f.recipientId);
    const response = await f.handler(accessRequest({ date: f.date, destinationId: f.offerId }, f.requester));
    expect(response.status).toBe(200);
    const result = await response.json();
    const candidate = result.options.find((option: { id: string }) => option.id === f.offerId);
    expect(candidate?.kind).toBe("household");
    expect(candidate?.resource.coordinates).toBeNull();
    expect(candidate?.resource.address).not.toContain("Bryan, TX");
  });
});
