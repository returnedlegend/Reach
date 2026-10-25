import type { AccessOption } from "./access-types";

export type FoodComparison = {
  status: "fits" | "confirm" | "no" | "unknown";
  score: number | null;
  explanation: string;
  parameters: Record<string, number | string | null>;
};
/** Server-calculated comparison points, not a probability or a travel estimate. */
export function foodComparison(option?: AccessOption): FoodComparison {
  const b = option?.scoreBreakdown;
  if (!option || !b || !option.outbound || option.status === "no")
    return {
      status: option?.status === "no" ? "no" : "unknown",
      score: null,
      explanation:
        option?.status === "no"
          ? "No feasible trip under the checked constraints."
          : "Travel feasibility unknown. No mathematical travel score is available.",
      parameters: {},
    };
  const score =
    b.closingBufferBonus -
    b.travelPenalty -
    b.walkingPenalty -
    b.farePenalty -
    b.transferPenalty -
    b.uncertaintyPenalty -
    b.waitingPenalty -
    b.serviceDelayPenalty;
  if (!Number.isFinite(score)) return foodComparison();
  return {
    status: option.status,
    score: Math.round(score * 10) / 10,
    explanation:
      "Higher points are better. Score = closing buffer bonus − travel − walking − fare − transfers − uncertainty − waiting − service-delay penalties. Negative scores are normal; this is not a percentage.",
    parameters: {
      mode: option.outbound.mode ?? "unknown",
      source: option.outbound.source,
      travelMinutes: b.totalTravelMinutes,
      walkingMinutes: b.totalWalkingMinutes,
      transfers: b.totalTransfers,
      fareDollars: b.totalFare,
      routedMiles: option.outbound.distanceMiles ?? null,
      closingBufferBonus: b.closingBufferBonus,
      travelPenalty: b.travelPenalty,
      walkingPenalty: b.walkingPenalty,
      farePenalty: b.farePenalty,
      transferPenalty: b.transferPenalty,
      uncertaintyPenalty: b.uncertaintyPenalty,
      waitingPenalty: b.waitingPenalty,
      serviceDelayPenalty: b.serviceDelayPenalty,
    },
  };
}
