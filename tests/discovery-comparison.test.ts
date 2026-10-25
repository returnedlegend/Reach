import { expect, it, vi } from "vitest";
import { discoveryComparison } from "../src/lib/discovery-comparison";
import { rankFoodWithAI } from "../src/lib/food-ai-ranking";
import type { Resource } from "../src/data/resources";
const now = new Date("2026-10-25T15:00:00Z");
const resource = (id: string, extra: Partial<Resource> = {}): Resource => ({
  id,
  name: id,
  address: "Bryan, TX",
  city: "Bryan",
  coordinates: null,
  hours: "Unknown",
  eligibility: "Unknown",
  notes: "",
  sources: [],
  verificationStatus: "confirmed-site",
  ...extra,
});
it("awards numeric distance points, never treats unknown distance as zero miles", () => {
  expect(
    discoveryComparison(resource("a"), 0, now).parameters.distancePoints,
  ).toBe(60);
  expect(
    discoveryComparison(resource("a"), 1, now).parameters.distancePoints,
  ).toBe(30);
  expect(
    discoveryComparison(resource("a"), undefined, now).parameters
      .straightLineMiles,
  ).toBeNull();
  expect(
    discoveryComparison(resource("a"), undefined, now).parameters
      .distancePoints,
  ).toBe(0);
});
it("returns three real IDs on provider failure and includes a nearby approved hotspot", async () => {
  const hotspot = resource("pickup", {
    verificationStatus: "needs-confirmation",
    coordinates: { lat: 30.65, lng: -96.35 },
    communityHotspot: {
      recordId: "pickup",
      startsAt: "2026-10-25T14:00:00Z",
      endsAt: "2026-10-25T18:00:00Z",
    },
  });
  const result = await rankFoodWithAI("food in Bryan", {
    resources: [
      resource("far", { coordinates: { lat: 30.9, lng: -96.6 } }),
      resource("b"),
      resource("c"),
      hotspot,
    ],
    origin: { lat: 30.65, lng: -96.35 },
    now,
    generate: async () => {
      throw new Error("offline");
    },
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("No results");
  expect(result.assistance).toBe("directory");
  expect(result.ranking).toHaveLength(3);
  expect(result.ranking[0].id).toBe("pickup");
  expect(result.ranking.every((r) => r.selectedBy === "mathematical")).toBe(
    true,
  );
});
it("fills a partial model selection without pretending the added records were AI selected", async () => {
  const result = await rankFoodWithAI("food in Bryan", {
    resources: ["a", "b", "c"].map((id) => resource(id)),
    now,
    generate: vi.fn().mockResolvedValue({
      status: "available",
      value: { order: ["b"], reason: "schedule" },
      calls: 1,
      model: "fixture",
    }),
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("No results");
  expect(result.ranking).toHaveLength(3);
  expect(result.ranking.find((r) => r.id === "b")?.selectedBy).toBe("ai");
  expect(result.ranking.find((r) => r.id === "a")?.selectedBy).toBe(
    "mathematical",
  );
});

it("scores a currently active published window without waiting for its next recurrence", () => {
  const r = resource("open", {
    publishedScheduleVerified: true,
    windows: [
      {
        id: "sunday",
        rule: { kind: "weekly", weekdays: [0] },
        opens: "09:00",
        closes: "12:00",
        policyKnown: false,
        sourceIds: ["official"],
      },
    ],
  });
  const result = discoveryComparison(r, 1, now); // Sunday 10 am Central
  expect(result.parameters.hoursUntilPublishedPickup).toBe(0);
  expect(result.parameters.schedulePoints).toBe(25);
  expect(r.windows![0].policyKnown).toBe(false);
});
