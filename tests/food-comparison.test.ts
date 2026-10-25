import { expect, it } from "vitest";
import { foodComparison } from "../src/lib/food-comparison";
import type { AccessOption } from "../src/lib/access-types";
const option = {
  status: "fits",
  outbound: { mode: "transit", source: "scheduled", distanceMiles: 4 },
  scoreBreakdown: {
    closingBufferBonus: 6,
    travelPenalty: 30,
    walkingPenalty: 20,
    farePenalty: 4,
    transferPenalty: 8,
    uncertaintyPenalty: 0,
    waitingPenalty: 0,
    serviceDelayPenalty: 0,
    totalTravelMinutes: 30,
    totalWalkingMinutes: 10,
    totalTransfers: 1,
    totalFare: 1,
  },
} as AccessOption;
it("calculates auditable transit comparison points", () => {
  const result = foodComparison(option);
  expect(result.score).toBe(-56);
  expect(result.parameters.source).toBe("scheduled");
  expect(result.parameters.routedMiles).toBe(4);
  expect(result.parameters.transfers).toBe(1);
});
it("penalizes harder trips and uncertainty rather than trusting the model", () => {
  const more = {
    ...option,
    scoreBreakdown: {
      ...option.scoreBreakdown!,
      transferPenalty: 16,
      walkingPenalty: 40,
      uncertaintyPenalty: 12,
    },
  };
  expect(foodComparison(more).score).toBe(-96);
});
it("does not invent scores for unavailable trips or data", () => {
  expect(foodComparison().score).toBeNull();
  expect(foodComparison({ ...option, status: "no" }).score).toBeNull();
  expect(foodComparison({ ...option, outbound: null }).score).toBeNull();
  expect(
    foodComparison({
      ...option,
      scoreBreakdown: { ...option.scoreBreakdown!, travelPenalty: NaN },
    }).score,
  ).toBeNull();
});
