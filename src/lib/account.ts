import { featureEnabled } from "./release-features";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { accountRequestOrigin as origin } from "./auth-origin";
import { openCommunityDatabase } from "./community";
import { hashAccountPassword, verifyAccountPassword } from "./auth-password";
import {
  ACCOUNT_COOKIE,
  AccountError,
  accountFail as fail,
  accountHash,
  accountRate,
  accountSessionTokens,
  accountTransaction,
  getAccountActor,
} from "./account-store";
export {
  getAccountActor,
  requireAccountActor,
  initializeAccountSchema,
  type AccountActor,
} from "./account-store";

const password = z.string().min(12).max(128);
const credentialPassword = z.string().min(1).max(128);
const email = z.string().trim().toLowerCase().email().max(254);
const empty = z.object({}).strict();
const SESSION_SECONDS = 7 * 24 * 3600;
export function accountResponse(
  value: unknown,
  status = 200,
  cookies: string[] = [],
) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(value, { status, headers });
}
async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get("origin") !== origin(request))
    fail(403, "A same-origin request is required.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail(415, "Send application/json.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 8192) {
      await reader.cancel();
      fail(413, "Request is too large.");
    }
    chunks.push(part.value);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "Invalid JSON.");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    fail(
      400,
      "Please check the required fields. Passwords must contain 12–128 characters.",
    );
  return parsed.data;
}
function cookies(request: Request, token = "", seconds = 0): string[] {
  const secure = origin(request).startsWith("https:") ? "; Secure" : "";
  return [
    `${ACCOUNT_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secure}`,
    `${ACCOUNT_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/community; Max-Age=0${secure}`,
  ];
}
export function makeSession(
  db: DatabaseSync,
  userId: string,
  request: Request,
  at: Date,
) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(at.toISOString());
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    userId,
    new Date(+at + SESSION_SECONDS * 1000).toISOString(),
  );
  return cookies(request, token, SESSION_SECONDS);
}
function revoke(db: DatabaseSync, userId: string) {
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
  db.prepare("DELETE FROM account_tokens WHERE user_id=?").run(userId);
  db.prepare("DELETE FROM account_email_claims WHERE user_id=?").run(userId);
}
function deleteAccount(db: DatabaseSync, userId: string) {
  // Legacy community foreign keys predate cascades. Remove private material and
  // references explicitly inside the same transaction as the identity deletion.
  db.prepare(
    "DELETE FROM requests WHERE requester_id=? OR offer_id IN (SELECT id FROM records WHERE owner_id=?)",
  ).run(userId, userId);
  db.prepare(
    "DELETE FROM reports WHERE reporter_id=? OR target_id=? OR target_id IN (SELECT id FROM records WHERE owner_id=?)",
  ).run(userId, userId, userId);
  db.prepare(
    "DELETE FROM audit WHERE actor_id=? OR target_id=? OR target_id IN (SELECT id FROM records WHERE owner_id=?)",
  ).run(userId, userId, userId);
  db.prepare("DELETE FROM blocks WHERE user_id=? OR blocked_id=?").run(
    userId,
    userId,
  );
  db.prepare("DELETE FROM organizer_requests WHERE user_id=?").run(userId);
  db.prepare("DELETE FROM records WHERE owner_id=?").run(userId); // photos cascade
  db.prepare("DELETE FROM users WHERE id=?").run(userId); // sessions, tokens, private locations and pantry FKs cascade
}

