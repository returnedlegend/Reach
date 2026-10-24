import { closeCommunityDatabases } from "../src/lib/community";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JWTPayload } from "jose";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGoogleAuthHandler } from "../src/lib/google-auth";
import { openCommunityDatabase } from "../src/lib/community";
import { accountHash, getAccountActor } from "../src/lib/account-store";
import { createAccountHandler } from "../src/lib/account";
import { hashAccountPasswordSync } from "../src/lib/auth-password";
import type { AccountMail } from "../src/lib/mail-account";

const origin = "https://reach.example.org";
const clientId = "123456-test.apps.googleusercontent.com";
const clientSecret = "GOCSPX-test-secret-123";
let directory: string;
let database: string;
let now: Date;

function configureGoogle() {
  vi.stubEnv("REACH_APP_ORIGIN", origin);
  vi.stubEnv("REACH_ACCOUNT_ENABLED", "true");
  vi.stubEnv("GOOGLE_CLIENT_ID", clientId);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", clientSecret);
}

function request(
  action: string,
  method = "GET",
  options: { body?: unknown; cookie?: string; requestOrigin?: string } = {},
) {
  const headers = new Headers();
  if (options.requestOrigin !== "none")
    headers.set("origin", options.requestOrigin ?? origin);
  if (method !== "GET") headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(`${origin}/api/auth/google/${action}`, {
    method,
    headers,
    ...(method !== "GET" ? { body: JSON.stringify(options.body ?? {}) } : {}),
  });
}

function makeVerifier(claims: (nonce: string) => JWTPayload) {
  let nonce = "";
  const verifyIdToken = vi.fn(async () => claims(nonce));
  return {
    verifyIdToken,
    setNonce(value: string) {
      nonce = value;
    },
  };
}

function claims(
  nonce: string,
  overrides: Partial<JWTPayload> = {},
): JWTPayload {
  return {
    iss: "https://accounts.google.com",
    aud: clientId,
    sub: "google-subject-fixture-1",
    exp: Math.floor(+now / 1000) + 3600,
    iat: Math.floor(+now / 1000),
    nonce,
    email: "person@gmail.com",
    email_verified: true,
    name: "Synthetic Google Account",
    ...overrides,
  };
}

function flowCookie(response: Response) {
  const value = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("reach_google_oauth="));
  expect(value).toBeDefined();
  return value!;
}

async function start(
  handle: ReturnType<typeof createGoogleAuthHandler>,
  intent: "signin" | "link" = "signin",
  cookie = "",
) {
  const response = await handle(
    request("start", "POST", {
      body: { intent, adultConfirmed: true },
      cookie,
    }),
    "start",
  );
  const { url } = await response.json();
  const cookieHeader = flowCookie(response);
  return {
    response,
    url: new URL(url),
    cookieHeader,
    cookie: cookieHeader.split(";")[0],
  };
}

async function callback(
  handle: ReturnType<typeof createGoogleAuthHandler>,
  state: string,
  cookie: string,
) {
  const url = new URL(`${origin}/api/auth/google/callback`);
  url.searchParams.set("code", "synthetic-authorization-code");
  url.searchParams.set("state", state);
  return handle(new Request(url, { headers: { cookie } }), "callback");
}

