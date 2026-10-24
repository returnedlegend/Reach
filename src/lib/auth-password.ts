import { hash, hashSync, verify } from "@node-rs/argon2";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
const policy = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};
export const hashAccountPassword = (password: string) => hash(password, policy);
export const hashAccountPasswordSync = (password: string) =>
  hashSync(password, policy);
let dummy: Promise<string> | undefined;
export async function verifyAccountPassword(
  password: string,
  row?: { password_hash: unknown; salt: unknown },
): Promise<boolean> {
  if (!row) {
    dummy ??= hashAccountPassword(randomBytes(32).toString("hex"));
    await verify(await dummy, password);
    return false;
  }
  const stored = String(row.password_hash);
  if (stored.startsWith("$argon2id$")) {
    try {
      return await verify(stored, password);
    } catch {
      return false;
    }
  }
  // Read compatibility only. Successful legacy logins replace this with Argon2id.
  if (
    !/^[a-f0-9]{128}$/.test(stored) ||
    !/^[a-f0-9]{32}$/.test(String(row.salt))
  )
    return false;
  return timingSafeEqual(
    scryptSync(password, String(row.salt), 64),
    Buffer.from(stored, "hex"),
  );
}
