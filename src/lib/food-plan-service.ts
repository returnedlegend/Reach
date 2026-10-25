import { z } from "zod";
import {
  accessFailure,
  privateResponse,
  readPrivateJson,
  requireSameOrigin,
} from "./access-http";
import { createAccessHandler } from "./access-service";
import { coordinatesSchema } from "./osm-services";
import { foodTripInput } from "./food-trip";
import { discoverFood } from "./simple-food";
import { listPantryResources, openPantryDatabase } from "./pantry-store";
import type { Resource } from "@/data/resources";

const schema = z
  .object({
    origin: coordinatesSchema,
    mode: z.enum(["walking", "transit", "driving"]),
    message: z.string().trim().max(1200),
  })
  .strict();
export function createFoodPlanHandler(
  databasePath?: string,
  deps: {
    planFactory?: typeof createAccessHandler;
    resources?: () => Resource[];
    now?: () => Date;
  } = {},
) {
  return async (request: Request) => {
    try {
      requireSameOrigin(request);
      const body = await readPrivateJson(request, schema, 6000);
      const now = deps.now?.() ?? new Date();
      const { input, assumptions, clarification } = foodTripInput(
        body.origin,
        body.mode,
        body.message,
        now,
      );
      if (clarification) {
        return privateResponse({
          options: [],
          message: clarification,
          clarification,
          assumptions,
          recommendation: {
            status: "unavailable",
            selectedId: null,
            explanation: [clarification],
          },
        });
      }
      const resources =
        deps.resources?.() ??
        listPantryResources(openPantryDatabase(databasePath));
      const found = discoverFood(resources, body.message, {
        origin: body.origin,
        mode: body.mode,
        now,
      });
      if (found.blockedMode || !found.matches.length)
        return privateResponse({
          options: [],
          message: found.notices.join(" "),
          assumptions,
          recommendation: {
            status: "unavailable",
            selectedId: null,
            explanation: found.notices,
          },
        });
      const pantryIds = new Set(found.matches.map((item) => item.resource.id));
      const plan = (deps.planFactory ?? createAccessHandler)(databasePath, {
        pantriesOnly: true,
        pantryIds,
        now: () => now,
      });
      const response = await plan(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          signal: request.signal,
          body: JSON.stringify({
            input,
            needs: {
              service: found.intent.service ?? "food",
              urgency: "today",
              hasIdentification: "unknown",
              preferTransitNearby: body.mode === "transit",
            },
            explain: false,
          }),
        }),
      );
      const result = await response.json();
      return privateResponse(
        {
          ...result,
          assumptions,
          planningDate: input.date,
          searchScope:
            "Only maintained sites matching this food request were compared.",
        },
        response.status,
      );
    } catch (error) {
      return accessFailure(error);
    }
  };
}
