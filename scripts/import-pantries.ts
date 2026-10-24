import { openPantryDatabase, importPantries } from "../src/lib/pantry-store";
// Opening performs the first import. Repeating it demonstrates safe idempotence.
const db = openPantryDatabase(process.argv[2]);
const additional = importPantries(db);
const total = db.prepare("SELECT count(*) count FROM pantries").get()!.count;
console.log(
  `Pantry import complete: ${total} records, ${additional} additional records on repeat check.`,
);
