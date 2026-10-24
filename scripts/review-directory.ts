import {
  openPantryDatabase,
  listPantryResources,
} from "../src/lib/pantry-store";
import { serviceFreshness } from "../src/lib/service-freshness";
import { prunePublicCorrections } from "../src/lib/public-corrections";
const db = openPantryDatabase();
prunePublicCorrections(db);
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      listings: listPantryResources(db).map((resource) => ({
        id: resource.id,
        name: resource.name,
        verificationStatus: resource.verificationStatus,
        pedestrianPickup: resource.pedestrianPickup ?? "unknown",
        review: serviceFreshness(resource),
        pendingCorrections: Number(
          db
            .prepare(
              "SELECT COUNT(*) AS total FROM pantry_corrections WHERE pantry_id=? AND status='pending'",
            )
            .get(resource.id)!.total,
        ),
      })),
      instruction:
        "Private correction descriptions are available to an authorized operator in the database. Never publish the database or reports. Review sources, then use authorized management or a reviewed maintained-data change. No maintainer is assigned by this command.",
    },
    null,
    2,
  ),
);
