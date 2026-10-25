import { describe, expect, it, vi } from "vitest";
import { createFoodPlanHandler } from "../src/lib/food-plan-service";
import { foodResources } from "../src/data/resources";
const origin = { lat: 30.6501234, lng: -96.3505678 };
const now = () => new Date("2026-10-26T15:30:00Z");
const request = (body: unknown, from = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/food-search/plan", {
    method: "POST",
    headers: { Origin: from, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("simple food planning reuses the deterministic engine", () => {
  it("scopes comparisons to current search matches and preserves selected coordinates and constraints", async () => {
    let forwarded:
      | { input: Record<string, unknown>; explain: boolean }
      | undefined;
    const planFactory = vi.fn(() => async (req: Request) => {
      forwarded = await req.json();
      return Response.json({
        options: [],
        recommendation: { selectedId: null },
        message: "Fixture result",
      });
    });
    const result = await createFoodPlanHandler(undefined, {
      resources: () => foodResources,
      now,
      planFactory,
    })(
      request({
        origin,
        mode: "transit",
        message:
          "Food in Bryan, I can only walk half a mile, no appointment, back by 4pm",
      }),
    );
    expect(result.status).toBe(200);
    expect(forwarded?.input).toMatchObject({
      origin,
      maxWalkingMiles: 0.5,
      appointment: "not-booked",
      returnTo: origin,
      returnDeadline: "16:00",
    });
    expect(forwarded?.explain).toBe(false);
    const options = planFactory.mock.calls[0] as unknown as [
      unknown,
      { pantryIds: Set<string>; pantriesOnly: boolean },
    ];
    expect(options[1].pantriesOnly).toBe(true);
    expect(
      [...options[1].pantryIds].every((id) =>
        foodResources.find((r) => r.id === id)!.address.includes("Bryan"),
      ),
    ).toBe(true);
    expect((await result.json()).assumptions.length).toBeGreaterThan(0);
  });
  it.each([
    "I need food and cannot walk",
    "food in Boston",
    "I need hot meals",
  ])(
    'does not produce an unrelated or contradicted trip for "%s"',
    async (message) => {
      const planFactory = vi.fn();
      const result = await createFoodPlanHandler(undefined, {
        resources: () => foodResources,
        now,
        planFactory,
      })(request({ origin, mode: "walking", message }));
      expect((await result.json()).recommendation.selectedId).toBeNull();
      expect(planFactory).not.toHaveBeenCalled();
    },
  );
  it("asks for a clear return time instead of approving an untested round trip", async () => {
    const planFactory = vi.fn();
    const result = await createFoodPlanHandler(undefined, { planFactory })(
      request({ origin, mode: "walking", message: "food, back by 4" }),
    );
    expect((await result.json()).clarification).toContain("am or pm");
    expect(planFactory).not.toHaveBeenCalled();
  });
  it.each(["food tomorrow at 2pm", "food on Monday", "I need a round trip"])(
    "requests clarification rather than silently replacing a time/return constraint: %s",
    async (message) => {
      const planFactory = vi.fn();
      const result = await createFoodPlanHandler(undefined, { planFactory })(
        request({ origin, mode: "walking", message }),
      );
      expect((await result.json()).clarification).toBeTruthy();
      expect(planFactory).not.toHaveBeenCalled();
    },
  );
  it("requires an explicit valid coordinate and same-origin request", async () => {
    const handler = createFoodPlanHandler();
    expect(
      (
        await handler(
          request({
            origin: { lat: 91, lng: 0 },
            mode: "walking",
            message: "food",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await handler(request({ mode: "walking", message: "food in Bryan" })))
        .status,
    ).toBe(400);
    expect(
      (
        await handler(
          request(
            { origin, mode: "walking", message: "food" },
            "https://outside.example",
          ),
        )
      ).status,
    ).toBe(403);
  });
});
