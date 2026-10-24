import { openPantryDatabase } from "../src/lib/pantry-store";
import {
  initializeOutreach,
  addOrganizationContact,
} from "../src/lib/outreach-store";
// Local administrator only: never infer consent from a public address or send mail here.
const [pantryId, email, sourceUrl, ...flags] = process.argv.slice(2);
const db = openPantryDatabase();
initializeOutreach(db);
const row = db
  .prepare("SELECT name FROM pantries WHERE id=? AND active=1")
  .get(pantryId || "");
if (
  !row ||
  !email ||
  !sourceUrl ||
  flags.length !== 1 ||
  flags[0] !== "--verified-and-consented"
)
  throw new Error(
    "Usage: outreach:admin PANTRY_ID ORGANIZATION_EMAIL OFFICIAL_SOURCE_URL --verified-and-consented (only after verifying contact and participation consent)",
  );
addOrganizationContact(db, {
  pantryId,
  name: String(row.name),
  email,
  sourceUrl,
  consentConfirmed: true,
});
console.log("Enrolled verified participating organization. No email was sent.");
