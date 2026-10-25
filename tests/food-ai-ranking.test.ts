import { describe, expect, it, vi } from "vitest";
import { rankFoodWithAI } from "../src/lib/food-ai-ranking";
import type { Resource } from "../src/data/resources";
const site = (id: string, extra: Partial<Resource> = {}): Resource => ({
  id,
  name: `Fixture Pantry ${id}`,
  address: "Bryan, TX",
  city: "Bryan",
  coordinates: null,
  hours: "Tuesday 3–5 PM; appointment required",
  eligibility: "Call to confirm ID requirements.",
  notes: "",
  offering: "Groceries",
  verificationStatus: "confirmed-site",
  pedestrianPickup: "allowed",
  sources: [{ title: "Fixture source", checkedOn: "2026-10-25" }],
  ...extra,
});
const now = new Date("2026-10-25T12:00:00Z");
const response = (ids: string[]) => ({
  status: "available",
  calls: 1,
  model: "fixture",
  value: { order: ids, reason: "requirements" },
});
describe("AI pantry comparisons", () => {
  it("uses model order while explanations are copied from maintained facts", async () => {
    const generate = vi.fn().mockResolvedValue(response(["b", "a"]));
    const result = await rankFoodWithAI("food in Bryan without ID", {
      resources: [site("a"), site("b")],
      now,
      generate,
    });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected comparison");
    expect(result.ranking.map((r) => r.id)).toEqual(["b", "a"]);
    expect(result.ranking[0].reasons[0]).toBe(
      "Call to confirm ID requirements.",
    );
    expect(generate.mock.calls[0][0].prompt).toContain("appointment required");
    expect(generate.mock.calls[0][0].prompt).toContain("Central time");
    expect(generate.mock.calls[0][0].prompt).not.toContain("coordinates");
  });
  it.each([["invented", "a"], ["a", "a"], []])(
    "rejects invented, duplicate or empty IDs %s",
    async (...ids) => {
      const result = await rankFoodWithAI("food in Bryan", {
        resources: [site("a"), site("b")],
        now,
        generate: vi.fn().mockResolvedValue(response(ids)),
      });
      expect(result.status).toBe("available");
      if (result.status === "available") {
        expect(result.assistance).toBe("directory");
        expect(result.ranking.map((item) => item.id)).toEqual(["a", "b"]);
      }
    },
  );
  it("excludes unconfirmed sites and pickup prohibited on foot", async () => {
    const generate = vi.fn().mockResolvedValue(response(["a"]));
    const result = await rankFoodWithAI("food in Bryan walking", {
      resources: [
        site("a"),
        site("unknown", { verificationStatus: "needs-confirmation" }),
        site("car-only", { pedestrianPickup: "not-allowed" }),
      ],
      now,
      generate,
    });
    expect(result.status).toBe("available");
    expect(generate.mock.calls[0][0].prompt).not.toContain("car-only");
    expect(generate.mock.calls[0][0].prompt).not.toContain('"id":"unknown"');
  });
  it("never sends private locations for comparison", async () => {
    const generate = vi.fn();
    expect(
      (
        await rankFoodWithAI("I live at 123 Main Street", {
          resources: [site("a")],
          generate,
        })
      ).status,
    ).toBe("unavailable");
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not compare geographic alternatives as matching sites", async () => {
    const generate = vi.fn();
    expect(
      (
        await rankFoodWithAI("food in Seattle", {
          resources: [site("a")],
          generate,
        })
      ).status,
    ).toBe("unavailable");
    expect(generate).not.toHaveBeenCalled();
  });
  it("preserves provider outage rather than labeling directory order as AI", async () => {
    const generate = vi.fn().mockResolvedValue({
      status: "unavailable",
      reason: "Local model unavailable",
      calls: 1,
    });
    expect(
      await rankFoodWithAI("food in Bryan", {
        resources: [site("a")],
        generate,
      }),
    ).toMatchObject({
      status: "available",
      assistance: "directory",
      message: "Local model unavailable",
    });
  });
  it("rejects generated prose and returns mathematical matches", async () => {
    const fake = response(["a"]);
    fake.value.reason = "Food guaranteed";
    const result = await rankFoodWithAI("food in Bryan", {
      resources: [site("a")],
      now,
      generate: vi.fn().mockResolvedValue(fake),
    });
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.assistance).toBe("directory");
      expect(JSON.stringify(result.ranking)).not.toContain("Food guaranteed");
    }
  });
});

it("fills partial model responses with mathematical matches", async () => {
  const result = await rankFoodWithAI("food in Bryan", {
    resources: [site("a"), site("b")],
    generate: vi.fn().mockResolvedValue(response(["b"])),
  });
  expect(result.status).toBe("available");
  if (result.status === "available")
    expect(result.ranking.map((r) => r.id)).toEqual(["b", "a"]);
});

