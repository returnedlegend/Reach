import {
  listPantryResources,
  listPlannerPantries,
  openPantryDatabase,
} from "./pantry-store";
import type { Resource } from "@/data/resources";
import { listOfferResources } from "./offer-resources";
import { listHotspotResources } from "./hotspot-resources";
import { featureEnabled } from "./release-features";
import { getAccountActor } from "./account-store";
import type { Pantry } from "./types";

/** Public results always come from the active database, never a stale seed fallback. */
export function publicDirectory(cookieHeader?: string | null): {
  resources: Resource[];
  pantries: Pantry[];
  error: string;
} {
  try {
    const db = openPantryDatabase();
    const actor = cookieHeader
      ? getAccountActor(
          db,
          new Request("http://reach.internal", {
            headers: { cookie: cookieHeader },
          }),
        )
      : null;
    const blockedRecordIds = new Set(
      actor
        ? db
            .prepare(
              "SELECT r.id FROM records r JOIN blocks b ON (b.user_id=? AND b.blocked_id=r.owner_id) OR (b.blocked_id=? AND b.user_id=r.owner_id)",
            )
            .all(actor.id, actor.id)
            .map((row) => String(row.id))
        : [],
    );
    return {
      resources: [
        ...listPantryResources(db),
        ...(featureEnabled("community")
          ? [...listHotspotResources(db), ...listOfferResources(db)]
          : []),
      ].filter(
        (resource) =>
          !blockedRecordIds.has(
            (resource.communityHotspot ?? resource.communityOffer)?.recordId ??
              "",
          ),
      ),
      pantries: listPlannerPantries(db),
      error: "",
    };
  } catch {
    return {
      resources: [],
      pantries: [],
      error:
        "The pantry directory is temporarily unavailable. Please try again later. Maps, transit information and saved trips remain available.",
    };
  }
}
