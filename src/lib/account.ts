import { featureEnabled } from "./release-features";
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { accountRequestOrigin as origin } from "./auth-origin";
import { openCommunityDatabase } from "./community";
import { hashAccountPassword, verifyAccountPassword } from "./auth-password";
import {
  accountMailConfigured,
  canonicalAccountOrigin,
  sendAccountMail,
  emailDeliveryMode,
  type AccountMailSender,
} from "./mail-account";
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

import { renderEmail } from "./email-templates";
import {
  initializeNotifications,
  queueNotification,
} from "./notifications-store";
const password = z.string().min(12).max(128);
const credentialPassword = z.string().min(1).max(128);
const email = z.string().trim().toLowerCase().email().max(254);
const name = z.string().trim().min(1).max(80);
const empty = z.object({}).strict();
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SESSION_SECONDS = 7 * 24 * 3600;
const generic = {
  message:
    "If this address is eligible, an email was requested. Delivery may take time; check your inbox and spam folder.",
};
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

/** The mail injection exists only as a constructor dependency for isolated tests. */
export function createAccountHandler(
  databasePath?: string,
  options: {
    sendMail?: AccountMailSender;
    now?: () => Date;
    /** Enables public registration only in isolated test handlers. */
    allowRegistration?: boolean;
  } = {},
) {
  const clock = options.now || (() => new Date());
  const mailer = options.sendMail || sendAccountMail;
  const requestNotice = () =>
    emailDeliveryMode() === "preview"
      ? {
          message:
            "If this request is eligible, a development email preview was saved locally. No email was sent.",
        }
      : generic;
  const emailReady = () =>
    !!canonicalAccountOrigin() &&
    (!!options.sendMail || accountMailConfigured());
  async function issueMail(
    db: DatabaseSync,
    userId: string,
    address: string,
    purpose: "verify" | "reset",
  ) {
    const token = randomBytes(32).toString("hex"),
      at = clock();
    accountTransaction(db, () => {
      db.prepare(
        "DELETE FROM account_tokens WHERE expires_at<=? OR (user_id=? AND purpose=?)",
      ).run(at.toISOString(), userId, purpose);
      db.prepare("INSERT INTO account_tokens VALUES(?,?,?,?,?)").run(
        accountHash(token),
        userId,
        purpose,
        new Date(
          +at + (purpose === "verify" ? 86400000 : 1800000),
        ).toISOString(),
        at.toISOString(),
      );
    });
    try {
      await mailer({
        to: address,
        subject:
          purpose === "verify"
            ? "Verify your Reach email"
            : "Reset your Reach password",
        kind:
          purpose === "verify" ? "account-verification" : "account-recovery",
        ...renderEmail({
          heading:
            purpose === "verify"
              ? "Verify your Reach email"
              : "Reset your Reach password",
          paragraphs: [
            `This link expires in ${purpose === "verify" ? "24 hours" : "30 minutes"} and can be used once. If you did not request this, ignore this email.`,
          ],
          action: {
            label: purpose === "verify" ? "Verify email" : "Reset password",
            url: `${canonicalAccountOrigin()}/account#${purpose}=${token}`,
          },
        }),
      });
    } catch {
      db.prepare("DELETE FROM account_tokens WHERE token_hash=?").run(
        accountHash(token),
      );
      fail(
        503,
        "Email delivery is temporarily unavailable. Please try again later.",
      );
    }
  }
  async function neutralMail(address: string) {
    try {
      await mailer({
        to: address,
        subject: "Your Reach account request",
        kind: "account-request",
        ...renderEmail({
          heading: "Your Reach account request",
          paragraphs: [
            "A Reach account request was made for this address. If you did not request this, ignore this email.",
          ],
          action: {
            label: "Visit your account",
            url: `${canonicalAccountOrigin()}/account`,
          },
        }),
      });
    } catch {
      fail(
        503,
        "Email delivery is temporarily unavailable. Please try again later.",
      );
    }
  }
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
      if (route === "status" && request.method === "GET")
        return accountResponse({
          enabled: featureEnabled("accounts"),
          emailConfigured: emailReady(),
          deliveryMode: emailDeliveryMode(),
        });
      if (!featureEnabled("accounts"))
        fail(503, "Accounts are currently unavailable.");
      const db = openCommunityDatabase(databasePath),
        at = clock();
      initializeNotifications(db);
      accountRate(db, "global:requests", 600, 60, +at);
      const actor = getAccountActor(db, request, at);
      if (request.method === "GET") {
        if (route === "me") {
          const row = actor
            ? db
                .prepare("SELECT preferences FROM users WHERE id=?")
                .get(actor.id)
            : null;
          return accountResponse({
            user: actor,
            preferences: row ? JSON.parse(String(row.preferences)) : {},
          });
        }
        if (route === "locations") {
          if (!actor) fail(401, "Sign in to continue.");
          const rows = db
            .prepare(
              "SELECT id,label,lat,lng FROM account_locations WHERE user_id=? ORDER BY created_at",
            )
            .all(actor.id);
          return accountResponse({
            locations: rows.map((row) => ({
              id: row.id,
              label: row.label,
              coordinates: { lat: row.lat, lng: row.lng },
            })),
          });
        }
        fail(404, "Not found.");
      }
      if (!["POST", "PATCH", "DELETE"].includes(request.method))
        fail(405, "Method not allowed.");
      accountRate(db, "global:mutations", 120, 60, +at);
      if (
        ["signup", "login", "forgot-password"].includes(route) &&
        request.method === "POST"
      ) {
        if (route === "signup" && !options.allowRegistration)
          fail(403, "Account creation is currently unavailable.");
        const schema =
          route === "signup"
            ? z
                .object({
                  email,
                  name,
                  password,
                  adultConfirmed: z.literal(true),
                })
                .strict()
            : route === "login"
              ? z.object({ email, password: credentialPassword }).strict()
              : z.object({ email }).strict();
        const data = await body<{
          email: string;
          password?: string;
          name?: string;
        }>(request, schema);
        accountRate(db, "auth:global", 50, 900, +at);
        accountRate(
          db,
          `auth:address:${accountHash(data.email)}`,
          10,
          900,
          +at,
        );
        if (route !== "login" && !emailReady())
          fail(503, "Account email is not configured. Please try again later.");
        const row = db
          .prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE")
          .get(data.email);
        if (route === "login") {
          if (
            !(await verifyAccountPassword(
              data.password!,
              row as { password_hash: unknown; salt: unknown } | undefined,
            )) ||
            !row
          )
            fail(401, "Email or password is incorrect.");
          const upgraded = String(row.password_hash).startsWith("$argon2id$")
            ? null
            : await hashAccountPassword(data.password!);
          const sessionCookies = accountTransaction(db, () => {
            const live = db
              .prepare("SELECT password_version FROM users WHERE id=?")
              .get(String(row.id));
            if (!live || live.password_version !== row.password_version)
              fail(401, "Email or password is incorrect.");
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
        if (route === "signup") {
          const input = data as {
            email: string;
            name: string;
            password: string;
          };
          const hashed = await hashAccountPassword(input.password); // equal work for existing addresses
          if (!row) {
            const id = randomUUID();
            const inserted = db
              .prepare(
                "INSERT OR IGNORE INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,name) VALUES(?,?,?,?,?,1,?,?,?)",
              )
              .run(
                id,
                `account_${id.replaceAll("-", "")}`,
                hashed,
                "",
                "resident",
                at.toISOString(),
                input.email,
                input.name,
              );
            if (inserted.changes)
              await issueMail(db, id, input.email, "verify");
            else await neutralMail(input.email);
          } else await neutralMail(input.email);
        } else if (row)
          await issueMail(db, String(row.id), data.email, "reset");
        else await neutralMail(data.email);
        return accountResponse(requestNotice(), 202);
      }
      if (
        ["verify-email", "reset-password"].includes(route) &&
        request.method === "POST"
      ) {
        const data = await body<{ token: string; password?: string }>(
          request,
          route === "verify-email"
            ? z.object({ token: tokenSchema }).strict()
            : z.object({ token: tokenSchema, password }).strict(),
        );
        accountRate(db, "tokens:global", 50, 900, +at);
        const purpose = route === "verify-email" ? "verify" : "reset";
        const hashed =
          purpose === "reset"
            ? await hashAccountPassword(data.password!)
            : null;
        accountTransaction(db, () => {
          // Email attachment has its own token table: reset tokens can never
          // attach an address and an attachment token can never reset a password.
          const claim =
            purpose === "verify"
              ? db
                  .prepare(
                    "SELECT * FROM account_email_claims WHERE token_hash=? AND expires_at>?",
                  )
                  .get(accountHash(data.token), clock().toISOString())
              : null;
          if (claim) {
            const owner = db
              .prepare("SELECT email,password_version FROM users WHERE id=?")
              .get(String(claim.user_id));
            if (
              !owner ||
              owner.email !== null ||
              owner.password_version !== claim.password_version ||
              db
                .prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE")
                .get(String(claim.email))
            )
              fail(
                400,
                "This link is invalid or expired. Request a new email.",
              );
            db.prepare(
              "UPDATE users SET email=?,email_verified_at=? WHERE id=? AND email IS NULL",
            ).run(
              String(claim.email),
              clock().toISOString(),
              String(claim.user_id),
            );
            db.prepare("DELETE FROM account_email_claims WHERE user_id=?").run(
              String(claim.user_id),
            );
            queueNotification(
              db,
              {
                eventKey: `email-attached:${randomUUID()}`,
                userId: String(claim.user_id),
                category: "security",
                kind: "email-attached",
              },
              clock(),
            );
            return;
          }
          const row = db
            .prepare(
              "SELECT * FROM account_tokens WHERE token_hash=? AND purpose=? AND expires_at>?",
            )
            .get(accountHash(data.token), purpose, clock().toISOString());
          if (!row)
            fail(400, "This link is invalid or expired. Request a new email.");
          db.prepare("DELETE FROM account_tokens WHERE token_hash=?").run(
            accountHash(data.token),
          );
          if (purpose === "verify")
            db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(
              clock().toISOString(),
              String(row.user_id),
            );
          else {
            db.prepare(
              "UPDATE users SET password_hash=?,salt='',password_version=password_version+1 WHERE id=?",
            ).run(hashed!, String(row.user_id));
            revoke(db, String(row.user_id));
          }
          queueNotification(
            db,
            {
              eventKey: `account-security:${randomUUID()}`,
              userId: String(row.user_id),
              category: "security",
              kind:
                purpose === "verify" ? "email-verified" : "password-changed",
            },
            clock(),
          );
        });
        return accountResponse(
          { ok: true },
          200,
          purpose === "reset" ? cookies(request) : [],
        );
      }
      if (route === "logout" && request.method === "POST") {
        await body(request, empty);
        for (const token of accountSessionTokens(request))
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            accountHash(token),
          );
        return accountResponse({ ok: true }, 200, cookies(request));
      }
      if (!actor) fail(401, "Sign in to continue.");
      accountRate(db, `user:${actor.id}`, 40, 60, +at);
      if (route === "attach-email" && request.method === "POST") {
        const data = await body(
          request,
          z.object({ email, currentPassword: credentialPassword }).strict(),
        );
        if (actor.email !== null)
          fail(409, "This account already has an email address.");
        if (!emailReady())
          fail(503, "Account email is not configured. Please try again later.");
        accountRate(db, "auth:global", 50, 900, +at);
        accountRate(
          db,
          `auth:address:${accountHash(data.email)}`,
          10,
          900,
          +at,
        );
        accountRate(db, `password:${actor.id}`, 5, 900, +at);
        accountRate(db, `attachment:${actor.id}`, 3, 3600, +at);
        const row = db.prepare("SELECT * FROM users WHERE id=?").get(actor.id);
        if (
          !(await verifyAccountPassword(
            data.currentPassword,
            row as { password_hash: unknown; salt: unknown } | undefined,
          )) ||
          !row
        )
          fail(401, "Password is incorrect.");
        const rawToken = randomBytes(32).toString("hex");
        const issued = accountTransaction(db, () => {
          const live = db
            .prepare("SELECT email,password_version FROM users WHERE id=?")
            .get(actor.id);
          if (
            !live ||
            live.password_version !== row.password_version ||
            getAccountActor(db, request, clock())?.id !== actor.id
          )
            fail(401, "Sign in again to continue.");
          if (live.email !== null)
            fail(409, "This account already has an email address.");
          db.prepare(
            "DELETE FROM account_email_claims WHERE user_id=? OR expires_at<=?",
          ).run(actor.id, clock().toISOString());
          if (
            db
              .prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE")
              .get(data.email)
          )
            return false;
          db.prepare(
            "INSERT INTO account_email_claims VALUES(?,?,?,?,?,?)",
          ).run(
            accountHash(rawToken),
            actor.id,
            data.email,
            Number(live.password_version),
            new Date(+clock() + 86400000).toISOString(),
            clock().toISOString(),
          );
          return true;
        });
        if (issued) {
          try {
            await mailer({
              to: data.email,
              subject: "Verify your Reach email",
              kind: "account-attachment",
              ...renderEmail({
                heading: "Confirm your Reach email",
                paragraphs: [
                  "Confirm this email address for your existing account. This link expires in 24 hours and can be used once. If you did not request this, ignore this email.",
                ],
                action: {
                  label: "Confirm email",
                  url: `${canonicalAccountOrigin()}/account#verify=${rawToken}`,
                },
              }),
            });
          } catch {
            db.prepare(
              "DELETE FROM account_email_claims WHERE token_hash=?",
            ).run(accountHash(rawToken));
            fail(
              503,
              "Email delivery is temporarily unavailable. Please try again later.",
            );
          }
        } else await neutralMail(data.email);
        return accountResponse(requestNotice(), 202);
      }
      if (route === "resend-verification" && request.method === "POST") {
        await body(request, empty);
        if (!emailReady())
          fail(503, "Account email is not configured. Please try again later.");
        accountRate(db, `verification:${actor.id}`, 3, 3600, +at);
        if (actor.email && !actor.emailVerified)
          await issueMail(db, actor.id, actor.email, "verify");
        return accountResponse(requestNotice(), 202);
      }
      if (route === "profile" && request.method === "PATCH") {
        const data = await body(
          request,
          z
            .object({
              name,
              preferences: z
                .object({
                  accessibility: z.enum(["standard", "step-free"]).optional(),
                  transportation: z
                    .enum(["walk", "transit", "drive"])
                    .optional(),
                })
                .strict()
                .optional(),
            })
            .strict(),
        );
        db.prepare("UPDATE users SET name=? WHERE id=?").run(
          data.name,
          actor.id,
        );
        if (data.preferences)
          db.prepare("UPDATE users SET preferences=? WHERE id=?").run(
            JSON.stringify(data.preferences),
            actor.id,
          );
        return accountResponse({ user: { ...actor, name: data.name } });
      }
      if (route === "locations" && request.method === "POST") {
        const data = await body(
          request,
          z
            .object({
              label: z.string().trim().min(1).max(80),
              coordinates: z
                .object({
                  lat: z.number().min(-90).max(90),
                  lng: z.number().min(-180).max(180),
                })
                .strict(),
              consent: z.literal(true),
            })
            .strict(),
        );
        const id = randomUUID();
        accountTransaction(db, () => {
          if (
            Number(
              db
                .prepare(
                  "SELECT count(*) AS n FROM account_locations WHERE user_id=?",
                )
                .get(actor.id)!.n,
            ) >= 10
          )
            fail(409, "You can save up to 10 locations.");
          db.prepare("INSERT INTO account_locations VALUES(?,?,?,?,?,?)").run(
            id,
            actor.id,
            data.label,
            data.coordinates.lat,
            data.coordinates.lng,
            at.toISOString(),
          );
        });
        return accountResponse(
          {
            location: { id, label: data.label, coordinates: data.coordinates },
          },
          201,
        );
      }
      if (route === "locations" && request.method === "DELETE") {
        const data = await body(
          request,
          z.object({ id: z.string().uuid() }).strict(),
        );
        db.prepare(
          "DELETE FROM account_locations WHERE id=? AND user_id=?",
        ).run(data.id, actor.id);
        return accountResponse({ ok: true });
      }
      if (
        (route === "change-password" && request.method === "POST") ||
        (route === "delete" && request.method === "DELETE")
      ) {
        const data = await body<
          | { password: string; confirmation: "DELETE" }
          | { currentPassword: string; newPassword: string }
        >(
          request,
          route === "delete"
            ? z
                .object({
                  password: credentialPassword,
                  confirmation: z.literal("DELETE"),
                })
                .strict()
            : z
                .object({
                  currentPassword: credentialPassword,
                  newPassword: password,
                })
                .strict(),
        );
        accountRate(db, `password:${actor.id}`, 5, 900, +at);
        const row = db.prepare("SELECT * FROM users WHERE id=?").get(actor.id)!;
        const inputPassword =
          "currentPassword" in data ? data.currentPassword : data.password;
        if (
          !(await verifyAccountPassword(
            inputPassword,
            row as { password_hash: unknown; salt: unknown },
          ))
        )
          fail(401, "Password is incorrect.");
        const hashed =
          "newPassword" in data
            ? await hashAccountPassword(data.newPassword)
            : null;
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
          if (route === "delete") deleteAccount(db, actor.id);
          else {
            db.prepare(
              "UPDATE users SET password_hash=?,salt='',password_version=password_version+1 WHERE id=?",
            ).run(hashed!, actor.id);
            revoke(db, actor.id);
            queueNotification(
              db,
              {
                eventKey: `password-changed:${actor.id}:${Number(live.password_version) + 1}`,
                userId: actor.id,
                category: "security",
                kind: "password-changed",
              },
              clock(),
            );
          }
        });
        return accountResponse({ ok: true }, 200, cookies(request));
      }
      fail(404, "Not found.");
    } catch (error) {
      if (error instanceof AccountError)
        return accountResponse({ error: error.message }, error.status);
      return accountResponse(
        { error: "Account service is temporarily unavailable." },
        503,
      );
    }
  };
}
