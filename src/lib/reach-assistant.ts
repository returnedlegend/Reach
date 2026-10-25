import { coreRelease, disabledFeatureResponse } from "./release-features";
import { z } from "zod";
import { accessInputSchema, createAccessHandler } from "./access-service";
import { navigationNeedsSchema } from "./navigation-resource-agent";
import {
  interpretNavigationNeeds,
  explicitNeeds,
} from "./navigation-needs-agent";
import { openPantryDatabase, listPantryResources } from "./pantry-store";
import { AccountError } from "./account-store";
import {
  accessFailure,
  privateResponse,
  readPrivateJson,
  requireSameOrigin,
} from "./access-http";
import type { AssistantResponse } from "./assistant-types";
import type { AccessInput, AccessResponse } from "./access-types";
import type { NavigationNeeds } from "./navigation-types";

if (typeof window !== "undefined")
  throw new Error("Reach assistant is server-only.");
const bodySchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1)
      .max(1200)
      .refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)),
    input: accessInputSchema.optional(),
    needs: navigationNeedsSchema.optional(),
    pantryId: z.string().min(1).max(100).optional(),
    departureExplicit: z.boolean().default(false),
  })
  .strict();
const preferenceSchema = accessInputSchema
  .pick({
    mode: true,
    maxWalkingMinutes: true,
    maxWalkingMiles: true,
    fareBudget: true,
    maxTransfers: true,
    visitMinutes: true,
    mobility: true,
    allowWaiting: true,
    dietaryPreference: true,
    dietaryRequired: true,
  })
  .partial()
  .strict();
let limitStart = 0,
  requests = 0;
