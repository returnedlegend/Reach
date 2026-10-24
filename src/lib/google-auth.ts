import { featureEnabled } from "./release-features";
import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { JWTPayload } from "jose";
import { z } from "zod";
import { googleAuthConfiguration } from "./google-auth-config";
import { canonicalAccountOrigin } from "./auth-origin";
import {
  googleIdentityClaims,
  createGoogleIdentityVerifier,
} from "./google-identity";
import { accountResponse, makeSession } from "./account";
import {
  AccountError,
  accountHash,
  accountRate,
  accountTransaction,
  accountSessionTokens,
  getAccountActor,
} from "./account-store";
import { openCommunityDatabase } from "./community";
import {
  requireSameOrigin,
  readPrivateJson,
  accessFailure,
} from "./access-http";
import { verifyAccountPassword } from "./auth-password";

if (typeof window !== "undefined")
  throw new Error("Google authentication is server-only.");
const FLOW_COOKIE = "reach_google_oauth";
const TTL = 600_000;
const hex = () => randomBytes(32).toString("hex");
const startSchema = z
  .object({
    intent: z.enum(["signin", "link"]),
    adultConfirmed: z.literal(true),
  })
  .strict();

function initialize(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS google_identities(
    issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    linked_at TEXT NOT NULL, PRIMARY KEY(issuer,subject));
    CREATE TABLE IF NOT EXISTS google_oauth_flows(
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce_hash TEXT NOT NULL, verifier TEXT NOT NULL,
    intent TEXT NOT NULL CHECK(intent IN ('signin','link')), user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    session_hash TEXT, expires_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS google_flow_expiry ON google_oauth_flows(expires_at);`);
}
function flowCookie(origin: string, value = "", maxAge = 0) {
  return `${FLOW_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=${maxAge}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
function browserToken(request: Request) {
  const values = (request.headers.get("cookie") || "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${FLOW_COOKIE}=`));
  const value =
    values.length === 1 ? values[0].slice(FLOW_COOKIE.length + 1) : "";
  return /^[a-f0-9]{64}$/.test(value) ? value : "";
}
function redirect(origin: string, result: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: `${origin}/account#google=${result}`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  for (const cookie of [flowCookie(origin), ...cookies])
    headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
function hasPassword(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT password_hash FROM users WHERE id=?").get(id);
  return (
    !!row && /^(?:\$argon2id\$|[a-f0-9]{128}$)/.test(String(row.password_hash))
  );
}
async function tokenResponse(response: Response) {
  if (!response.ok) throw new Error("Google sign-in unavailable.");
  if (Number(response.headers.get("content-length")) > 65536)
    throw new Error("Response limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response.");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new Error("Response limit.");
    }
    parts.push(part.value);
  }
  return z
    .object({ id_token: z.string().min(1).max(16000) })
    .parse(JSON.parse(Buffer.concat(parts).toString("utf8"))).id_token;
}

/** Dependency injection is server/test-only; no request can supply a verifier. */
export function createGoogleAuthHandler(
  databasePath?: string,
  dependencies: {
    fetch?: typeof fetch;
    verifyIdToken?: (
      token: string,
      clientId: string,
      signal: AbortSignal,
      now: Date,
    ) => Promise<JWTPayload>;
    now?: () => Date;
  } = {},
) {
  const fetcher = dependencies.fetch || fetch;
  const verify =
    dependencies.verifyIdToken || createGoogleIdentityVerifier(fetcher);
  const clock = dependencies.now || (() => new Date());
  return async (request: Request, path: string): Promise<Response> => {
    const configuration = googleAuthConfiguration();
    try {
      if (path === "status" && request.method === "GET") {
        if (!featureEnabled("accounts"))
          return accountResponse({
            configured: false,
            linked: false,
            hasPassword: false,
          });
        const db = openCommunityDatabase(databasePath);
        initialize(db);
        const actor = getAccountActor(db, request, clock());
        return accountResponse({
          configured: !!configuration,
          linked:
            !!actor &&
            !!db
              .prepare("SELECT 1 FROM google_identities WHERE user_id=?")
              .get(actor.id),
          hasPassword: !!actor && hasPassword(db, actor.id),
        });
      }
      if (path === "disconnect" && request.method === "POST") {
        // Removing a saved identity must remain possible after OAuth keys are removed.
        const accountOrigin = canonicalAccountOrigin();
        if (!accountOrigin || !featureEnabled("accounts"))
          throw new AccountError(503, "Accounts are currently unavailable.");
        requireSameOrigin(request);
        if (
          request.headers.get("content-type")?.split(";")[0].trim() !==
          "application/json"
        )
          throw new AccountError(415, "Send application/json.");
        const db = openCommunityDatabase(databasePath);
        initialize(db);
        const at = clock();
        accountRate(db, "google:requests", 120, 60, +at);
        const data = await readPrivateJson(
          request,
          z.object({ currentPassword: z.string().min(1).max(128) }).strict(),
          8192,
        );
        const actor = getAccountActor(db, request, at);
        if (!actor) throw new AccountError(401, "Sign in to continue.");
        accountRate(db, `google:unlink:${actor.id}`, 5, 900, +at);
        const owner = db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(actor.id)!;
        if (
          !(await verifyAccountPassword(
            data.currentPassword,
            owner as { password_hash: unknown; salt: unknown },
          ))
        )
          throw new AccountError(
            401,
            "Password is incorrect. Set a Reach password through recovery first if you only use Google.",
          );
        accountTransaction(db, () => {
          if (
            getAccountActor(db, request, clock())?.id !== actor.id ||
            db
              .prepare("SELECT password_version FROM users WHERE id=?")
              .get(actor.id)?.password_version !== owner.password_version
          )
            throw new AccountError(401, "Sign in again to continue.");
          db.prepare("DELETE FROM google_identities WHERE user_id=?").run(
            actor.id,
          );
          db.prepare("DELETE FROM google_oauth_flows WHERE user_id=?").run(
            actor.id,
          );
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(actor.id);
        });
        return accountResponse(
          {
            message:
              "Google sign-in disconnected. Sign in with your Reach email and password.",
          },
          200,
          [
            "reach_community_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" +
              (accountOrigin.startsWith("https:") ? "; Secure" : ""),
          ],
        );
      }
      if (!configuration)
        throw new AccountError(
          503,
          "Google sign-in is not configured. Use your existing Reach sign-in or try again later.",
        );
      const db = openCommunityDatabase(databasePath);
      initialize(db);
      const at = clock();
      accountRate(db, "google:requests", 120, 60, +at);
      if (path === "start" && request.method === "POST") {
        requireSameOrigin(request);
        if (
          request.headers.get("content-type")?.split(";")[0].trim() !==
          "application/json"
        )
          throw new AccountError(415, "Send application/json.");
        const body = await readPrivateJson(request, startSchema, 8192);
        accountRate(db, "google:start", 50, 900, +at);
        const actor = getAccountActor(db, request, at);
        if (body.intent === "link" && !actor)
          throw new AccountError(
            401,
            "Sign in to your existing Reach account before linking Google.",
          );
        if (body.intent === "signin" && actor)
          throw new AccountError(
            409,
            "You are already signed in. Use Link Google in your account.",
          );
        const state = hex(),
          browser = hex(),
          nonce = hex(),
          verifier = randomBytes(48).toString("base64url");
        const session =
          body.intent === "link"
            ? accountSessionTokens(request).find(
                (t) =>
                  !!db
                    .prepare(
                      "SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?",
                    )
                    .get(accountHash(t), actor!.id, at.toISOString()),
              )
            : undefined;
        if (body.intent === "link" && !session)
          throw new AccountError(401, "Sign in again before linking Google.");
        accountTransaction(db, () => {
          db.prepare("DELETE FROM google_oauth_flows WHERE expires_at<=?").run(
            at.toISOString(),
          );
          const old = browserToken(request);
          if (old)
            db.prepare(
              "DELETE FROM google_oauth_flows WHERE browser_hash=?",
            ).run(accountHash(old));
          db.prepare(
            "INSERT INTO google_oauth_flows VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            accountHash(state),
            accountHash(browser),
            accountHash(nonce),
            verifier,
            body.intent,
            actor?.id || null,
            session ? accountHash(session) : null,
            new Date(+at + TTL).toISOString(),
          );
        });
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        for (const [key, value] of Object.entries({
          client_id: configuration.clientId,
          redirect_uri: configuration.redirectUri,
          response_type: "code",
          scope: "openid email profile",
          state,
          nonce,
          code_challenge: Buffer.from(accountHash(verifier), "hex").toString(
            "base64url",
          ),
          code_challenge_method: "S256",
          access_type: "online",
          prompt: "select_account",
        }))
          url.searchParams.set(key, value);
        return accountResponse({ url: url.toString() }, 200, [
          flowCookie(configuration.origin, browser, TTL / 1000),
        ]);
      }
      if (path === "callback" && request.method === "GET") {
        const url = new URL(request.url);
        const state = url.searchParams.get("state") || "",
          browser = browserToken(request);
        if (
          !/^[a-f0-9]{64}$/.test(state) ||
          !browser ||
          url.searchParams.getAll("state").length !== 1
        )
          return redirect(configuration.origin, "expired");
        const flow = accountTransaction(db, () =>
          db
            .prepare(
              "DELETE FROM google_oauth_flows WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *",
            )
            .get(accountHash(state), accountHash(browser), at.toISOString()),
        );
        if (!flow) return redirect(configuration.origin, "expired");
        if (url.searchParams.has("error"))
          return redirect(
            configuration.origin,
            url.searchParams.get("error") === "access_denied"
              ? "cancelled"
              : "failed",
          );
        const code = url.searchParams.get("code");
        if (
          !code ||
          code.length > 4096 ||
          /[\x00-\x20\x7f]/.test(code) ||
          url.searchParams.getAll("code").length !== 1 ||
          (url.searchParams.has("iss") &&
            url.searchParams.get("iss") !== "https://accounts.google.com")
        )
          return redirect(configuration.origin, "failed");
        const signal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(10000),
        ]);
        const response = await fetcher("https://oauth2.googleapis.com/token", {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: configuration.clientId,
            client_secret: configuration.clientSecret,
            redirect_uri: configuration.redirectUri,
            grant_type: "authorization_code",
            code,
            code_verifier: String(flow.verifier),
          }),
        });
        const idToken = await tokenResponse(response);
        const claims = googleIdentityClaims(
          await verify(idToken, configuration.clientId, signal, clock()),
          configuration.clientId,
          clock(),
        );
        if (accountHash(claims.nonce) !== flow.nonce_hash)
          return redirect(configuration.origin, "failed");
        const result = accountTransaction(db, () => {
          const identity = db
            .prepare(
              "SELECT user_id FROM google_identities WHERE issuer='https://accounts.google.com' AND subject=?",
            )
            .get(claims.sub);
          let userId: string;
          if (flow.intent === "link") {
            const owner = db
              .prepare(
                "SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE users.id=? AND sessions.token_hash=? AND sessions.expires_at>?",
              )
              .get(
                String(flow.user_id),
                String(flow.session_hash),
                clock().toISOString(),
              );
            if (!owner) return { status: "expired" };
            if (identity && identity.user_id !== owner.id)
              return { status: "conflict" };
            if (
              owner.email &&
              String(owner.email).toLowerCase() !== claims.email
            )
              return { status: "email-mismatch" };
            const existing = db
              .prepare(
                "SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>?",
              )
              .get(claims.email, String(owner.id));
            const linked = db
              .prepare("SELECT subject FROM google_identities WHERE user_id=?")
              .get(String(owner.id));
            if (existing || (linked && linked.subject !== claims.sub))
              return { status: "conflict" };
            userId = String(owner.id);
            db.prepare(
              "UPDATE users SET email=COALESCE(email,?),email_verified_at=CASE WHEN ? THEN COALESCE(email_verified_at,?) ELSE email_verified_at END WHERE id=?",
            ).run(
              claims.email,
              claims.authoritativeEmail ? 1 : 0,
              clock().toISOString(),
              userId,
            );
          } else if (identity) {
            // A changed Google profile must never silently replace or verify
            // the existing Reach email, or change the account's role.
            userId = String(identity.user_id);
          } else {
            if (
              db
                .prepare("SELECT 1 FROM users WHERE email=? COLLATE NOCASE")
                .get(claims.email)
            )
              return { status: "conflict" };
            userId = randomUUID();
            db.prepare(
              "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,name) VALUES(?,?,?,'','resident',1,?,?,?,?)",
            ).run(
              userId,
              `account_${userId.replaceAll("-", "")}`,
              "google-only",
              clock().toISOString(),
              claims.email,
              claims.authoritativeEmail ? clock().toISOString() : null,
              (claims.name || "Reach member")
                .replace(/[\x00-\x1f\x7f]/g, "")
                .slice(0, 80) || "Reach member",
            );
          }
          db.prepare(
            "INSERT OR IGNORE INTO google_identities VALUES('https://accounts.google.com',?,?,?)",
          ).run(claims.sub, userId, clock().toISOString());
          // Link rotates/revokes the initiating session as well. Callback may
          // not receive Strict account cookies after a cross-site redirect.
          if (flow.session_hash)
            db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
              String(flow.session_hash),
            );
          return {
            status: flow.intent === "link" ? "linked" : "success",
            cookies: makeSession(db, userId, request, clock()),
          };
        });
        return redirect(configuration.origin, result.status, result.cookies);
      }
      throw new AccountError(405, "Method not allowed.");
    } catch (error) {
      if (path === "callback" && configuration)
        return redirect(configuration.origin, "failed");
      return accessFailure(error);
    }
  };
}
