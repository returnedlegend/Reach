import { describe, it, expect } from "vitest";
import {
  explicitDeparture,
  localAssistantPreferences,
} from "../src/lib/reach-assistant";
describe("assistant explicit time and travel capability semantics", () => {
  it("uses stated departure clocks but never substitutes closing or return times", () => {
    expect(explicitDeparture("leave at 6 PM")).toBe("18:00");
    expect(explicitDeparture("18:30")).toBe("18:30");
    expect(explicitDeparture("6 PM")).toBe("18:00");
    expect(explicitDeparture("Which pantry opens at 9 AM?")).toBeUndefined();
    expect(explicitDeparture("I must be back by 6 PM")).toBeUndefined();
    expect(explicitDeparture("this evening")).toBeUndefined();
  });
  it("does not infer driving from the lack of a car and honors inability to walk", () => {
    expect(localAssistantPreferences("I don't have a car")).toEqual({
      mode: "transit",
    });
    expect(
      localAssistantPreferences("I can't walk, and I can use the bus"),
    ).toMatchObject({
      mode: "transit",
      maxWalkingMinutes: 0,
      maxWalkingMiles: 0,
    });
    expect(
      localAssistantPreferences("Which pantry is open right now?"),
    ).toEqual({ allowWaiting: false });
  });
});