function takeBudget() {
  const now = Date.now();
  if (now - limitStart >= 60000) {
    limitStart = now;
    requests = 0;
  }
  if (++requests > 20)
    throw new AccountError(
      429,
      "Too many assistant requests. Wait a minute and try again.",
    );
}
/** Clear, bounded local intent recognition; never constructs a resource or route. */
export function localAssistantPreferences(text: string): Partial<AccessInput> {
  const patch: Partial<AccessInput> = {};
  const normalized = text.replace(/\u2019/g, "'");
  // Remove explicitly rejected modes before looking for a positive preference.
  // These local values override AI suggestions, so a negative bus/walking mention
  // must never become an affirmative travel instruction.
  let rejectedTransit = false;
  const affirmative = normalized
    .replace(
      /\b(?:(?:do not|don't|cannot|can't|can not|unable to|not able to|will not|won't|would rather not)\s+(?:(?:want|need|prefer)(?:\s+to)?\s+)?(?:(?:take|use|ride|catch|travel|go)\s+(?:by\s+)?)?|no\s+|not\s+(?:by\s+|on\s+)?)(?:the\s+|a\s+)?(?:bus(?:es)?|public transit|transit|walk(?:ing)?|on foot|driv(?:e|ing)|car)\b/gi,
      (phrase) => {
        if (/\b(?:bus(?:es)?|transit)\b/i.test(phrase)) rejectedTransit = true;
        return " ";
      },
    )
    .replace(
      /\b(?:bus(?:es)?|public transit|transit|walk(?:ing)?|on foot|driv(?:e|ing)|car)\s+(?:(?:is|are)\s+)?(?:(?:not|never)\s+(?:possible|available|an option)|(?:isn't|aren't)\s+(?:possible|available|an option)|unsafe|too difficult)\b/gi,
      (phrase) => {
        if (/\b(?:bus(?:es)?|transit)\b/i.test(phrase)) rejectedTransit = true;
        return " ";
      },
    );
  // A bus stop is a landmark, not an instruction to travel by bus.
  const travelText = affirmative.replace(
    /\bbus (?:stops?|stations?|shelters?)\b/gi,
    " ",
  );
  if (/\b(?:bus|public transit|by transit)\b/i.test(travelText))
    patch.mode = "transit";
  else if (/\b(?:walk|walking|on foot)\b/i.test(travelText))
    patch.mode = "walking";
  else if (/\b(?:drive|driving|by car)\b/i.test(travelText))
    patch.mode = "driving";
  else if (
    !rejectedTransit &&
    /\b(?:no car|don't have a car|do not have a car|without a car)\b/i.test(
      normalized,
    )
  )
    patch.mode = "transit";
  // A qualified walking limitation is not an inability to walk at all. Leave
  // distances and durations to the user's controls / reviewed interpretation.
  if (
    /\b(?:cannot|can't|can not|unable to|not able to)\s+walk\b(?!\s+(?:more|over|for|far|long|to|that|very|much|without|a|an)\b|\s+\d)/i.test(
      normalized,
    )
  ) {
    patch.maxWalkingMinutes = 0;
    patch.maxWalkingMiles = 0;
  }
  if (/\b(?:open (?:right )?now|right now|as soon as possible)\b/i.test(text))
    patch.allowWaiting = false;
  return patch;
}
/** Parse an explicitly written clock only. Never invent a time for 'evening'. */
export function explicitDeparture(text: string): string | undefined {
  const bare =
    /^\s*(?:(?:[01]?\d|2[0-3]):[0-5]\d|(?:1[0-2]|[1-9])(?::[0-5]\d)?\s*(?:am|pm))\s*[.!]?\s*$/i.test(
      text,
    );
  if (
    !bare &&
    !/\b(?:leave|leaving|depart|departure|start|starting)\b/i.test(text)
  )
    return;
  if (!bare) {
    const mention = text.match(
      /\b(?:leave|leaving|depart|departure|start|starting)\s*(?:at|around|by|time|is|:)?\s*(.*)/i,
    );
    if (!mention) return;
    text = mention[1];
  }
  const full = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:am|pm))/i);
  if (full) return `${full[1].padStart(2, "0")}:${full[2]}`;
  const twelve = text.match(/\b(1[0-2]|[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (!twelve) return;
  const hour =
    (Number(twelve[1]) % 12) + (twelve[3].toLowerCase() === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${twelve[2] || "00"}`;
}
export function createAssistantHandler(
  databasePath?: string,
  dependencies: {
    interpret?: typeof interpretNavigationNeeds;
    plan?: (request: Request) => Promise<Response>;
  } = {},
) {
  const planner =
    dependencies.plan ||
    createAccessHandler(databasePath, { pantriesOnly: true });
  return async (request: Request) => {
    try {
      if (coreRelease()) return disabledFeatureResponse("AI assistance");
      requireSameOrigin(request);
      takeBudget();
      const body = await readPrivateJson(request, bodySchema);
      const db = openPantryDatabase(databasePath);
      const resources = listPantryResources(db);
      let selected = body.pantryId
        ? resources.find((r) => r.id === body.pantryId)
        : undefined;
      if (body.pantryId && !selected)
        throw new AccountError(
          404,
          "This pantry is not in the current public directory.",
        );
      if (!selected) {
        const mentions = resources.filter((r) =>
          body.message.toLowerCase().includes(r.name.toLowerCase()),
        );
        if (mentions.length === 1) selected = mentions[0];
      }
      const inquiry =
        /\b(?:ask|email|contact|inquir\w*|send (?:a |an |the )?(?:message|inquiry))\b/i.test(
          body.message,
        );
      if (inquiry) {
        return privateResponse({
          status: selected ? "ready" : "needs-details",
          assistance: "computed",
          reply: selected
            ? `Open ${selected.name} in the directory to see its published contact details. Confirm availability directly before traveling.`
            : "Select a pantry on the map or name one from the directory to see its published contact details.",
          ...(!selected
            ? { followUp: "Which pantry would you like to contact?" }
            : {}),
        } satisfies AssistantResponse);
      }
      if (!body.input)
        return privateResponse({
          status: "needs-location",
          assistance: "computed",
          reply:
            "Choose your starting point with the location controls. I will use those selected coordinates to check routes, without sending them to AI.",
          followUp: "Where are you starting?",
        } satisfies AssistantResponse);
      const clock = explicitDeparture(body.message);
      if (
        /\b(?:return|back|home)\s+(?:by|before)\b/i.test(body.message) &&
        (!body.input.returnTo || !body.input.returnDeadline)
      )
        return privateResponse({
          status: "needs-details",
          assistance: "computed",
          reply:
            "A return deadline needs a return destination and a checked return journey. I cannot treat a return time as your departure.",
          followUp:
            "Use Find food I can reach on the home page to choose a return point and deadline, then check the complete trip.",
        } satisfies AssistantResponse);
      if (
        !clock &&
        !body.departureExplicit &&
        /\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:1[0-2]|[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/i.test(
          body.message,
        )
      )
        return privateResponse({
          status: "needs-details",
          assistance: "computed",
          reply:
            "I need to distinguish departure time from arrival or pantry hours before checking this trip.",
          followUp:
            "What time will you leave? Enter, for example, leave at 6 PM. Published hours are checked separately.",
        } satisfies AssistantResponse);
      if (
        /\b(?:this evening|tonight|this afternoon|this morning)\b/i.test(
          body.message,
        ) &&
        !clock &&
        !body.departureExplicit
      )
        return privateResponse({
          status: "needs-details",
          assistance: "computed",
          reply:
            "I need an exact departure time to check service and pickup windows. I cannot assume a time for an evening or promise that food will be available.",
          followUp:
            "What time will you leave? For example, enter 6 PM or 18:00. Times are America/Chicago.",
        } satisfies AssistantResponse);
      const interpreted = await (
        dependencies.interpret || interpretNavigationNeeds
      )(body.message, { signal: request.signal });
      const validatedPatch = preferenceSchema.safeParse(
        interpreted.status === "available" ? interpreted.patch || {} : {},
      );
      const validatedNeeds = navigationNeedsSchema
        .partial()
        .strict()
        .safeParse(
          interpreted.status === "available" ? interpreted.needs || {} : {},
        );
      const patch = {
        ...(validatedPatch.success ? validatedPatch.data : {}),
        ...localAssistantPreferences(body.message),
        ...(clock ? { departure: clock } : {}),
      };
      const needs: NavigationNeeds = {
        ...navigationNeedsSchema.parse(body.needs || {}),
        ...(validatedNeeds.success ? validatedNeeds.data : {}),
        ...explicitNeeds(body.message),
      };
      const input = accessInputSchema.parse({ ...body.input, ...patch });
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      headers.set("Content-Type", "application/json");
      const planned = await planner(
        new Request(new URL("/api/access/plan", request.url), {
          method: "POST",
          headers,
          signal: request.signal,
          body: JSON.stringify({
            input,
            needs,
            explain: true,
            ...(selected ? { destinationId: selected.id } : {}),
          }),
        }),
      );
      if (!planned.ok) return planned;
      const plan = (await planned.json()) as AccessResponse;
      if (!Array.isArray(plan.options) || plan.timezone !== "America/Chicago")
        throw new AccountError(
          503,
          "The planner returned incomplete information. Try again.",
        );
      const checked = plan.options.filter(
        (o) => o.status !== "no" && o.outbound,
      );
      const hasAI =
        plan.guidance?.assistance === "ai" ||
        (interpreted.assistance === "ai" &&
          validatedPatch.success &&
          validatedNeeds.success);
      return privateResponse({
        status: "ready",
        assistance: hasAI ? "ai" : "computed",
        reply: checked.length
          ? "These checked options use your selected starting point and the available route and service records. Review timing, requirements and uncertainties before traveling. AI cannot confirm food stock."
          : "I could not confirm a workable trip from the available data. Directory listings below are not verified reachable recommendations. No route, opening time or food stock has been invented.",
        plan,
        appliedPreferences: patch,
      } satisfies AssistantResponse);
    } catch (error) {
      return accessFailure(error);
    }
  };
}
