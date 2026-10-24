import { z } from "zod";
import type { AccessInput, AccessResponse, AccessOption } from "./access-types";
import type {
  NavigationNeeds,
  NavigationGuidance,
  NavigationEvidence,
} from "./navigation-types";
import { openRouterJson } from "./openrouter-client";
import { formatTime } from "./time";

/** These are evidence identifiers, never model-authored itinerary facts. */
const emphasisSchema = z
  .object({ emphasisIds: z.array(z.string().max(40)).min(1).max(4) })
  .strict();
const emphasisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["emphasisIds"],
  properties: {
    emphasisIds: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string" },
    },
  },
};
function describeRoute(option: AccessOption) {
  const out = option.outbound;
  if (!out)
    return "No itinerary was retrieved. An external directions link does not establish route feasibility.";
  const mode =
    out.mode === "driving"
      ? "Driving"
      : out.source === "scheduled"
        ? "Scheduled public transit"
        : "Routed walking";
  return `${mode}: leave ${formatTime(out.departure)}, arrive ${formatTime(out.arrival)} (America/Chicago). ${out.mode === "driving" ? `${out.durationMinutes ?? out.arrival - out.departure} min driving${out.distanceMiles != null ? `, ${out.distanceMiles.toFixed(1)} miles routed` : ""}; fuel and parking costs unknown.` : `${out.walkingMinutes} min walking, ${out.walkingMiles.toFixed(1)} miles routed walking; ${out.transfers} transfers; ${out.fare == null ? "fare unknown" : `fare $${out.fare.toFixed(2)}`}.`}`;
}
export function navigationEvidence(
  result: AccessResponse,
  priorityId?: string,
): NavigationEvidence[] {
  return result.options
    .map((option, index) => ({ option, index }))
    .filter(({ option, index }) => index < 5 || option.id === priorityId)
    .flatMap(({ option, index }) => {
      const prefix = `option-${index}`;
      const rows: NavigationEvidence[] = [
        {
          id: `${prefix}-route`,
          resourceId: option.id,
          text: describeRoute(option),
        },
        {
          id: `${prefix}-status`,
          resourceId: option.id,
          text: `${option.status === "no" ? "Does not meet the checked requirements" : option.status === "fits" ? "Meets the checked constraints" : "Needs confirmation"}. ${option.reasons.join(" ")}`,
        },
        {
          id: `${prefix}-food`,
          resourceId: option.id,
          text: `Food availability: ${option.availability.status}. A dated report never guarantees stock on arrival.`,
        },
      ];
      if (option.serviceStart != null)
        rows.push({
          id: `${prefix}-visit`,
          resourceId: option.id,
          text: `Planned visit ${formatTime(option.serviceStart)}–${formatTime(option.serviceEnd ?? option.serviceStart)}${option.intakeCutoff != null ? `; intake cutoff ${formatTime(option.intakeCutoff)}` : ""}. Confirm published distribution and registration windows separately.`,
        });
      if (option.returnJourney)
        rows.push({
          id: `${prefix}-return`,
          resourceId: option.id,
          text: `Return: leave ${formatTime(option.returnJourney.departure)}, arrive ${formatTime(option.returnJourney.arrival)} (America/Chicago). ${option.returnJourney.source === "scheduled" ? "Scheduled service, not live." : "Routing estimate, not a guarantee."}`,
        });
      return rows;
    });
}

/** The model may highlight computed evidence; it cannot choose an infeasible destination,
 * write facts, change rankings, hide warnings or execute tools. Private pickup data is excluded. */
