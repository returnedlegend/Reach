import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { evaluateAccess } from "../src/lib/access-engine";
import type { AccessOption, AccessResponse } from "../src/lib/access-types";
import { accessInput, FIXED_NOW, journeyLookup, READY_ROUTE, syntheticCandidate, syntheticJourney, syntheticWindow } from "../tests/fixtures/access-scenarios";

// All candidates and journeys are synthetic. This script never reads production data.
const scenarios = [
  {
    label: "closest-site-closes-before-arrival",
    candidates: [
      syntheticCandidate("near-closed", { name: "Synthetic near closed site", coordinates: { lat: 30, lng: -96.005 }, window: syntheticWindow({ opens: "08:00", closes: "08:30", registrationCutoff: "08:20" }) }),
      syntheticCandidate("far-open", { name: "Synthetic farther open site", coordinates: { lat: 30, lng: -96.03 } }),
    ], input: accessInput(),
    lookup: journeyLookup({ "-96.0050": [syntheticJourney({ arrival: 540, walkingMinutes: 3, walkingMiles: 0.15 })], "-96.0300": [syntheticJourney({ arrival: 510, walkingMinutes: 9, walkingMiles: 0.45 })] }),
  },
  {
    label: "near-site-stock-report-expired",
    candidates: [
      syntheticCandidate("near-stale", { name: "Synthetic stale report", coordinates: { lat: 30, lng: -96.004 }, availability: { status: "available", source: "Synthetic report", reportedAt: "2026-10-20T00:00:00.000Z", expiresAt: "2026-10-21T00:00:00.000Z" } }),
      syntheticCandidate("far-current", { name: "Synthetic current report", coordinates: { lat: 30, lng: -96.025 } }),
    ], input: accessInput(),
    lookup: journeyLookup({ "-96.0040": [READY_ROUTE], "-96.0250": [syntheticJourney({ arrival: 515, walkingMinutes: 8, walkingMiles: 0.4 })] }),
  },
  {
    label: "nearest-option-exceeds-walking-limit",
    candidates: [
      syntheticCandidate("near-over-budget", { name: "Synthetic near over budget", coordinates: { lat: 30, lng: -96.003 } }),
      syntheticCandidate("far-within-budget", { name: "Synthetic far within budget", coordinates: { lat: 30, lng: -96.028 } }),
    ], input: accessInput({ maxWalkingMinutes: 15, maxWalkingMiles: 1 }),
    lookup: journeyLookup({ "-96.0030": [syntheticJourney({ walkingMinutes: 16, walkingMiles: 0.8 })], "-96.0280": [syntheticJourney({ walkingMinutes: 12, walkingMiles: 0.6 })] }),
  },
];

function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function knownViolations(option: AccessOption, input: ReturnType<typeof accessInput>): string[] {
  if (option.status !== "fits") return [];
  const out = option.outbound, back = option.returnJourney, failures: string[] = [];
  if (!out) failures.push("missing-outbound");
  if (input.returnTo && !back) failures.push("missing-requested-return");
  if (option.availability.status === "unavailable") failures.push("unavailable-stock");
  if (option.warnings.some(w => /eligibility|dietary|Step-free|Pedestrian pickup/i.test(w))) failures.push("known-uncertainty-marked-fit");
  if (out) {
    if (out.walkingMinutes + (back?.walkingMinutes || 0) > input.maxWalkingMinutes + 0.001) failures.push("walking-time-budget");
    if (out.walkingMiles + (back?.walkingMiles || 0) > input.maxWalkingMiles + 0.001) failures.push("walking-distance-budget");
    if (out.transfers > input.maxTransfers || (back && back.transfers > input.maxTransfers)) failures.push("transfer-limit");
    if (back && out.fare !== null && back.fare !== null && out.fare + back.fare > input.fareBudget) failures.push("fare-budget");
    if (input.arrivalDeadline && out.arrival > Number(input.arrivalDeadline.slice(0, 2)) * 60 + Number(input.arrivalDeadline.slice(3))) failures.push("arrival-deadline");
    if (input.returnDeadline && back && back.arrival > Number(input.returnDeadline.slice(0, 2)) * 60 + Number(input.returnDeadline.slice(3))) failures.push("return-deadline");
    if (option.intakeCutoff !== null && option.serviceStart !== null && option.serviceStart > option.intakeCutoff) failures.push("intake-cutoff");
  }
  return failures;
}

const report: Array<Record<string, string | number | null>> = [];
for (const scenario of scenarios) {
  const nearest = [...scenario.candidates].sort((a, b) => distance(scenario.input.origin, a.resource.coordinates!) - distance(scenario.input.origin, b.resource.coordinates!))[0];
  const started = performance.now();
  const result: AccessResponse = await evaluateAccess(scenario.input, scenario.candidates, scenario.lookup, FIXED_NOW);
  const latencyMs = Math.round((performance.now() - started) * 100) / 100;
  const violations = result.options.flatMap(option => knownViolations(option, scenario.input).map(reason => `${option.id}:${reason}`));
  assert.equal(result.aiCalls, 0, `${scenario.label}: evaluator must make zero AI calls`);
  assert.deepEqual(violations, [], `${scenario.label}: no known hard constraint may be violated`);
  report.push({ label: scenario.label, nearestBaseline: nearest.resource.id, selected: result.options[0]?.id ?? null,
    selectedStatus: result.options[0]?.status ?? null, usableOptions: result.options.filter(x => x.status !== "no" && x.outbound).length,
    knownConstraintViolations: violations.length, aiCalls: result.aiCalls, latencyMs });
}
console.log(JSON.stringify({ fixtureScope: "synthetic only", now: FIXED_NOW.toISOString(), scenarios: report }, null, 2));
