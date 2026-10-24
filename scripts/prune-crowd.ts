import { openPantryDatabase } from "../src/lib/pantry-store";
import { pruneCrowdData } from "../src/lib/crowd-store";

const deleted = pruneCrowdData(openPantryDatabase());
console.log(
  `Removed ${deleted.buckets} expired crowd buckets and ${deleted.dedupHashes} expired crowd dedup hashes.`,
);
