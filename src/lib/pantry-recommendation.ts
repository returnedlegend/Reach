import type { AccessCandidate } from "./access-engine";
import type {
  AccessInput,
  AccessOption,
  AccessResponse,
  PantryRecommendation,
} from "./access-types";
import { shortlistMiles } from "./access-routing";
import { validCoordinates } from "./journey";

/** Route order is an API-budget heuristic, never a walking-distance estimate. */
export function prioritizePantryCandidates(
  candidates: AccessCandidate[],
  input: AccessInput,
) {
  return [...candidates].sort((a, b) => {
    const trusted = (c: AccessCandidate) =>
      Number(
        c.resource.verificationStatus === "confirmed-site" &&
          validCoordinates(c.resource.coordinates),
      );
    return (
      trusted(b) - trusted(a) ||
      Number(b.pantry.windows.length > 0) -
        Number(a.pantry.windows.length > 0) ||
      Number(Boolean(a.resource.detailsNeedConfirmation)) -
        Number(Boolean(b.resource.detailsNeedConfirmation)) ||
      (a.resource.coordinates
        ? shortlistMiles(input.origin, a.resource.coordinates)
        : Infinity) -
        (b.resource.coordinates
          ? shortlistMiles(input.origin, b.resource.coordinates)
          : Infinity) ||
      a.resource.id.localeCompare(b.resource.id)
    );
  });
}
const rank = { fits: 0, confirm: 1, no: 2 };
const costs = (o: AccessOption) => {
  const s = o.scoreBreakdown!;
  return [
    s.travelPenalty,
    s.walkingPenalty,
    s.farePenalty,
    s.transferPenalty,
    s.uncertaintyPenalty,
    s.waitingPenalty,
    s.serviceDelayPenalty,
    -s.closingBufferBonus,
  ];
};
/** All dimensions are the actual configured comparison costs, not inferred stock. */
function dominates(a: AccessOption, b: AccessOption) {
  if (rank[a.status] !== rank[b.status]) return rank[a.status] < rank[b.status];
  const x = costs(a),
    y = costs(b);
  return x.every((v, i) => v <= y[i]) && x.some((v, i) => v < y[i]);
}
export function recommendPantry(
  result: AccessResponse,
  input: AccessInput,
  search: {
    siteLimit: number;
    routeLimitReached: boolean;
    destinationId?: string;
  },
): PantryRecommendation {
  const all = result.options.filter((o) => o.kind === "pantry");
  const scope = search.destinationId
    ? all.filter((o) => o.id === search.destinationId)
    : all;
  const verified = scope.filter(
    (o) =>
      o.resource.verificationStatus === "confirmed-site" &&
      validCoordinates(o.resource.coordinates),
  );
  const usable = verified.filter(
    (o) =>
      o.status !== "no" &&
      o.outbound &&
      o.serviceStart !== null &&
      o.serviceEnd !== null &&
      (!input.returnTo || o.returnJourney) &&
      o.scoreBreakdown &&
      Number.isFinite(o.score),
  );
  usable.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      b.score - a.score ||
      a.id.localeCompare(b.id),
  );
  const selected = usable[0];
  const frontier = usable.filter(
    (o) => !usable.some((other) => other !== o && dominates(other, o)),
  );
  const unresolved = verified.filter(
    (o) =>
      o.status !== "no" &&
      (!o.outbound ||
        o.serviceStart === null ||
        o.serviceEnd === null ||
        (input.returnTo && !o.returnJourney)),
  );
  const complete =
    verified.length > 0 && unresolved.length === 0 && !search.routeLimitReached;
  const explanation: string[] = [];
  if (selected?.scoreBreakdown) {
    const s = selected.scoreBreakdown;
    explanation.push(
      `The highest comparison score among checked, verified pantry sites with a timed visit${input.returnTo ? " and a checked return trip" : ""}. Feasibility comes before score.`,
    );
    explanation.push(
      `${s.totalTravelMinutes} minutes traveling; ${s.totalWalkingMinutes} minutes walking; ${s.waitingMinutes} minutes before service; ${s.totalTransfers} transfers${input.returnTo ? " across the complete trip" : ""}.`,
    );
    explanation.push(
      s.totalFare === null
        ? "Travel cost is unknown. An uncertainty penalty was used; an unknown cost was not treated as free."
        : `Checked travel fare: $${s.totalFare.toFixed(2)}. This does not include any unverified costs.`,
    );
    explanation.push(
      `${Math.max(0, s.intakeSlackMinutes)} minutes of modeled intake buffer. The visit fits the recorded distribution and registration limits.`,
    );
    if (selected.status === "confirm")
      explanation.push(
        "This is a conditional recommendation: confirm the listed requirements, food availability and access before leaving.",
      );
  } else
    explanation.push(
      "No verified pantry has a complete retrieved trip and a usable recorded distribution window for these answers. Browse the directory, adjust your limits, or call a listed provider.",
    );
  if (!complete)
    explanation.push(
      "The comparison is incomplete where routes, return trips or service windows are missing, or a request budget was reached. Another pantry could be better.",
    );
  if (search.destinationId)
    explanation.push(
      "Only the selected destination was checked; this is not a catalog-wide comparison.",
    );
  explanation.push(
    "Scores are planning points, not success probabilities. No result guarantees food, admission, eligibility or a safe accessible entrance.",
  );
  return {
    algorithm: "feasibility-weighted-v1",
    status: selected
      ? selected.status === "fits"
        ? "ready"
        : "confirm"
      : "unavailable",
    selectedId: selected?.id ?? null,
    alternativeIds: [
      ...frontier.filter((o) => o.id !== selected?.id),
      ...usable.filter(
        (o) => o.id !== selected?.id && !frontier.some((f) => f.id === o.id),
      ),
    ]
      .slice(0, 3)
      .map((o) => o.id),
    paretoFrontierIds: frontier.map((o) => o.id),
    headline: selected
      ? `Best checked pantry: ${selected.resource.name}`
      : "No pantry recommendation is confirmed",
    explanation,
    comparison: {
      scope: search.destinationId ? "selected-destination" : "catalog",
      totalPantries: scope.length,
      verifiedPantries: verified.length,
      routedPantries: verified.filter((o) => o.outbound).length,
      staticallyExcludedPantries: verified.filter(
        (o) => o.status === "no" && !o.outbound,
      ).length,
      unresolvedPantries: unresolved.length,
      unverifiedPantries: scope.length - verified.length,
      siteLimit: search.siteLimit,
      routeLimitReached: search.routeLimitReached,
      complete,
    },
  };
}