it("excludes known weekday mismatches before asking the model", async () => {
  const window = (day: number) => ({
    id: "fixture",
    rule: { kind: "weekly" as const, weekdays: [day] },
    opens: "09:00",
    closes: "11:00",
    policyKnown: true,
    sourceIds: [],
  });
  const generate = vi.fn().mockResolvedValue(response(["sat"]));
  const result = await rankFoodWithAI(
    "food in Bryan. I can only collect food on Saturday.",
    {
      resources: [
        site("wed", { windows: [window(3)] }),
        site("sat", { windows: [window(6)] }),
      ],
      now,
      generate,
    },
  );
  expect(result.status).toBe("available");
  expect(generate.mock.calls[0][0].prompt).not.toContain('"id":"wed"');
});

it("keeps both explicitly allowed weekdays and preserves unknown schedules", async () => {
  const window = (day: number) => ({
    id: "fixture",
    rule: { kind: "weekly" as const, weekdays: [day] },
    opens: "09:00",
    closes: "11:00",
    policyKnown: true,
    sourceIds: [],
  });
  const generate = vi
    .fn()
    .mockResolvedValue(response(["sat", "sun", "unknown"]));
  const result = await rankFoodWithAI(
    "food in Bryan. I can only go Saturday or Sunday.",
    {
      resources: [
        site("sat", { windows: [window(6)] }),
        site("sun", { windows: [window(0)] }),
        site("unknown"),
      ],
      now,
      generate,
    },
  );
  expect(result.status).toBe("available");
  expect(generate.mock.calls[0][0].prompt).toContain(
    "Next pickup window not verified",
  );
});