async function providerErrorCallback(
  handle: ReturnType<typeof createGoogleAuthHandler>,
  state: string,
  cookie: string,
  error: string,
) {
  const url = new URL(`${origin}/api/auth/google/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("error", error);
  return handle(new Request(url, { headers: { cookie } }), "callback");
}

function addReachAccount(
  id: string,
  email: string | null,
  options: { verified?: boolean; role?: string; passwordHash?: string } = {},
) {
  const db = openCommunityDatabase(database);
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,name,pantry_role) VALUES(?,?,?,'','resident',1,?,?,?,?,?)",
  ).run(
    id,
    `fixture_${id.replaceAll("-", "")}`,
    options.passwordHash ?? "$argon2id$fixture-not-a-valid-password-hash",
    now.toISOString(),
    email,
    options.verified ? now.toISOString() : null,
    "Synthetic Reach account",
    options.role ?? "user",
  );
  return db;
}

function addSession(
  db: ReturnType<typeof openCommunityDatabase>,
  userId: string,
) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    userId,
    new Date(+now + 60 * 60 * 1000).toISOString(),
  );
  return `reach_community_session=${token}`;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-google-auth-independent-"));
  database = join(directory, "community.sqlite");
  now = new Date("2026-10-23T12:00:00.000Z");
  configureGoogle();
});

afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("independent Google OIDC account boundary", () => {
  it("returns a safe disabled status when web OAuth credentials are absent", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const fetch = vi.fn();
    const handle = createGoogleAuthHandler(database, { fetch });

    const status = await handle(request("status"), "status");
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toContain("no-store");
    expect(await status.json()).toMatchObject({
      configured: false,
      linked: false,
      hasPassword: false,
    });
    const startResponse = await handle(
      request("start", "POST", {
        body: { intent: "signin", adultConfirmed: true },
      }),
      "start",
    );
    expect(startResponse.status).toBe(503);
    expect(startResponse.headers.getSetCookie()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses only identity scopes and binds one-time callback to state, browser cookie, nonce, and PKCE", async () => {
    const verifier = makeVerifier((nonce) => claims(nonce));
    const tokenRequests: URLSearchParams[] = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://oauth2.googleapis.com/token");
        expect(init?.redirect).toBe("error");
        expect(init?.cache).toBe("no-store");
        tokenRequests.push(new URLSearchParams(String(init?.body)));
        return Response.json({ id_token: "synthetic.signed.jwt" });
      },
    );
    const handle = createGoogleAuthHandler(database, {
      fetch,
      verifyIdToken: verifier.verifyIdToken,
      now: () => now,
    });
    const started = await start(handle);

    expect(started.response.headers.get("cache-control")).toContain("no-store");
    expect(started.url.origin + started.url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(started.url.searchParams.get("scope")).toBe("openid email profile");
    expect(started.url.searchParams.get("response_type")).toBe("code");
    expect(started.url.searchParams.get("redirect_uri")).toBe(
      `${origin}/api/auth/google/callback`,
    );
    expect(started.url.searchParams.get("prompt")).toBe("select_account");
    expect(started.url.searchParams.has("gmail")).toBe(false);
    expect(started.url.searchParams.has("access_type")).toBe(true);
    expect(started.url.searchParams.get("client_secret")).toBeNull();
    expect(started.url.searchParams.get("nonce")).toMatch(/^[a-f0-9]{64}$/);
    expect(started.url.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
    expect(started.url.searchParams.get("code_challenge_method")).toBe("S256");
    const db = openCommunityDatabase(database);
    const storedFlow = db
      .prepare("SELECT verifier FROM google_oauth_flows")
      .get() as { verifier: string };
    const expectedChallenge = createHashHex(storedFlow.verifier);
    expect(started.url.searchParams.get("code_challenge")).toBe(
      expectedChallenge,
    );
    expect(started.cookieHeader).toMatch(
      /^reach_google_oauth=[a-f0-9]{64}; HttpOnly; SameSite=Lax; Path=\/api\/auth\/google; Max-Age=600; Secure$/,
    );

    verifier.setNonce(started.url.searchParams.get("nonce")!);
    const response = await callback(
      handle,
      started.url.searchParams.get("state")!,
      started.cookie,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${origin}/account#google=success`,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(verifier.verifyIdToken).toHaveBeenCalledWith(
      "synthetic.signed.jwt",
      clientId,
      expect.any(AbortSignal),
      now,
    );
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0].get("client_secret")).toBe(clientSecret);
    expect(tokenRequests[0].get("code_verifier")).toBe(storedFlow.verifier);
    expect(tokenRequests[0].get("code")).toBe("synthetic-authorization-code");
    expect(tokenRequests[0].get("redirect_uri")).toBe(
      `${origin}/api/auth/google/callback`,
    );
    const responseCookies = response.headers.getSetCookie();
    const sessionCookie = responseCookies.find((value) =>
      value.startsWith("reach_community_session="),
    );
    expect(sessionCookie).toMatch(
      /HttpOnly; SameSite=Strict; Path=\/; Max-Age=604800; Secure/,
    );
    const rawSession = sessionCookie!.split("=")[1].split(";")[0];
    expect(rawSession).toMatch(/^[a-f0-9]{64}$/);
    expect(db.prepare("SELECT token_hash FROM sessions").get()).toEqual({
      token_hash: accountHash(rawSession),
    });
    const actor = getAccountActor(
      db,
      new Request(origin, {
        headers: { cookie: `reach_community_session=${rawSession}` },
      }),
      now,
    );
    expect(actor).toMatchObject({
      email: "person@gmail.com",
      emailVerified: true,
      role: "user",
    });
    expect(
      db.prepare("SELECT issuer,subject,user_id FROM google_identities").all(),
    ).toMatchObject([
      {
        issuer: "https://accounts.google.com",
        subject: "google-subject-fixture-1",
      },
    ]);
    const persistedFlowColumns = (
      db.prepare("PRAGMA table_info(google_oauth_flows)").all() as {
        name: string;
      }[]
    ).map((column) => column.name);
    expect(persistedFlowColumns).not.toContain("access_token");
    expect(persistedFlowColumns).not.toContain("refresh_token");
    expect(
      db.prepare("SELECT count(*) count FROM account_tokens").get(),
    ).toEqual({ count: 0 });

    const replay = await callback(
      handle,
      started.url.searchParams.get("state")!,
      started.cookie,
    );
    expect(replay.headers.get("location")).toBe(
      `${origin}/account#google=expired`,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin starts, bad state/browser bindings, and unverified claims before account creation", async () => {
    const verifier = makeVerifier((nonce) =>
      claims(nonce, { email_verified: false }),
    );
    const fetch = vi.fn(async () =>
      Response.json({ id_token: "synthetic.signed.jwt" }),
    );
    const handle = createGoogleAuthHandler(database, {
      fetch,
      verifyIdToken: verifier.verifyIdToken,
      now: () => now,
    });
    const csrf = await handle(
      request("start", "POST", {
        body: { intent: "signin", adultConfirmed: true },
        requestOrigin: "https://attacker.example",
      }),
      "start",
    );
    expect(csrf.status).toBe(403);
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT count(*) count FROM google_oauth_flows")
        .get(),
    ).toEqual({ count: 0 });

    const started = await start(handle);
    const forged = await callback(
      handle,
      started.url.searchParams.get("state")!,
      `reach_google_oauth=${randomBytes(32).toString("hex")}`,
    );
    expect(forged.headers.get("location")).toBe(
      `${origin}/account#google=expired`,
    );
    expect(fetch).not.toHaveBeenCalled();

    verifier.setNonce(started.url.searchParams.get("nonce")!);
    const rejected = await callback(
      handle,
      started.url.searchParams.get("state")!,
      started.cookie,
    );
    expect(rejected.headers.get("location")).toBe(
      `${origin}/account#google=failed`,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT count(*) count FROM users")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT count(*) count FROM sessions")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("does not merge email collisions and reuses only the same stable Google subject", async () => {
    const db = openCommunityDatabase(database);
    const existingId = randomUUID();
    addReachAccount(existingId, "PERSON@GMAIL.COM", { verified: true });
    let signInEmail = "person@gmail.com";
    const verifier = makeVerifier((nonce) =>
      claims(nonce, { email: signInEmail }),
    );
    const fetch = vi.fn(async () =>
      Response.json({ id_token: "synthetic.signed.jwt" }),
    );
    const handle = createGoogleAuthHandler(database, {
      fetch,
      verifyIdToken: verifier.verifyIdToken,
      now: () => now,
    });
    const collision = await start(handle);
    verifier.setNonce(collision.url.searchParams.get("nonce")!);
    const collisionResponse = await callback(
      handle,
      collision.url.searchParams.get("state")!,
      collision.cookie,
    );
    expect(collisionResponse.headers.get("location")).toBe(
      `${origin}/account#google=conflict`,
    );
    expect(
      collisionResponse.headers
        .getSetCookie()
        .some((value) => value.startsWith("reach_community_session=")),
    ).toBe(false);
    expect(db.prepare("SELECT count(*) count FROM users").get()).toEqual({
      count: 1,
    });
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({ count: 0 });

    vi.stubEnv("GOOGLE_CLIENT_ID", clientId);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", clientSecret);
    signInEmail = "new-person@gmail.com";
    const first = await start(handle);
    verifier.setNonce(first.url.searchParams.get("nonce")!);
    const firstResponse = await callback(
      handle,
      first.url.searchParams.get("state")!,
      first.cookie,
    );
    expect(firstResponse.headers.get("location")).toBe(
      `${origin}/account#google=success`,
    );
    const firstUserId = String(
      db.prepare("SELECT user_id FROM google_identities").get()!.user_id,
    );

    const second = await start(handle);
    verifier.setNonce(second.url.searchParams.get("nonce")!);
    const secondResponse = await callback(
      handle,
      second.url.searchParams.get("state")!,
      second.cookie,
    );
    expect(secondResponse.headers.get("location")).toBe(
      `${origin}/account#google=success`,
    );
    expect(db.prepare("SELECT user_id FROM google_identities").get()).toEqual({
      user_id: firstUserId,
    });
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) count FROM users").get()).toEqual({
      count: 2,
    });
  });

  it("links only to the explicitly authenticated account, rotates that session, and refuses identity theft", async () => {
    const ownerId = randomUUID();
    const db = addReachAccount(ownerId, "person@gmail.com", {
      verified: true,
      role: "administrator",
    });
    const oldSession = addSession(db, ownerId);
    const verifier = makeVerifier((nonce) => claims(nonce));
    const fetch = vi.fn(async () =>
      Response.json({ id_token: "synthetic.signed.jwt" }),
    );
    const handle = createGoogleAuthHandler(database, {
      fetch,
      verifyIdToken: verifier.verifyIdToken,
      now: () => now,
    });
    const linked = await start(handle, "link", oldSession);
    verifier.setNonce(linked.url.searchParams.get("nonce")!);
    const linkedResponse = await callback(
      handle,
      linked.url.searchParams.get("state")!,
      linked.cookie,
    );
    expect(linkedResponse.headers.get("location")).toBe(
      `${origin}/account#google=linked`,
    );
    const rows = db
      .prepare("SELECT user_id,subject FROM google_identities")
      .all();
    expect(rows).toEqual([
      { user_id: ownerId, subject: "google-subject-fixture-1" },
    ]);
    expect(db.prepare("SELECT token_hash FROM sessions").all()).toHaveLength(1);
    expect(
      getAccountActor(
        db,
        new Request(origin, { headers: { cookie: oldSession } }),
        now,
      ),
    ).toBeNull();
    const freshCookie = linkedResponse.headers
      .getSetCookie()
      .find((value) => value.startsWith("reach_community_session="))!
      .split(";")[0];
    expect(
      getAccountActor(
        db,
        new Request(origin, { headers: { cookie: freshCookie } }),
        now,
      ),
    ).toMatchObject({ id: ownerId, role: "administrator" });

    const otherId = randomUUID();
    addReachAccount(otherId, "other@gmail.com", { verified: true });
    db.prepare("INSERT INTO google_identities VALUES(?,?,?,?)").run(
      "https://accounts.google.com",
      "claimed-subject",
      otherId,
      now.toISOString(),
    );
    const freshRawSession = freshCookie.split("=")[1];
    const attempted = await start(handle, "link", freshCookie);
    verifier.verifyIdToken.mockImplementation(async () =>
      claims(attempted.url.searchParams.get("nonce")!, {
        sub: "claimed-subject",
      }),
    );
    const conflict = await callback(
      handle,
      attempted.url.searchParams.get("state")!,
      attempted.cookie,
    );
    expect(conflict.headers.get("location")).toBe(
      `${origin}/account#google=conflict`,
    );
    expect(
      db
        .prepare(
          "SELECT user_id FROM google_identities WHERE subject='claimed-subject'",
        )
        .get(),
    ).toEqual({ user_id: otherId });
    expect(
      getAccountActor(
        db,
        new Request(origin, {
          headers: { cookie: `reach_community_session=${freshRawSession}` },
        }),
        now,
      )?.id,
    ).toBe(ownerId);
  });

  it("rejects a wrong nonce and a callback after the ten-minute flow expiry", async () => {
    const verifier = makeVerifier((nonce) => claims(nonce));
    const fetch = vi.fn(async () =>
      Response.json({ id_token: "synthetic.signed.jwt" }),
    );
    const handle = createGoogleAuthHandler(database, {
      fetch,
      verifyIdToken: verifier.verifyIdToken,
      now: () => now,
    });
    const nonceFlow = await start(handle);
    verifier.setNonce("0".repeat(64));
    const nonceFailure = await callback(
      handle,
      nonceFlow.url.searchParams.get("state")!,
      nonceFlow.cookie,
    );
    expect(nonceFailure.headers.get("location")).toBe(
      `${origin}/account#google=failed`,
    );

    const expiredFlow = await start(handle);
    now = new Date(+now + 600_001);
    const expiryFailure = await callback(
      handle,
      expiredFlow.url.searchParams.get("state")!,
      expiredFlow.cookie,
    );
    expect(expiryFailure.headers.get("location")).toBe(
      `${origin}/account#google=expired`,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const db = openCommunityDatabase(database);
    expect(db.prepare("SELECT count(*) count FROM users").get()).toEqual({
      count: 0,
    });
    expect(db.prepare("SELECT count(*) count FROM sessions").get()).toEqual({
      count: 0,
    });
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({
      count: 0,
    });
  });

  it("returns safe fragments for provider cancellation and token-exchange failure", async () => {
    const verifier = makeVerifier((nonce) => claims(nonce));
    const fetch = vi.fn(async () => {
      throw new Error("synthetic network detail must not reach the browser");
    });
    const handle = createGoogleAuthHandler(database, {
      fetch,
      verifyIdToken: verifier.verifyIdToken,
      now: () => now,
    });
    const cancelledFlow = await start(handle);
    const cancelled = await providerErrorCallback(
      handle,
      cancelledFlow.url.searchParams.get("state")!,
      cancelledFlow.cookie,
      "access_denied",
    );
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.get("location")).toBe(
      `${origin}/account#google=cancelled`,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(
      cancelled.headers
        .getSetCookie()
        .some((value) => value.startsWith("reach_community_session=")),
    ).toBe(false);

    const failedFlow = await start(handle);
    const failed = await callback(
      handle,
      failedFlow.url.searchParams.get("state")!,
      failedFlow.cookie,
    );
    expect(failed.status).toBe(303);
    expect(failed.headers.get("location")).toBe(
      `${origin}/account#google=failed`,
    );
    expect(failed.headers.get("location")).not.toContain("network detail");
    expect(
      failed.headers
        .getSetCookie()
        .some((value) => value.startsWith("reach_community_session=")),
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT count(*) count FROM sessions")
        .get(),
    ).toEqual({
      count: 0,
    });
  });

  it("does not complete linking if the initiating Reach session is revoked before callback", async () => {
    const ownerId = randomUUID();
    const db = addReachAccount(ownerId, "person@gmail.com", { verified: true });
    const oldSession = addSession(db, ownerId);
    const verifier = makeVerifier((nonce) => claims(nonce));
    const fetch = vi.fn(async () =>
      Response.json({ id_token: "synthetic.signed.jwt" }),
    );
    const handle = createGoogleAuthHandler(database, {
      fetch,
      verifyIdToken: verifier.verifyIdToken,
      now: () => now,
    });
    const linking = await start(handle, "link", oldSession);
    verifier.setNonce(linking.url.searchParams.get("nonce")!);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(ownerId);
    const response = await callback(
      handle,
      linking.url.searchParams.get("state")!,
      linking.cookie,
    );
    expect(response.headers.get("location")).toBe(
      `${origin}/account#google=expired`,
    );
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({
      count: 0,
    });
    expect(db.prepare("SELECT count(*) count FROM sessions").get()).toEqual({
      count: 0,
    });
    expect(
      response.headers
        .getSetCookie()
        .some((value) => value.startsWith("reach_community_session=")),
    ).toBe(false);
  });

  it("requires a Reach password to disconnect Google and preserves the linked account through recovery", async () => {
    const verifier = makeVerifier((nonce) =>
      claims(nonce, { email: "google-only@gmail.com" }),
    );
    const fetch = vi.fn(async () =>
      Response.json({ id_token: "synthetic.signed.jwt" }),
    );
    const google = createGoogleAuthHandler(database, {
      fetch,
      verifyIdToken: verifier.verifyIdToken,
      now: () => now,
    });
    const started = await start(google);
    verifier.setNonce(started.url.searchParams.get("nonce")!);
    const signedIn = await callback(
      google,
      started.url.searchParams.get("state")!,
      started.cookie,
    );
    const sessionCookie = signedIn.headers
      .getSetCookie()
      .find((value) => value.startsWith("reach_community_session="))!
      .split(";")[0];
    const db = openCommunityDatabase(database);
    const status = await google(
      request("status", "GET", { cookie: sessionCookie }),
      "status",
    );
    expect(await status.json()).toMatchObject({
      configured: true,
      linked: true,
      hasPassword: false,
    });

    const disconnect = (password: string, cookie = sessionCookie) =>
      google(
        request("disconnect", "POST", {
          body: { currentPassword: password },
          cookie,
        }),
        "disconnect",
      );
    const blockedDisconnect = await disconnect("wrong-password-123");
    expect(blockedDisconnect.status).toBe(401);
    expect((await blockedDisconnect.json()).error).toContain(
      "Set a Reach password through recovery first",
    );
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({
      count: 1,
    });
    expect(
      getAccountActor(
        db,
        new Request(origin, { headers: { cookie: sessionCookie } }),
        now,
      ),
    ).not.toBeNull();

    const sent: AccountMail[] = [];
    const account = createAccountHandler(database, {
      now: () => now,
      sendMail: async (mail) => {
        sent.push(mail);
      },
    });
    const accountRequest = (path: string, body: unknown) =>
      account(
        new Request(`${origin}/api/account/${path}`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const requested = await accountRequest("forgot-password", {
      email: "google-only@gmail.com",
    });
    expect(requested.status).toBe(202);
    const resetToken = sent[0].text.match(/#reset=([a-f0-9]{64})/)?.[1];
    expect(resetToken).toMatch(/^[a-f0-9]{64}$/);
    const newPassword = "independent-google-recovery-password";
    expect(
      (
        await accountRequest("reset-password", {
          token: resetToken,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({
      count: 1,
    });
    expect(
      getAccountActor(
        db,
        new Request(origin, { headers: { cookie: sessionCookie } }),
        now,
      ),
    ).toBeNull();

    const login = await accountRequest("login", {
      email: "google-only@gmail.com",
      password: newPassword,
    });
    expect(login.status).toBe(200);
    const recoveredSession = login.headers
      .getSetCookie()
      .find((value) => value.startsWith("reach_community_session="))!
      .split(";")[0];
    const recoveredStatus = await google(
      request("status", "GET", { cookie: recoveredSession }),
      "status",
    );
    expect(await recoveredStatus.json()).toMatchObject({
      configured: true,
      linked: true,
      hasPassword: true,
    });
    const deniedWithWrongPassword = await disconnect(
      "still-wrong-password",
      recoveredSession,
    );
    expect(deniedWithWrongPassword.status).toBe(401);
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({
      count: 1,
    });
    const disconnected = await disconnect(newPassword, recoveredSession);
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toMatchObject({
      message: expect.stringContaining("disconnected"),
    });
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({
      count: 0,
    });
    expect(db.prepare("SELECT count(*) count FROM sessions").get()).toEqual({
      count: 0,
    });
  });

  it("allows a password-confirmed disconnect after Google OAuth configuration is removed", async () => {
    const ownerId = randomUUID();
    const password = "independent-password-for-google-disconnect";
    const db = addReachAccount(ownerId, "member@example.org", {
      verified: true,
      passwordHash: hashAccountPasswordSync(password),
    });
    const session = addSession(db, ownerId);
    const fetch = vi.fn();
    const google = createGoogleAuthHandler(database, { fetch, now: () => now });
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    await google(request("status", "GET", { cookie: session }), "status");
    db.prepare("INSERT INTO google_identities VALUES(?,?,?,?)").run(
      "https://accounts.google.com",
      "persisted-google-subject",
      ownerId,
      now.toISOString(),
    );
    const status = await google(
      request("status", "GET", { cookie: session }),
      "status",
    );
    expect(await status.json()).toMatchObject({
      configured: false,
      linked: true,
      hasPassword: true,
    });
    const disconnected = await google(
      request("disconnect", "POST", {
        body: { currentPassword: password },
        cookie: session,
      }),
      "disconnect",
    );
    expect(disconnected.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT count(*) count FROM google_identities").get(),
    ).toEqual({
      count: 0,
    });
    expect(db.prepare("SELECT count(*) count FROM sessions").get()).toEqual({
      count: 0,
    });
  });
});

function createHashHex(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}
