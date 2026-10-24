import { prunePublicCorrections } from "../src/lib/public-corrections";
import { openPantryDatabase } from "../src/lib/pantry-store";
import { pruneCrowdData } from "../src/lib/crowd-store";

const deleted = pruneCrowdData(openPantryDatabase());
const reports = prunePublicCorrections(openPantryDatabase());
console.log(
  `Removed ${deleted.buckets} expired crowd buckets and ${deleted.dedupHashes} expired crowd dedup hashes and ${reports} expired anonymous corrections.`,
);
