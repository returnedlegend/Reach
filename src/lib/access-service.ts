import { z } from "zod";
import {
  navigationNeedsSchema,
  inspectNavigationResources,
  navigationCrowdNote,
} from "./navigation-resource-agent";
import { navigationWeights } from "./navigation-ranking-agent";
import { buildNavigationGuidance } from "./navigation-guidance-agent";
import type { DatabaseSync } from "node:sqlite";
import { coordinatesSchema } from "./osm-services";
import {
  evaluateAccess,
  ACCESS_WEIGHTS,
  type AccessCandidate,
} from "./access-engine";
import { accessJourneyLookup } from "./access-routing";
import {
  prioritizePantryCandidates,
  recommendPantry,
} from "./pantry-recommendation";
import {
  getPantryInventory,
  listPantryResources,
  listPlannerPantries,
  openPantryDatabase,
} from "./pantry-store";
import { getAccountActor, AccountError } from "./account-store";
import {
  accessFailure,
  privateResponse,
  readPrivateJson,
  requireSameOrigin,
} from "./access-http";
import type { AccessAvailability } from "./access-types";
import { chicagoNow } from "./journey";
import { hasChicagoClockChange, shiftDate } from "./time";
import { validCoordinates } from "./journey";
import { isDate } from "./time";
import { getCrowdSummary } from "./crowd-store";
import { chicagoParts } from "./crowd";
import { chicagoWallInstant } from "./access-time";

const clock = z.string().regex(/^(?:[0-3]\d|4[0-7]):[0-5]\d$/);
export const accessInputSchema = z
  .object({
    origin: coordinatesSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    departure: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    mode: z.enum(["walking", "transit", "driving"]),
    maxWalkingMinutes: z.number().int().min(0).max(180),
    maxWalkingMiles: z.number().min(0).max(20),
    fareBudget: z.number().min(0).max(100),
    maxTransfers: z.number().int().min(0).max(5),
    mobility: z.enum(["standard", "step-free"]),
    appointment: z.enum(["booked", "not-booked", "unknown"]),
    eligibilityConfirmed: z.boolean(),
    dietaryPreference: z.string().max(150),
    dietaryRequired: z.boolean(),
    visitMinutes: z.number().int().min(1).max(240),
    arrivalBufferMinutes: z.number().int().min(0).max(60),
    allowWaiting: z.boolean(),
    arrivalDeadline: clock.optional(),
    returnTo: coordinatesSchema.optional(),
    returnDeadline: clock.optional(),
  })
  .strict();
const unknownAvailability: AccessAvailability = {
  status: "unknown",
  source: "No current inventory report",
  reportedAt: null,
  expiresAt: null,
};

