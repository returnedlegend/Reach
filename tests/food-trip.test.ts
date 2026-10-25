import { describe, expect, it } from "vitest";
import { foodTripInput, foodTripIsFresh } from "../src/lib/food-trip";
import { foodCheckFixture } from "./fixtures/food-check";
import { localFoodIntent, discoverFood } from "../src/lib/simple-food";
import { foodResources } from "../src/data/resources";
const point = { lat: 30.65, lng: -96.35 };
const now = new Date("2026-10-26T15:30:00Z");
describe("request to trip constraints without an intake form", () => {
  it("uses the actual selected point and Chicago date/time without storing it", () => {
    const { input, assumptions } = foodTripInput(point, "transit", "food", now);
    expect(input.origin).toEqual(point);
    expect(input.origin).not.toBe(point);
    expect(input.date).toBe("2026-10-26");
    expect(input.departure).toBe("10:30");
    expect(input.appointment).toBe("unknown");
    expect(input.eligibilityConfirmed).toBe(false);
    expect(assumptions.join(" ")).toContain("One-way trip only");
  });
  it.each([
    ["half a mile", 0.5],
    ["quarter mile", 0.25],
    ["0.5 miles", 0.5],
    [".5 miles", 0.5],
    ["2 miles", 2],
    ["1/2 mile", 0.5],
    ["1/4 mile", 0.25],
    ["3/4 mile", 0.75],
    ["1 1/2 miles", 1.5],
  ])("understands a stated walking limit: %s", (distance, value) => {
    const text = `I can only walk about ${distance}`;
    expect(
      foodTripInput(point, "walking", text, now).input.maxWalkingMiles,
    ).toBe(value);
    expect(
      discoverFood(foodResources, `I cannot walk more than ${distance}`, {
        mode: "walking",
      }).blockedMode,
    ).toBe(false);
  });
  it("carries explicit no appointment, fare, transfers and mobility restrictions", () => {
    const { input } = foodTripInput(
      point,
      "transit",
      "I can walk 10 minutes, no appointment, budget $2, no transfers, wheelchair",
      now,
    );
    expect(input).toMatchObject({
      maxWalkingMinutes: 10,
      appointment: "not-booked",
      fareBudget: 2,
      maxTransfers: 0,
      mobility: "step-free",
    });
    expect(input.eligibilityConfirmed).toBe(false);
    expect(
      foodTripInput(
        point,
        "walking",
        "Find options that don't require an appointment",
        now,
      ).input.appointment,
    ).toBe("not-booked");
  });
  it("does not invent a car for a user who does not have one", () => {
    expect(localFoodIntent("I don't have a car").mode).toBe("transit");
    expect(
      localFoodIntent("I don't have a car and cannot use a bus").mode,
    ).toBeUndefined();
  });
  it("does not silently give a fare budget or walking ability the person rejected", () => {
    expect(
      foodTripInput(point, "transit", "I have no money", now).input.fareBudget,
    ).toBe(0);
    expect(
      foodTripInput(point, "walking", "I can't walk far", now).clarification,
    ).toBeTruthy();
    expect(
      foodTripInput(point, "walking", "I can only walk 1/2 minute", now)
        .clarification,
    ).toBeTruthy();
  });
  it("models an explicitly requested same-origin return without moving a past deadline to tomorrow", () => {
    const { input } = foodTripInput(
      point,
      "walking",
      "I need to be back by 4pm",
      now,
    );
    expect(input.returnTo).toEqual(point);
    expect(input.returnDeadline).toBe("16:00");
    expect(
      foodTripInput(point, "walking", "back by 9am", now).input.returnDeadline,
    ).toBe("09:00");
    const ambiguous = foodTripInput(point, "walking", "back by 4", now);
    expect(ambiguous.input.returnDeadline).toBeUndefined();
    expect(ambiguous.assumptions.join(" ")).toContain(
      "Return time was unclear",
    );
  });
  it.each([
    "must return home before 4pm",
    "back at 4pm",
    "need to be home by 16:00",
  ])("keeps an explicitly requested return: %s", (text) => {
    expect(
      foodTripInput(point, "walking", text, now).input.returnDeadline,
    ).toBe("16:00");
  });
  it.each([
    "food tomorrow at 2pm",
    "food on Monday",
    "round trip",
    "must return home",
    "food leaving at 3pm",
  ])(
    "does not silently turn an unsupported request into a now/one-way trip: %s",
    (text) => {
      expect(
        foodTripInput(point, "walking", text, now).clarification,
      ).toBeTruthy();
    },
  );
  it("expires a trip check and refuses a scheduled departure that has already passed", () => {
    const fixture = foodCheckFixture();
    expect(foodTripIsFresh(fixture, now)).toBe(true);
    expect(foodTripIsFresh(fixture, new Date(+now + 60_000))).toBe(false);
    expect(foodTripIsFresh({ ...fixture, searchedAt: "invalid" }, now)).toBe(
      false,
    );
    const transit = foodCheckFixture("transit");
    expect(foodTripIsFresh(transit, now)).toBe(true);
    const departed = { ...transit, searchedAt: "2026-10-26T15:31:01Z" };
    expect(foodTripIsFresh(departed, new Date("2026-10-26T15:31:02Z"))).toBe(
      false,
    );
  });
});
