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

describe("assistant negated travel preferences", () => {
  it.each([
    ["I cannot take the bus; I can walk", "walking"],
    ["I cannot walk to a bus stop, but can drive", "driving"],
    ["I do not want public transit. I prefer walking", "walking"],
    ["I can walk to the bus stop", "walking"],
    ["I do not take buses, I drive", "driving"],
    ["I don't want to walk; I can drive", "driving"],
    ["Walking is not possible. I can use the bus", "transit"],
    ["The bus isn't an option; I am driving", "driving"],
    ["I can't drive but I can walk", "walking"],
    ["I do not want to use the bus. Walking is fine", "walking"],
  ])("does not turn a rejected mode into a preference: %s", (text, mode) => {
    expect(localAssistantPreferences(text).mode).toBe(mode);
  });
  it.each([
    "I don't want to walk",
    "Walking is not possible",
    "I cannot use public transit",
    "I have no car and cannot take the bus",
    "No bus",
    "I can't drive",
  ])("keeps the selected mode when no alternative is stated: %s", (text) => {
    expect(localAssistantPreferences(text).mode).toBeUndefined();
  });
  it.each([
    "I can't walk more than 20 minutes",
    "I cannot walk 20 minutes",
    "I cannot walk a mile",
    "I cannot walk without assistance",
    "I cannot walk far",
    "I can't walk to the bus stop",
  ])(
    "does not invent a zero walking limit from a qualified limitation: %s",
    (text) => {
      expect(localAssistantPreferences(text).maxWalkingMinutes).toBeUndefined();
      expect(localAssistantPreferences(text).maxWalkingMiles).toBeUndefined();
    },
  );
  it("handles typographic contractions and an absolute walking restriction", () => {
    expect(
      localAssistantPreferences("I can\u2019t walk, but I can take the bus"),
    ).toEqual({
      mode: "transit",
      maxWalkingMinutes: 0,
      maxWalkingMiles: 0,
    });
  });
});