export function privateAvailability(
  db: DatabaseSync,
  userId: string | undefined,
  pantryId: string,
  date: string,
  now: Date,
): {
  availability: AccessAvailability;
  facts?: { pickupStart: string | null; pickupEnd: string | null };
} {
  if (
    userId &&
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='outreach_replies'")
      .get()
  ) {
    const rows = db
      .prepare(
        "SELECT r.*,c.kind FROM outreach_replies r JOIN outreach_threads t ON t.id=r.thread_id JOIN outreach_recipients c ON c.id=t.recipient_id WHERE t.user_id=? AND c.pantry_id=? AND r.reviewed_at IS NOT NULL AND r.expires_at>? ORDER BY r.received_at DESC LIMIT 10",
      )
      .all(userId, pantryId, now.toISOString());
    for (const row of rows) {
      const facts = JSON.parse(String(row.facts_json));
      if (
        facts.date !== date ||
        !["available", "limited", "unavailable"].includes(facts.availability)
      )
        continue;
      return {
        availability: {
          status: facts.availability,
          source: `Private user-reviewed sender report for ${date}; sender identity is unverified`,
          reportedAt: String(row.received_at),
          expiresAt: String(row.expires_at),
        },
        facts,
      };
    }
  }
  const positive = getPantryInventory(pantryId, db)
    .filter(
      (r) =>
        ["available", "limited"].includes(r.status) &&
        Number.isFinite(Date.parse(r.updatedAt)) &&
        Date.parse(r.updatedAt) <= +now &&
        +now - Date.parse(r.updatedAt) < 6 * 3600000,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!positive || date !== chicagoNow(now).date)
    return { availability: { ...unknownAvailability } };
  return {
    availability: {
      status: positive.status,
      source: `Reported ${positive.category}: ${positive.source}; other food types are unknown`,
      reportedAt: positive.updatedAt,
      expiresAt: new Date(
        Date.parse(positive.updatedAt) + 6 * 3600000,
      ).toISOString(),
    },
  };
}
const limits = new Map<string, { count: number; until: number }>();
function takeSearchBudget() {
  const key = "search",
    now = Date.now();
  let r = limits.get(key);
  if (!r || r.until <= now) {
    r = { count: 0, until: now + 60000 };
    limits.set(key, r);
  }
  if (++r.count > 30)
    throw new AccountError(
      429,
      "Too many route searches. Wait a minute and try again.",
    );
}
export function createAccessHandler(
  databasePath?: string,
  handlerOptions: {
    pantriesOnly?: boolean;
    routeFactory?: typeof accessJourneyLookup;
    now?: () => Date;
    /** Internal search scope. A client cannot add or mutate pantry records. */
    pantryIds?: ReadonlySet<string>;
  } = {},
) {
  return async (request: Request) => {
    try {
      requireSameOrigin(request);
      takeSearchBudget();
      const { input, destinationId, needs, explain } = await readPrivateJson(
        request,
        z
          .object({
            input: accessInputSchema,
            destinationId: z.string().min(1).max(100).optional(),
            needs: navigationNeedsSchema.optional(),
            explain: z.boolean().default(false),
          })
          .strict(),
      );
      const db = openPantryDatabase(databasePath),
        now = handlerOptions.now?.() ?? new Date(),
        actor = getAccountActor(db, request, now);
      const resources = listPantryResources(db).filter(
          (resource) =>
            !handlerOptions.pantryIds ||
            handlerOptions.pantryIds.has(resource.id),
        ),
        pantries = listPlannerPantries(db);
      const configuredLimit = process.env.REACH_ACCESS_CANDIDATES ?? "8";
      if (!/^[1-9]\d*$/.test(configuredLimit) || Number(configuredLimit) > 24)
        throw new AccountError(
          503,
          "Planner candidate limit must be an integer from 1 to 24.",
        );
      const number = Number(configuredLimit);
      const candidates: AccessCandidate[] = resources.flatMap((resource) => {
        const pantry = pantries.find((p) => p.id === resource.id);
        if (!pantry) return [];
        const report = privateAvailability(
          db,
          actor?.emailVerified ? actor.id : undefined,
          resource.id,
          input.date,
          now,
        );
        // A reviewed pickup arrangement is private; it never edits the public pantry.
        const window =
          report.facts?.pickupStart &&
          report.facts.pickupEnd &&
          report.facts.pickupStart < report.facts.pickupEnd
            ? {
                id: "private-reply-window",
                rule: { kind: "dates" as const, dates: [input.date] },
                opens: report.facts.pickupStart,
                closes: report.facts.pickupEnd,
                policyKnown: false,
                appointmentRequired: pantry.windows.some(
                  (w) => w.appointmentRequired,
                ),
                sourceIds: [],
              }
            : null;
        return [
          {
            resource,
            pantry: window ? { ...pantry, windows: [window] } : pantry,
            availability: report.availability,
          },
        ];
      });
      // Household destinations require an accepted request and shared instructions.
      // An approximate city marker is never a pickup coordinate.
      if (
        !handlerOptions.pantriesOnly &&
        process.env.REACH_COMMUNITY_ENABLED === "true" &&
        actor?.emailVerified &&
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE name='outreach_replies'")
          .get()
      ) {
        const rows = db
          .prepare(
            "SELECT o.id,o.data,c.name,r.received_at,r.expires_at,r.facts_json,r.pickup_json FROM outreach_replies r JOIN outreach_threads t ON t.id=r.thread_id JOIN outreach_recipients c ON c.id=t.recipient_id JOIN records o ON o.id=c.offer_id JOIN requests q ON q.offer_id=o.id WHERE t.user_id=? AND q.requester_id=? AND q.status='accepted' AND q.pickup_consent=1 AND o.status='approved' AND o.ends_at>? AND c.revoked_at IS NULL AND r.reviewed_at IS NOT NULL AND r.expires_at>? ORDER BY r.received_at DESC LIMIT 20",
          )
          .all(actor.id, actor.id, now.toISOString(), now.toISOString());
        const included = new Set<string>();
        for (const row of rows) {
          if (
            db
              .prepare(
                "SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=(SELECT owner_id FROM records WHERE id=?)) OR (blocked_id=? AND user_id=(SELECT owner_id FROM records WHERE id=?))",
              )
              .get(actor.id, String(row.id), actor.id, String(row.id))
          )
            continue;
          const data = JSON.parse(String(row.data)),
            facts = JSON.parse(String(row.facts_json));
          if (
            !data.sharePickupInstructions ||
            facts.date !== input.date ||
            !isDate(facts.date) ||
            included.has(String(row.id))
          )
            continue;
          included.add(String(row.id));
          const point = row.pickup_json
            ? JSON.parse(String(row.pickup_json))
            : null;
          const coordinates = validCoordinates(point) ? point : null;
          const resource = {
            id: String(row.id),
            name: String(data.title || "Household food pickup"),
            address:
              "Private public meeting point from your accepted pickup request",
            coordinates,
            hours:
              facts.pickupStart && facts.pickupEnd
                ? `${facts.pickupStart}–${facts.pickupEnd} on ${facts.date}; privately reported`
                : "Pickup window needs confirmation",
            eligibility:
              "Accepted household pickup request; check original conditions and food labels.",
            notes:
              "User-confirmed private arrangement. Identity and food safety are not independently verified.",
            offering: String(data.foodCategory || "Household food"),
            verificationStatus: "needs-confirmation" as const,
            detailsNeedConfirmation: true,
            sources: [
              {
                title:
                  "Your accepted pickup request and privately reviewed reply",
                url: "/privacy",
                checkedOn: String(row.received_at).slice(0, 10),
              },
            ],
          };
          const windows =
            facts.pickupStart &&
            facts.pickupEnd &&
            facts.pickupStart < facts.pickupEnd
              ? [
                  {
                    id: "private-pickup",
                    rule: { kind: "dates" as const, dates: [facts.date] },
                    opens: facts.pickupStart,
                    closes: facts.pickupEnd,
                    policyKnown: false,
                    sourceIds: [],
                  },
                ]
              : [];
          candidates.push({
            kind: "household",
            resource,
            pantry: {
              id: resource.id,
              name: resource.name,
              address: resource.address,
              windows,
              walkConnections: [],
              directWalks: [],
              sources: [],
            },
            availability: {
              status: ["available", "limited", "unavailable"].includes(
                facts.availability,
              )
                ? facts.availability
                : "unknown",
              source: "Private user-reviewed household sender report",
              reportedAt: String(row.received_at),
              expiresAt: String(row.expires_at),
            },
          });
        }
      }
      if (
        destinationId &&
        !candidates.some((c) => c.resource.id === destinationId)
      )
        throw new AccountError(
          404,
          "This destination is not available to this account.",
        );
      const route = (handlerOptions.routeFactory ?? accessJourneyLookup)(
        input,
        { signal: request.signal },
      );
      const clockChange =
        hasChicagoClockChange(input.date) ||
        ([input.returnDeadline, input.arrivalDeadline].some(
          (deadline) => deadline && deadline >= "24:00",
        ) &&
          hasChicagoClockChange(shiftDate(input.date, 1)));
      let weights = { ...ACCESS_WEIGHTS };
      if (process.env.REACH_ACCESS_WEIGHTS) {
        try {
          const field = z.number().finite().min(0).max(100).optional();
          const parsed = z
            .object({
              travelMinute: field,
              walkingMinute: field,
              dollar: field,
              transfer: field,
              uncertainty: field,
              closingSlackMinute: field,
              waitingMinute: field,
              timeToServiceMinute: field,
            })
            .strict()
            .parse(JSON.parse(process.env.REACH_ACCESS_WEIGHTS));
          weights = { ...weights, ...parsed };
        } catch {
          throw new AccountError(
            503,
            "Planner ranking configuration is invalid.",
          );
        }
      }
      const declaredNeeds = navigationNeedsSchema.parse(needs || {});
      const resourceReview = inspectNavigationResources(
        candidates,
        declaredNeeds,
        now,
      );
      const byId = new Map(
        resourceReview.candidates.map((c) => [c.resource.id, c]),
      );
      const attempted = new Set<string>();
      let siteLimitReached = false;
      if (declaredNeeds.preferTransitNearby && input.mode !== "transit")
        resourceReview.limitations.push(
          "Your current travel mode does not check bus access. Select public transit to compare routed walking connections to supported stops.",
        );
      const result = await evaluateAccess(
        input,
        prioritizePantryCandidates(resourceReview.candidates, input),
        (from, to, early, late, candidateId) => {
          const candidate = candidateId ? byId.get(candidateId) : undefined;
          if (
            clockChange ||
            !candidate ||
            !validCoordinates(candidate.resource.coordinates) ||
            (destinationId
              ? candidateId !== destinationId
              : candidate.resource.verificationStatus !== "confirmed-site")
          )
            return Promise.resolve([]);
          if (!attempted.has(candidateId!)) {
            if (attempted.size >= number || route.exhausted()) {
              siteLimitReached = true;
              return Promise.resolve([]);
            }
            attempted.add(candidateId!);
          }
          return route.lookup(from, to, early, late);
        },
        now,
        needs ? navigationWeights(declaredNeeds, input.mode, weights) : weights,
      );
      for (const option of result.options) {
        if (option.kind !== "pantry" || option.serviceStart == null) continue;
        const start = option.serviceStart;
        const instant = chicagoWallInstant(
          input.date,
          `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
        );
        if (!instant) continue;
        const local = chicagoParts(instant);
        option.warnings.push(
          navigationCrowdNote(
            getCrowdSummary(db, option.id, now),
            local.weekday,
            local.hour,
          ),
        );
      }
      result.routingCalls = route.calls();
      result.recommendation = recommendPantry(result, input, {
        siteLimit: number,
        routeLimitReached: siteLimitReached || route.exhausted(),
        destinationId,
      });
      result.message +=
        ` Compared ${result.recommendation.comparison.routedPantries} routed verified pantry sites; ${result.recommendation.comparison.staticallyExcludedPantries} were ruled out by known constraints before routing. ${result.recommendation.comparison.complete ? "The verified-site comparison is complete for this catalog and these inputs." : "The comparison is incomplete; another site could be better."} ` +
        (clockChange
          ? "Clock-change journeys cannot be timed unambiguously by this static planner. Confirm with the provider."
          : route.messages().join(" "));
      if (
        !resourceReview.candidates.length &&
        resourceReview.limitations.length
      )
        result.message = resourceReview.limitations.join(" ");
      result.guidance = await buildNavigationGuidance(
        result,
        input,
        declaredNeeds,
        {
          explain,
          limitations: resourceReview.limitations,
          signal: request.signal,
        },
      );
      result.aiCalls = result.guidance.aiCalls;
      return privateResponse(result);
    } catch (error) {
      return accessFailure(error);
    }
  };
}