describe("approved community hotspots in AI comparison", () => {
  const hotspot = site("community-hotspot:fixture", {
    name: "Fixture community groceries",
    verificationStatus: "needs-confirmation",
    pedestrianPickup: "unknown",
    communityHotspot: {
      recordId: "fixture",
      startsAt: "2026-10-25T13:00:00Z",
      endsAt: "2026-10-25T15:00:00Z",
    },
    hours: "Organizer reports one-time Sunday pickup; confirm before visiting.",
  });
  it("offers an approved hotspot even when six confirmed sites precede it, with honest model evidence", async () => {
    const generate = vi.fn().mockResolvedValue(response([hotspot.id]));
    const result = await rankFoodWithAI("food in Bryan", {
      resources: [
        ...Array.from({ length: 8 }, (_, i) => site(String(i))),
        hotspot,
      ],
      now,
      generate,
    });
    expect(result.status).toBe("available");
    if (result.status !== "available")
      throw new Error("Expected AI comparison");
    expect(result.ranking[0].id).toBe(hotspot.id);
    const prompt = generate.mock.calls[0][0].prompt;
    expect(prompt).toContain(hotspot.id);
    expect(prompt).toContain("not independently verified");
    expect(prompt).toContain("Organizer-reported");
  });
  it("excludes expired and day-incompatible hotspots from the model candidate set", async () => {
    const generate = vi.fn();
    const expired = await rankFoodWithAI("food in Bryan", {
      resources: [hotspot],
      now: new Date("2026-10-25T15:00:00Z"),
      generate,
    });
    expect(expired.status).toBe("unavailable");
    const wrongDay = await rankFoodWithAI("food in Bryan only Tuesday", {
      resources: [hotspot],
      now,
      generate,
    });
    expect(wrongDay.status).toBe("unavailable");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("household offer AI comparisons", () => {
  it("lets the model choose an approved offer while retaining hotspot and pantry candidates", async () => {
    const offer = site("community-offer:fixture", {
      coordinates: null,
      verificationStatus: "needs-confirmation",
      pedestrianPickup: "unknown",
      city: "Bryan",
      communityOffer: {
        recordId: "fixture",
        startsAt: "2026-10-25T13:00:00Z",
        endsAt: "2026-10-25T15:00:00Z",
      },
      offering: "Sealed groceries. Allergens: wheat. Storage: keep dry.",
    });
    const hotspot = site("community-hotspot:fixture", {
      verificationStatus: "needs-confirmation",
      communityHotspot: {
        recordId: "hotspot",
        startsAt: "2026-10-25T13:00:00Z",
        endsAt: "2026-10-25T15:00:00Z",
      },
    });
    const generate = vi
      .fn()
      .mockResolvedValue(response([offer.id, hotspot.id]));
    const result = await rankFoodWithAI("food in Bryan", {
      resources: [
        ...Array.from({ length: 8 }, (_, i) => site(String(i))),
        hotspot,
        offer,
      ],
      now,
      generate,
    });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected comparison");
    expect(result.ranking[0].id).toBe(offer.id);
    const prompt = generate.mock.calls[0][0].prompt;
    expect(prompt).toContain(hotspot.id);
    expect(prompt).toContain("Exact pickup location is private");
    expect(prompt).toContain("Allergens: wheat");
    expect(prompt).not.toContain("coordinates");
    const expired = await rankFoodWithAI("food in Bryan", {
      resources: [offer],
      now: new Date("2026-10-25T15:00:00Z"),
      generate,
    });
    expect(expired.status).toBe("unavailable");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

it("uses selected origin for approximate proximity without exposing coordinates to the model", async () => {
  const generate = vi.fn().mockResolvedValue(response(["near"]));
  await rankFoodWithAI("food in Bryan", {
    resources: [
      site("near", { coordinates: { lat: 30.67123, lng: -96.37123 } }),
    ],
    origin: { lat: 30.67123, lng: -96.37123 },
    now,
    generate,
  });
  const prompt = generate.mock.calls[0][0].prompt;
  expect(prompt).toContain("0.0 straight-line miles");
  expect(prompt).not.toContain("30.67123");
  expect(prompt).not.toContain("-96.37123");
});

it("returns only the top three validated model selections", async () => {
  const generate = vi.fn().mockResolvedValue(response(["d", "b", "a", "c"]));
  const result = await rankFoodWithAI("food in Bryan", {
    resources: ["a", "b", "c", "d"].map((id) => site(id)),
    now,
    generate,
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected comparison");
  expect(result.ranking.map((item) => item.id)).toEqual(["d", "b", "a"]);
  expect(result.ranking.every((item) => item.reasons.length > 0)).toBe(true);
  expect(generate.mock.calls[0][0].prompt).toContain(
    "Select up to three real IDs",
  );
});

it("uses measured travel scores over model order and excludes checked infeasible trips", async () => {
  const access = (id: string, travel: number, status: "fits" | "no" = "fits") =>
    ({
      id,
      status,
      outbound: { mode: "transit", source: "scheduled" },
      scoreBreakdown: {
        closingBufferBonus: 0,
        travelPenalty: travel,
        walkingPenalty: 0,
        farePenalty: 0,
        transferPenalty: 0,
        uncertaintyPenalty: 0,
        waitingPenalty: 0,
        serviceDelayPenalty: 0,
        totalTravelMinutes: travel,
        totalWalkingMinutes: 0,
        totalTransfers: 0,
        totalFare: null,
      },
    }) as import("../src/lib/access-types").AccessOption;
  const generate = vi
    .fn()
    .mockResolvedValue(response(["slow", "blocked", "fast"]));
  const result = await rankFoodWithAI("food in Bryan by bus", {
    resources: ["slow", "blocked", "fast"].map((id) => site(id)),
    now,
    generate,
    accessOptions: [
      access("slow", 60),
      access("fast", 15),
      access("blocked", 5, "no"),
    ],
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected comparison");
  expect(result.ranking.map((item) => item.id)).toEqual(["fast", "slow"]);
  expect(result.ranking[0].comparison?.score).toBe(-15);
  expect(generate.mock.calls[0][0].prompt).toContain("travelMinutes");
});

it("returns short generated summaries attached to real final options", async () => {
  const generate = vi.fn().mockResolvedValue({
    ...response(["a"]),
    value: {
      order: ["a"],
      reason: "requirements",
      summaries: [
        {
          id: "a",
          text: "This option lists groceries, but check the appointment requirement before traveling.",
        },
      ],
    },
  });
  const result = await rankFoodWithAI("food in Bryan", {
    resources: [site("a")],
    now,
    generate,
  });
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Missing result");
  expect(result.summary).toEqual([
    {
      id: "a",
      name: "Fixture Pantry a",
      text: "This option lists groceries, but check the appointment requirement before traveling.",
    },
  ]);
});
it.each([
  { id: "invented", text: "Visit this invented site." },
  { id: "a", text: "Food is guaranteed here." },
  { id: "a", text: "<script>unsafe</script>" },
])(
  "discards invalid generated summaries while preserving real ranked options",
  async (summary) => {
    const generate = vi.fn().mockResolvedValue({
      ...response(["a"]),
      value: { order: ["a"], reason: "schedule", summaries: [summary] },
    });
    const result = await rankFoodWithAI("food in Bryan", {
      resources: [site("a")],
      now,
      generate,
    });
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Missing result");
    expect(result.summary).toEqual([]);
    expect(result.ranking[0].id).toBe("a");
  },
);
