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
    const guestContacts = new Map<
      string,
      { kind: "email" | "phone"; value: string }
    >();
    if (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='sharing_submissions'",
        )
        .get()
    ) {
      for (const row of db
        .prepare(
          "SELECT record_id, public_contact FROM sharing_submissions WHERE status='approved' AND record_id IS NOT NULL",
        )
        .all()) {
        try {
          const contact = JSON.parse(String(row.public_contact));
          if (
            ["email", "phone"].includes(contact.kind) &&
            typeof contact.value === "string"
          )
            guestContacts.set(String(row.record_id), contact);
        } catch {
          /* Invalid contact metadata must not hide the pantry directory. */
        }
      }
    }
    return {
      resources: [
        ...listPantryResources(db),
        ...(featureEnabled("community")
          ? [...listHotspotResources(db), ...listOfferResources(db)]
          : []),
      ]
        .map((resource) => {
          const contact = guestContacts.get(
            resource.communityOffer?.recordId ?? "",
          );
          return contact
            ? {
                ...resource,
                communityContact: contact,
                address: `${resource.city} — approximate area; arrange a public pickup with the donor.`,
                eligibility:
                  "Contact the donor to confirm availability and arrange pickup. No Reach account required.",
              }
            : resource;
        })
        .filter(
          (resource) =>
            !blockedRecordIds.has(
              (resource.communityHotspot ?? resource.communityOffer)
                ?.recordId ?? "",
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