/** Existing staff identities only; public registration is not available. */
export function createAccountHandler(
  databasePath?: string,
  options: { now?: () => Date } = {},
) {
  const clock = options.now || (() => new Date());
  return async (request: Request, path?: string[]): Promise<Response> => {
    try {
      const parts =
        path ||
        new URL(request.url).pathname
          .replace(/^\/api\/account\/?/, "")
          .split("/")
          .filter(Boolean);
      if (parts.length !== 1) fail(404, "Not found.");
      const route = parts[0];
      if (
        ![
          "status",
          "me",
          "login",
          "logout",
          "change-password",
          "delete",
        ].includes(route)
      )
        fail(404, "Not found.");
      if (route === "status" && request.method === "GET")
        return accountResponse({ enabled: featureEnabled("accounts") });
      const db = openCommunityDatabase(databasePath),
        at = clock();
      accountRate(db, "global:requests", 600, 60, +at);
      const actor = getAccountActor(db, request, at);
      if (route === "me" && request.method === "GET")
        return accountResponse({ user: actor });
      if (route === "delete" && request.method === "DELETE") {
        if (!actor) fail(401, "Sign in to continue.");
        const data = await body(
          request,
          z
            .object({
              password: credentialPassword,
              confirmation: z.literal("DELETE"),
            })
            .strict(),
        );
        accountRate(db, `password:${actor.id}`, 5, 900, +at);
        const row = db.prepare("SELECT * FROM users WHERE id=?").get(actor.id)!;
        if (
          !(await verifyAccountPassword(
            data.password,
            row as { password_hash: unknown; salt: unknown },
          ))
        )
          fail(401, "Password is incorrect.");
        accountTransaction(db, () => {
          const live = db
            .prepare("SELECT password_version FROM users WHERE id=?")
            .get(actor.id);
          if (
            !live ||
            live.password_version !== row.password_version ||
            getAccountActor(db, request, clock())?.id !== actor.id
          )
            fail(401, "Sign in again to continue.");
          deleteAccount(db, actor.id);
        });
        return accountResponse({ ok: true }, 200, cookies(request));
      }
      if (request.method !== "POST") fail(405, "Method not allowed.");
      accountRate(db, "global:mutations", 120, 60, +at);
      if (route === "login") {
        const data = await body(
          request,
          z.object({ email, password: credentialPassword }).strict(),
        );
        accountRate(db, "auth:global", 50, 900, +at);
        accountRate(
          db,
          `auth:address:${accountHash(data.email)}`,
          10,
          900,
          +at,
        );
        const row = db
          .prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE")
          .get(data.email);
        if (
          !(await verifyAccountPassword(
            data.password,
            row as { password_hash: unknown; salt: unknown } | undefined,
          )) ||
          !row
        )
          fail(401, "Email or password is incorrect.");
        if (row.role !== "moderator") fail(403, "Moderator access required.");
        const upgraded = String(row.password_hash).startsWith("$argon2id$")
          ? null
          : await hashAccountPassword(data.password);
        const sessionCookies = accountTransaction(db, () => {
          const live = db
            .prepare("SELECT password_version,role FROM users WHERE id=?")
            .get(String(row.id));
          if (
            !live ||
            live.password_version !== row.password_version ||
            live.role !== "moderator"
          )
            fail(401, "Sign in again to continue.");
          if (upgraded)
            db.prepare(
              "UPDATE users SET password_hash=?,salt='' WHERE id=?",
            ).run(upgraded, String(row.id));
          return makeSession(db, String(row.id), request, at);
        });
        const authenticated = new Request(request.url, {
          headers: { cookie: sessionCookies[0].split(";")[0] },
        });
        return accountResponse(
          { user: getAccountActor(db, authenticated, at) },
          200,
          sessionCookies,
        );
      }
      if (route === "logout") {
        await body(request, empty);
        for (const token of accountSessionTokens(request))
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            accountHash(token),
          );
        return accountResponse({ ok: true }, 200, cookies(request));
      }
      if (!actor) fail(401, "Sign in to continue.");
      if (
        db.prepare("SELECT role FROM users WHERE id=?").get(actor.id)?.role !==
        "moderator"
      )
        fail(403, "Moderator access required.");
      accountRate(db, `user:${actor.id}`, 40, 60, +at);
      const data = await body(
        request,
        z
          .object({
            currentPassword: credentialPassword,
            newPassword: password,
          })
          .strict(),
      );
      accountRate(db, `password:${actor.id}`, 5, 900, +at);
      const row = db.prepare("SELECT * FROM users WHERE id=?").get(actor.id)!;
      if (
        !(await verifyAccountPassword(
          data.currentPassword,
          row as { password_hash: unknown; salt: unknown },
        ))
      )
        fail(401, "Password is incorrect.");
      const hashed = await hashAccountPassword(data.newPassword);
      accountTransaction(db, () => {
        const live = db
          .prepare("SELECT password_version,role FROM users WHERE id=?")
          .get(actor.id);
        if (
          !live ||
          live.password_version !== row.password_version ||
          live.role !== "moderator" ||
          getAccountActor(db, request, clock())?.id !== actor.id
        )
          fail(401, "Sign in again to continue.");
        db.prepare(
          "UPDATE users SET password_hash=?,salt='',password_version=password_version+1,must_change_password=0 WHERE id=?",
        ).run(hashed, actor.id);
        revoke(db, actor.id);
      });
      return accountResponse({ ok: true }, 200, cookies(request));
    } catch (reason) {
      if (reason instanceof AccountError)
        return accountResponse({ error: reason.message }, reason.status);
      return accountResponse(
        { error: "Account service is temporarily unavailable." },
        503,
      );
    }
  };
}
