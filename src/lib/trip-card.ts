import type { Pantry, PlannerInput, PlanResult } from "./types";
import { formatTime } from "./time";
export type SavedPlan = {
  id: string;
  savedAt: string;
  demo: boolean;
  input: PlannerInput;
  result: PlanResult;
  pantry: Pantry;
  originName: string;
  placeNames?: Record<string, string>;
};
export const STORAGE_KEY = "reach.saved-plans.v1";
export function tripCard(plan: SavedPlan): string {
  const { input, result, pantry } = plan;
  return [
    "REACH — TRIP CARD",
    plan.demo
      ? "FICTIONAL EXAMPLE — DO NOT USE FOR TRAVEL"
      : "Scheduled estimates — confirm with the provider before travel",
    `${pantry.name}\n${pantry.address}`,
    `Visit date: ${input.date} • America/Chicago`,
    `Starting at: ${plan.originName}`,
    `Available: ${input.earliestDeparture}–${input.latestReturn} • Visit allowance: ${input.visitMinutes} minutes`,
    `Result: ${result.status === "fits" ? "Fits your stated constraints" : result.status === "confirm" ? "Needs confirmation" : "Does not fit this trip"}`,
    ...result.reasons.map((x) => `• ${x}`),
    "",
    "ITINERARY",
    ...result.segments.map(
      (s) =>
        `${formatTime(s.start)}–${formatTime(s.end)} | ${s.kind.toUpperCase()} ${plan.placeNames?.[s.from] ?? s.from} → ${plan.placeNames?.[s.to] ?? s.to}${s.route ? ` (${s.route})` : ""}${s.miles ? ` · ${s.miles.toFixed(2)} mi` : ""}`,
    ),
    "",
    "PANTRY CONDITIONS",
    `Pickup: ${pantry.pickupFormat ?? "unknown"}`,
    `Service area: ${pantry.serviceArea ?? "unknown"}`,
    `Visit frequency: ${pantry.visitFrequency ?? "unknown"}`,
    ...pantry.windows
      .filter((w) => w.id === result.windowId)
      .map(
        (w) =>
          `Distribution: ${w.opens}–${w.distributionCutoff ?? w.closes}; registration cutoff: ${w.registrationCutoff ?? "unknown"}; appointment: ${w.appointmentRequired === true ? "required" : w.appointmentRequired === false ? "not required" : "unknown"}`,
      ),
    ...(pantry.missingInformation ?? []).map((x) => `Confirm: ${x}`),
    "",
    "SOURCES",
    ...result.sources.map(
      (s) =>
        `${s.title}${s.url ? ` — ${s.url}` : ""} — ${s.fictional ? "fictional test data" : `checked ${s.checkedOn ?? "unknown"}`}`,
    ),
    "",
    "This is a saved plan, not an appointment reservation. Food stock, queues, and admission are not guaranteed.",
    "A downloaded card is available offline; Reach does not provide offline routing.",
    `Saved ${plan.savedAt}`,
  ].join("\n");
}
export function downloadCard(plan: SavedPlan) {
  const blob = new Blob([tripCard(plan)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reach-${plan.input.date}-${plan.pantry.id}.txt`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
