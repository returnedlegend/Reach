import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { listOfferResources } from "../src/lib/offer-resources";

const databases: DatabaseSync[] = [];
function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`
    CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL);
    CREATE TABLE requests(id TEXT PRIMARY KEY,offer_id TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE volunteer_runs(offer_id TEXT NOT NULL,status TEXT NOT NULL);
  `);
  return db;
}

function offer(overrides: Record<string, unknown> = {}) {
  return {
    title: "Sealed pantry bundle",
    description: "Three sealed grocery items available.",
    startsAt: "2026-06-01T16:00:00.000Z",
    endsAt: "2026-06-01T18:00:00.000Z",
    pickupAreaId: "bryan",
    quantity: 3,
    allergens: "Contains wheat",
    storage: "Keep in a cool, dry place",
    useBy: "2026-06-01",
    foodCategory: "dry-groceries",
    labelsIntact: true,
    noExcludedProducts: true,
    sealed: true,
    shelfStable: true,
    notHomemade: true,
    packagingUndamaged: true,
    notRecalled: true,
    privatePickupInstructions: "Private meeting instructions",
    pickupIsPublicPlace: true,
    sharePickupInstructions: false,
    ...overrides,
  };
}

function insert(
  db: DatabaseSync,
  {
    id,
    kind = "offer",
    status = "approved",
    data = offer(),
    startsAt,
    endsAt,
  }: {
    id: string;
    kind?: string;
    status?: string;
    data?: unknown;
    startsAt?: string;
    endsAt?: string;
  },
) {
  const payload = data as Record<string, unknown>;
  db.prepare(
    "INSERT INTO records(id,kind,status,data,starts_at,ends_at) VALUES(?,?,?,?,?,?)",
  ).run(
    id,
    kind,
    status,
    typeof data === "string" ? data : JSON.stringify(data),
    startsAt ??
      (typeof payload.startsAt === "string"
        ? payload.startsAt
        : "2026-06-01T16:00:00.000Z"),
    endsAt ??
      (typeof payload.endsAt === "string"
        ? payload.endsAt
        : "2026-06-01T18:00:00.000Z"),
  );
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("community offer resource adapter", () => {
  it("publishes approved offers with area-only location and an explicit safety disclaimer", () => {
    const db = fixture();
    insert(db, { id: "public" });
    const resources = listOfferResources(
      db,
      new Date("2026-06-01T15:00:00.000Z"),
    );
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      id: "community-offer:public",
      name: "Sealed pantry bundle",
      address: expect.stringContaining("Bryan — approximate area"),
      city: "Bryan",
      coordinates: null,
      offering: expect.stringContaining("Allergens: Contains wheat"),
      verificationStatus: "needs-confirmation",
      detailsNeedConfirmation: true,
      pedestrianPickup: "unknown",
      communityOffer: {
        recordId: "public",
        startsAt: "2026-06-01T16:00:00.000Z",
        endsAt: "2026-06-01T18:00:00.000Z",
      },
    });
    expect(resources[0].address).toContain("arranged after acceptance");
    expect(resources[0].offering).toContain("quantity: 3");
    expect(resources[0].offering).toContain(
      "Storage: Keep in a cool, dry place",
    );
    expect(resources[0].offering).toContain("Use by: 2026-06-01");
    expect(resources[0].hours).toContain(
      "Safety and availability are not verified",
    );
    expect(resources[0].notes).toContain("Check allergens and packaging");
    const serialized = JSON.stringify(resources[0]);
    expect(serialized).not.toContain("Private meeting instructions");
    expect(serialized).not.toContain("privatePickupInstructions");
    expect(serialized).not.toContain("sharePickupInstructions");
    expect(serialized).not.toMatch(/ownerId|owner_id|email|actuallocation/i);
    expect(resources[0].coordinates).toBeNull();
  });

  it("omits non-approved, expired, accepted, and volunteer-run offers", () => {
    const db = fixture();
    const now = new Date("2026-06-01T15:00:00.000Z");
    insert(db, { id: "valid" });
    insert(db, { id: "pending", status: "pending" });
    insert(db, { id: "expired", endsAt: "2026-06-01T14:59:59.000Z" });
    insert(db, { id: "reserved" });
    db.prepare(
      "INSERT INTO requests(id,offer_id,status) VALUES('request','reserved','accepted')",
    ).run();
    insert(db, { id: "volunteer" });
    db.prepare(
      "INSERT INTO volunteer_runs(offer_id,status) VALUES('volunteer','open')",
    ).run();
    insert(db, { id: "completed-volunteer" });
    db.prepare(
      "INSERT INTO volunteer_runs(offer_id,status) VALUES('completed-volunteer','completed')",
    ).run();
    expect(listOfferResources(db, now).map((resource) => resource.id)).toEqual([
      "community-offer:completed-volunteer",
      "community-offer:valid",
    ]);
  });

  it("drops malformed, unsafe, mismatched, and use-by-invalid payloads individually", () => {
    const db = fixture();
    const now = new Date("2026-06-01T15:00:00.000Z");
    insert(db, { id: "valid" });
    insert(db, { id: "bad-json", data: "{" });
    insert(db, {
      id: "unknown-field",
      data: offer({ ownerEmail: "private@example.test" }),
    });
    insert(db, { id: "not-sealed", data: offer({ sealed: false }) });
    insert(db, { id: "homemade", data: offer({ notHomemade: false }) });
    insert(db, {
      id: "invalid-area",
      data: offer({ pickupAreaId: "downtown" }),
    });
    insert(db, { id: "invalid-use-by", data: offer({ useBy: "2026-02-31" }) });
    insert(db, {
      id: "use-by-before-end",
      data: offer({ useBy: "2026-05-31" }),
    });
    insert(db, {
      id: "mismatched-time",
      data: offer({ startsAt: "2026-06-01T17:00:00.000Z" }),
      startsAt: "2026-06-01T16:00:00.000Z",
    });
    expect(listOfferResources(db, now).map((resource) => resource.id)).toEqual([
      "community-offer:valid",
    ]);
  });

  it("compares use-by against the pickup end date in America/Chicago", () => {
    const db = fixture();
    const eastern = offer({
      startsAt: "2026-06-02T04:00:00.000Z",
      endsAt: "2026-06-02T04:59:00.000Z",
      useBy: "2026-06-01",
    });
    insert(db, { id: "local-june-first", data: eastern });
    expect(
      listOfferResources(db, new Date("2026-06-01T00:00:00.000Z")).map(
        (r) => r.id,
      ),
    ).toEqual(["community-offer:local-june-first"]);
  });
});
