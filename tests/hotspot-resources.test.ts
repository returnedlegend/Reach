import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { listHotspotResources } from "../src/lib/hotspot-resources";

const databases: DatabaseSync[] = [];
function fixture() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(
    "CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL)",
  );
  return db;
}

function hotspot(overrides: Record<string, unknown> = {}) {
  return {
    title: "Saturday produce table",
    description: "Fresh vegetables while supplies last.",
    startsAt: "2026-06-01T16:00:00.000Z",
    endsAt: "2026-06-01T18:00:00.000Z",
    organizerName: "Community organizer",
    address: "100 Main St, Bryan, TX",
    lat: 30.6744,
    lng: -96.3698,
    foodCategory: "Fresh produce",
    quantityText: "About 20 bags",
    eligibility: "Open to local residents.",
    accessibility: "Step-free entrance reported.",
    contact: "Call me at 979-555-0100",
    pickupInstructions: "Meet beside the community hall.",
    ...overrides,
  };
}

function insert(
  db: DatabaseSync,
  {
    id,
    kind = "hotspot",
    status = "approved",
    data = hotspot(),
    startsAt = "2026-06-01T16:00:00.000Z",
    endsAt = "2026-06-01T18:00:00.000Z",
  }: {
    id: string;
    kind?: string;
    status?: string;
    data?: unknown;
    startsAt?: string;
    endsAt?: string;
  },
) {
  db.prepare(
    "INSERT INTO records(id,kind,status,data,starts_at,ends_at) VALUES(?,?,?,?,?,?)",
  ).run(id, kind, status, JSON.stringify(data), startsAt, endsAt);
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("community hotspot resource adapter", () => {
  it("includes approved active and upcoming hotspots as one-off resources", () => {
    const db = fixture();
    const now = new Date("2026-06-01T15:00:00.000Z");
    insert(db, { id: "active" });
    const future = hotspot({
      title: "Tomorrow's distribution",
      startsAt: "2026-06-02T16:00:00.000Z",
      endsAt: "2026-06-02T18:00:00.000Z",
    });
    insert(db, {
      id: "future",
      data: future,
      startsAt: future.startsAt,
      endsAt: future.endsAt,
    });

    const resources = listHotspotResources(db, now);
    expect(resources.map((resource) => resource.id)).toEqual([
      "community-hotspot:active",
      "community-hotspot:future",
    ]);
    expect(resources[0]).toMatchObject({
      name: "Saturday produce table",
      coordinates: { lat: 30.6744, lng: -96.3698 },
      communityHotspot: {
        recordId: "active",
        startsAt: "2026-06-01T16:00:00.000Z",
        endsAt: "2026-06-01T18:00:00.000Z",
      },
      sources: [
        {
          title: "Community-reported hotspot; not independently verified",
          url: "/food-hotspots",
        },
      ],
    });
    expect(resources[0].hours).toContain("One-time event");
    expect(resources[0].hours).toContain("Jun 1, 2026");
    expect(resources[0].hours).toContain("CDT");
    expect(resources[0].notes).toContain("not been independently verified");
    expect(resources[0].notes).toContain("do not indicate a weekly schedule");
    expect(resources[0].offering).toContain("Organizer-reported food");
    expect(resources[0]).toMatchObject({
      verificationStatus: "needs-confirmation",
      detailsNeedConfirmation: true,
      pedestrianPickup: "unknown",
      accessibility:
        "Accessibility not independently verified. Organizer reports: Step-free entrance reported.",
    });
    expect(resources[0]).not.toHaveProperty("phone");
    expect(resources[0].sources[0]).not.toHaveProperty("checkedOn");
  });

  it("excludes offers, non-approved records, expired events, and invalid rows individually", () => {
    const db = fixture();
    const now = new Date("2026-06-01T15:00:00.000Z");
    insert(db, { id: "offer", kind: "offer" });
    for (const status of ["draft", "pending", "rejected", "cancelled", "ended"])
      insert(db, { id: status, status });
    insert(db, {
      id: "expired",
      endsAt: "2026-06-01T14:59:59.000Z",
    });

    insert(db, { id: "bad-json", data: "{" });
    insert(db, { id: "bad-coordinate", data: hotspot({ lat: 0 }) });
    insert(db, { id: "extra-private-field", data: hotspot({ secret: "x" }) });
    insert(db, {
      id: "bad-time",
      data: hotspot({ startsAt: "tomorrow" }),
    });
    insert(db, {
      id: "mismatched-time",
      data: hotspot({ startsAt: "2026-06-01T17:00:00.000Z" }),
    });
    insert(db, {
      id: "reversed-time",
      data: hotspot({
        startsAt: "2026-06-01T19:00:00.000Z",
        endsAt: "2026-06-01T18:00:00.000Z",
      }),
    });
    const tooLong = hotspot({
      startsAt: "2026-06-01T16:00:00.000Z",
      endsAt: "2026-06-02T17:00:00.000Z",
    });
    insert(db, {
      id: "over-24-hours",
      data: tooLong,
      startsAt: tooLong.startsAt,
      endsAt: tooLong.endsAt,
    });
    const expiredOffset = hotspot({
      startsAt: "2026-06-01T14:00:00+02:00",
      endsAt: "2026-06-01T16:00:00+02:00",
    });
    insert(db, {
      id: "expired-offset",
      data: expiredOffset,
      startsAt: expiredOffset.startsAt,
      endsAt: expiredOffset.endsAt,
    });
    insert(db, { id: "valid" });

    expect(listHotspotResources(db, now).map((resource) => resource.id)).toEqual([
      "community-hotspot:valid",
    ]);
  });
});
