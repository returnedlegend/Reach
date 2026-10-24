import { openCommunityDatabase } from "../src/lib/community";
import { accountTransaction } from "../src/lib/account-store";
import { z } from "zod";

const [address, extra] = process.argv.slice(2);
const parsed = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254)
  .safeParse(address);
if (!parsed.success || extra) {
  console.error(
    "Usage: npx tsx scripts/account-admin.ts <existing-verified-email>",
  );
  process.exitCode = 1;
} else {
  const db = openCommunityDatabase();
  try {
    accountTransaction(db, () => {
      const user = db
        .prepare("SELECT id,email_verified_at FROM users WHERE email=?")
        .get(parsed.data);
      if (!user?.email_verified_at)
        throw new Error(
          "Administrator bootstrap requires an existing verified email account.",
        );
      db.prepare("UPDATE users SET pantry_role='administrator' WHERE id=?").run(
        String(user.id),
      );
      db.prepare(
        "INSERT INTO audit(actor_id,action,target_id,created_at,reason) VALUES(NULL,'pantry-administrator-bootstrap',?,?,?)",
      ).run(
        String(user.id),
        new Date().toISOString(),
        "Trusted local administrator command",
      );
    });
    console.log("Pantry administrator access granted to the verified account.");
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Administrator bootstrap failed.",
    );
    process.exitCode = 1;
  }
}
