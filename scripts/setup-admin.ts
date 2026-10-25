import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { openCommunityDatabase } from "../src/lib/community";
import { accountTransaction } from "../src/lib/account-store";
import { hashAccountPassword } from "../src/lib/auth-password";
nextEnv.loadEnvConfig(process.cwd());
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Usage: npm run admin:setup -- EMAIL");
let password = process.env.REACH_ADMIN_INITIAL_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Set REACH_ADMIN_INITIAL_PASSWORD for noninteractive setup.",
    );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  password = await prompt.question(
    "Temporary password (visible on this local terminal): ",
  );
  prompt.close();
}
if (password.length < 8 || password.length > 128)
  throw new Error("Use 8–128 characters.");
const hash = await hashAccountPassword(password);
const db = openCommunityDatabase();
try {
  accountTransaction(db, () => {
    const existing = db
      .prepare("SELECT id FROM users WHERE email=?")
      .get(email);
    if (existing)
      throw new Error(
        "This email already exists. Use the password-change page; setup will not overwrite it.",
      );
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,name,pantry_role,must_change_password) VALUES(?,?,?,'','moderator',1,?,?,'Reach administrator','administrator',1)",
    ).run(
      id,
      "admin_" + id.replaceAll("-", ""),
      hash,
      new Date().toISOString(),
      email,
    );
    db.prepare(
      "INSERT INTO audit(actor_id,action,target_id,created_at,reason) VALUES(NULL,'local-admin-setup',?,?,?)",
    ).run(
      id,
      new Date().toISOString(),
      "Trusted local setup; password change required",
    );
  });
  console.log(
    "Administrator created. Sign in at /admin/sign-in and change the temporary password.",
  );
} finally {
  db.close();
}