export async function buildNavigationGuidance(
  result: AccessResponse,
  input: AccessInput,
  needs: NavigationNeeds,
  options: {
    explain?: boolean;
    limitations?: string[];
    signal?: AbortSignal;
    fetch?: typeof fetch;
  } = {},
): Promise<NavigationGuidance> {
  const usable = result.options.filter((o) => o.status !== "no" && o.outbound);
  const selected = result.recommendation
    ? (usable.find((o) => o.id === result.recommendation!.selectedId) ?? null)
    : (usable[0] ?? null);
  const evidence = navigationEvidence(result, selected?.id);
  const selectedEvidence = selected
    ? evidence.filter((e) => e.resourceId === selected.id)
    : [];
  const limitations = [
    ...new Set([
      ...(options.limitations || []),
      ...(result.recommendation && !result.recommendation.comparison.complete
        ? [
            "The pantry comparison is incomplete; unexamined or unresolved sites could be better.",
          ]
        : []),
      "Listed food, eligibility, entrance accessibility and pickup conditions must be confirmed before travel.",
      ...(input.mode === "transit"
        ? [
            "Only BTD Route 00 Orange is integrated. Its published schedule conflict remains unresolved. There are no live bus predictions. CapMetro, demand-response and restricted school transportation are not integrated itineraries.",
          ]
        : []),
      ...(input.mode === "driving"
        ? [
            "Driving estimates omit unverified parking, loading, walking from parking and fuel costs. Leave extra time and confirm the entrance.",
          ]
        : []),
      ...(input.returnTo && selected && !selected.returnJourney
        ? [
            "Your requested return trip is unconfirmed; do not treat this as a verified round trip.",
          ]
        : []),
      ...(selected?.warnings || []),
    ]),
  ];
  let paragraphs = selectedEvidence.map((e) => e.text);
  if (selected?.resource.phone)
    paragraphs.push(
      `Before leaving, call ${selected.resource.phone} to confirm food, distribution hours and any requirements.`,
    );
  if (!selected)
    paragraphs = [
      result.options.length
        ? "No option has a retrieved itinerary that meets the known requirements. Review the reasons, adjust your stated limits or contact a listed provider."
        : "No verified matching service is available in this catalog. This does not mean no help exists; check an authoritative local directory or contact 211 for referral information.",
    ];
  if (selected) {
    const failed = result.options.find((option) => option.status === "no");
    paragraphs.push(
      failed
        ? `${failed.resource.name} was excluded: ${failed.reasons[0] || "it does not meet the known requirements."}`
        : needs.urgency === "soon"
          ? "Your urgency favors earlier service among checked options. Travel burden, cost and missing information also affect the order."
          : "This is the highest-ranked checked option with a retrieved route, considering feasibility, travel burden, cost and missing information.",
    );
  }
  let assistance: NavigationGuidance["assistance"] = "deterministic";
  let status: NavigationGuidance["status"] = options.explain
    ? "unavailable"
    : "not-requested";
  let aiCalls = 0;
  // Only evidence about public listings is sent. No coordinates, address, free text,
  // household pickup, owner-private report, document/household profile, or contact data.
  const publicIds = new Set(
    result.options.filter((o) => o.kind === "pantry").map((o) => o.id),
  );
  const eligible = selectedEvidence.filter(
    (e) => publicIds.has(e.resourceId || "") && !e.id.endsWith("-status"),
  );
  if (options.explain && eligible.length && !options.signal?.aborted) {
    const response = await openRouterJson({
      role: "primary",
      feature: "guidance",
      signal: options.signal,
      fetch: options.fetch,
      schema: emphasisSchema,
      jsonSchema: emphasisJsonSchema,
      prompt: `Choose up to four evidence IDs to foreground in a concise food-access explanation. Only select supplied IDs. The deterministic ranking is final. Do not invent an itinerary or facts. Prioritize route, intake/visit timing, return and availability uncertainty. JSON only.\nEVIDENCE:\n${JSON.stringify(eligible.map(({ id, text }) => ({ id, text })))}`,
    });
    aiCalls = response.calls;
    if (
      response.status === "available" &&
      response.value.emphasisIds.every((id) =>
        eligible.some((e) => e.id === id),
      )
    ) {
      const emphasis = [...new Set(response.value.emphasisIds)].map(
        (id) => eligible.find((e) => e.id === id)!.text,
      );
      paragraphs = [
        ...emphasis,
        ...paragraphs.filter((p) => !emphasis.includes(p)),
      ];
      assistance = "ai";
      status = "ready";
    }
  }
  if (options.explain && assistance === "deterministic")
    limitations.push(
      "Optional AI guidance was not available or could not be validated. The computed explanation and route checks remain available.",
    );
  return {
    assistance,
    status,
    headline: selected
      ? `Review ${selected.resource.name} before leaving`
      : "A workable trip is not confirmed",
    paragraphs,
    selectedId: selected?.id ?? null,
    alternativeIds:
      result.recommendation?.alternativeIds ??
      usable.slice(1, 3).map((o) => o.id),
    evidence,
    modules: [
      { name: "needs", status: "complete" },
      {
        name: "resources",
        status:
          options.limitations?.length ||
          !result.options.length ||
          result.options.some(
            (o) =>
              o.availability.status === "unknown" ||
              o.resource.verificationStatus !== "confirmed-site" ||
              o.resource.detailsNeedConfirmation,
          )
            ? "limited"
            : "complete",
      },
      {
        name: "transport",
        status: result.options.some((o) => o.outbound) ? "complete" : "limited",
      },
      {
        name: "ranking",
        status:
          result.recommendation && !result.recommendation.comparison.complete
            ? "limited"
            : "complete",
      },
      {
        name: "guidance",
        status: options.explain && assistance !== "ai" ? "limited" : "complete",
      },
    ],
    limitations,
    aiCalls,
  };
}
