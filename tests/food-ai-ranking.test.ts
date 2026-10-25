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
      expect(result.status).toBe("unavailable");
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
      status: "unavailable",
      message: "Local model unavailable",
    });
  });
  it("rejects generated prose instead of allowing ungrounded reasons", async () => {
    const fake = response(["a"]);
    fake.value.reason = "Food guaranteed";
    expect(
      (
        await rankFoodWithAI("food in Bryan", {
          resources: [site("a")],
          generate: vi.fn().mockResolvedValue(fake),
        })
      ).status,
    ).toBe("unavailable");
  });
});

it("allows the model to shortlist a suitable subset instead of forcing poor matches", async () => {
  const result = await rankFoodWithAI("food in Bryan", {
    resources: [site("a"), site("b")],
    generate: vi.fn().mockResolvedValue(response(["b"])),
  });
  expect(result.status).toBe("available");
  if (result.status === "available")
    expect(result.ranking.map((r) => r.id)).toEqual(["b"]);
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
