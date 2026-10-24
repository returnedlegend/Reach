import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createAccountHandler } from "../src/lib/account";
import { openCommunityDatabase } from "../src/lib/community";
import { accountHash } from "../src/lib/account-store";
import { openPantryDatabase } from "../src/lib/pantry-store";
import type { AccountMail } from "../src/lib/mail-account";

const origin = "https://reach.example";
const password = "independent-security-password";
const replacement = "independent-replacement-password";
let directory: string;
let database: string;
let mails: AccountMail[];
let at: Date;
let handle: ReturnType<typeof createAccountHandler>;

async function call(
  path: string,
  method = "GET",
  data?: unknown,
  cookie = "",
  headers: Record<string, string> = {},
) {
  return handle(
    new Request(`${origin}/api/account/${path}`, {
      method,
      headers: {
        ...(method !== "GET"
          ? { origin, "content-type": "application/json" }
          : {}),
        cookie,
        ...headers,
      },
      ...(method !== "GET" ? { body: JSON.stringify(data ?? {}) } : {}),
    }),
  );
}
async function register(email = "person@example.org") {
  const response = await call("signup", "POST", {
    email,
    name: "Test Person",
    password,
    adultConfirmed: true,
  });
  expect(response.status).toBe(202);
  return String(
    openCommunityDatabase(database)
      .prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE")
      .get(email.trim())!.id,
  );
}
async function login(
  email = "person@example.org",
  suppliedPassword = password,
) {
  const response = await call("login", "POST", {
    email,
    password: suppliedPassword,
  });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .find((value) => /Path=\/;/.test(value))!
    .split(";")[0];
}
function token(kind: "verify" | "reset", index = mails.length - 1) {
  const match = mails[index].text.match(new RegExp(`#${kind}=([a-f0-9]{64})`));
  expect(match).not.toBeNull();
  return match![1];
}
function legacySession() {
  const db = openCommunityDatabase(database),
    id = randomUUID(),
    salt = randomBytes(16).toString("hex"),
    raw = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?,?,?,'moderator',1,?)",
  ).run(
    id,
    `legacy_${id.replaceAll("-", "").slice(0, 20)}`,
    scryptSync(password, salt, 64).toString("hex"),
    salt,
    at.toISOString(),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(raw),
    id,
    new Date(+at + 7 * 86400000).toISOString(),
  );
  return { id, cookie: `reach_community_session=${raw}` };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-account-security-"));
  database = join(directory, "community.sqlite");
  at = new Date();
  mails = [];
  vi.stubEnv("REACH_APP_ORIGIN", origin);
  vi.stubEnv("REACH_ACCOUNT_ENABLED", "true");
  handle = createAccountHandler(database, {
    now: () => at,
    sendMail: async (mail) => {
      mails.push(mail);
    },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("independent account security boundary", () => {
  it("attaches a legacy email only after password reauthentication and recipient confirmation", async () => {
    const legacy = legacySession(),
      db = openCommunityDatabase(database);
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: "legacy@example.org", currentPassword: replacement },
          legacy.cookie,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: "Legacy@Example.org", currentPassword: password },
          legacy.cookie,
        )
      ).status,
    ).toBe(202);
    const claim = token("verify");
    expect(
      db.prepare("SELECT email FROM users WHERE id=?").get(legacy.id)!.email,
    ).toBeNull();
    expect(
      db
        .prepare("SELECT token_hash FROM account_email_claims WHERE user_id=?")
        .get(legacy.id)!.token_hash,
    ).toBe(accountHash(claim));
    expect(
      (
        await call("reset-password", "POST", {
          token: claim,
          password: replacement,
        })
      ).status,
    ).toBe(400);
    expect((await call("verify-email", "POST", { token: claim })).status).toBe(
      200,
    );
    expect((await call("verify-email", "POST", { token: claim })).status).toBe(
      400,
    );
    expect(
      db
        .prepare("SELECT id,email,role,pantry_role FROM users WHERE id=?")
        .get(legacy.id),
    ).toMatchObject({
      id: legacy.id,
      email: "legacy@example.org",
      role: "moderator",
      pantry_role: "user",
    });
    const cookie = await login("legacy@example.org");
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).user.id,
    ).toBe(legacy.id);
  });

  it("does not merge accounts when an email becomes occupied during a pending legacy claim", async () => {
    const legacy = legacySession(),
      db = openCommunityDatabase(database);
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: "claimed@example.org", currentPassword: password },
          legacy.cookie,
        )
      ).status,
    ).toBe(202);
    const claim = token("verify");
    const otherId = await register("claimed@example.org");
    expect((await call("verify-email", "POST", { token: claim })).status).toBe(
      400,
    );
    expect(
      db.prepare("SELECT email FROM users WHERE id=?").get(legacy.id)!.email,
    ).toBeNull();
    expect(
      db
        .prepare("SELECT id FROM users WHERE email='claimed@example.org'")
        .get()!.id,
    ).toBe(otherId);
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: "claimed@example.org", currentPassword: password },
          legacy.cookie,
        )
      ).status,
    ).toBe(202);
    expect(
      db
        .prepare("SELECT * FROM account_email_claims WHERE user_id=?")
        .get(legacy.id),
    ).toBeUndefined();
    expect(mails.at(-1)!.text).not.toContain("#verify=");
  });

  it("expires legacy email claims and revokes pending claims when passwords change", async () => {
    const legacy = legacySession();
    await call(
      "attach-email",
      "POST",
      { email: "legacy@example.org", currentPassword: password },
      legacy.cookie,
    );
    const expired = token("verify");
    at = new Date(+at + 86400000);
    expect(
      (await call("verify-email", "POST", { token: expired })).status,
    ).toBe(400);
    await call(
      "attach-email",
      "POST",
      { email: "legacy@example.org", currentPassword: password },
      legacy.cookie,
    );
    const revoked = token("verify");
    expect(
      (
        await call(
          "change-password",
          "POST",
          { currentPassword: password, newPassword: replacement },
          legacy.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (await call("verify-email", "POST", { token: revoked })).status,
    ).toBe(400);
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT email FROM users WHERE id=?")
        .get(legacy.id)!.email,
    ).toBeNull();
  });

  it("normalizes email, stores Argon2id and hashed tokens, and denies mass assignment", async () => {
    const id = await register("Person@Example.org");
    const db = openCommunityDatabase(database);
    const row = db.prepare("SELECT * FROM users WHERE id=?").get(id)!;
    expect(row.email).toBe("person@example.org");
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.pantry_role).toBe("user");
    const verification = token("verify");
    expect(
      db.prepare("SELECT token_hash FROM account_tokens").get()!.token_hash,
    ).toBe(accountHash(verification));
    expect(mails[0].text).toContain(`${origin}/account#verify=`);
    const cookie = await login("PERSON@example.org");
    for (const injected of [
      { role: "administrator" },
      { pantry_role: "administrator" },
      { emailVerified: true },
      { email: "victim@example.org" },
    ]) {
      expect(
        (
          await call(
            "profile",
            "PATCH",
            { name: "Changed", ...injected },
            cookie,
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await call("signup", "POST", {
          email: "other@example.org",
          name: "Other",
          password,
          adultConfirmed: true,
          role: "administrator",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "profile",
          "PATCH",
          { name: "Changed", preferences: { transportation: "transit" } },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).user.role,
    ).toBe("user");
  });

  it("matches known and unknown recovery responses even when email transport fails", async () => {
    await register();
    handle = createAccountHandler(database, {
      now: () => at,
      sendMail: async () => {
        throw new Error("test mail transport outage");
      },
    });
    const known = await call("forgot-password", "POST", {
      email: "person@example.org",
    });
    const unknown = await call("forgot-password", "POST", {
      email: "missing@example.org",
    });
    expect(known.status).toBe(unknown.status);
    expect(await known.json()).toEqual(await unknown.json());
    const duplicate = await call("signup", "POST", {
      email: "person@example.org",
      name: "Duplicate",
      password,
      adultConfirmed: true,
    });
    const fresh = await call("signup", "POST", {
      email: "fresh@example.org",
      name: "Fresh",
      password,
      adultConfirmed: true,
    });
    expect(fresh.status).toBe(duplicate.status);
    expect(await fresh.json()).toEqual(await duplicate.json());
  });

  it("enforces token purpose, expiration, replacement and one-time consumption under races", async () => {
    await register();
    const originalVerification = token("verify");
    expect(
      (
        await call("reset-password", "POST", {
          token: originalVerification,
          password: replacement,
        })
      ).status,
    ).toBe(400);
    const cookie = await login();
    expect((await call("resend-verification", "POST", {}, cookie)).status).toBe(
      202,
    );
    const verification = token("verify");
    expect(
      (await call("verify-email", "POST", { token: originalVerification }))
        .status,
    ).toBe(400);
    const verified = await Promise.all([
      call("verify-email", "POST", { token: verification }),
      call("verify-email", "POST", { token: verification }),
    ]);
    expect(verified.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    await call("forgot-password", "POST", { email: "person@example.org" });
    const expiredReset = token("reset");
    at = new Date(+at + 30 * 60 * 1000);
    expect(
      (
        await call("reset-password", "POST", {
          token: expiredReset,
          password: replacement,
        })
      ).status,
    ).toBe(400);
    await call("forgot-password", "POST", { email: "person@example.org" });
    const reset = token("reset");
    expect((await call("verify-email", "POST", { token: reset })).status).toBe(
      400,
    );
    const raced = await Promise.all([
      call("reset-password", "POST", { token: reset, password: replacement }),
      call("reset-password", "POST", { token: reset, password: replacement }),
    ]);
    expect(raced.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).user,
    ).toBeNull();
    expect(
      (await call("login", "POST", { email: "person@example.org", password }))
        .status,
    ).toBe(401);
    await login("person@example.org", replacement);
  });

  it("expires sessions and revokes all sessions and recovery links after a password change", async () => {
    await register();
    const first = await login(),
      second = await login();
    await call("forgot-password", "POST", { email: "person@example.org" });
    const reset = token("reset");
    expect(
      (
        await call(
          "change-password",
          "POST",
          { currentPassword: password, newPassword: replacement },
          first,
        )
      ).status,
    ).toBe(200);
    for (const cookie of [first, second])
      expect(
        (await (await call("me", "GET", undefined, cookie)).json()).user,
      ).toBeNull();
    expect(
      (await call("reset-password", "POST", { token: reset, password })).status,
    ).toBe(400);
    const fresh = await login("person@example.org", replacement);
    at = new Date(+at + 7 * 24 * 60 * 60 * 1000);
    expect(
      (await (await call("me", "GET", undefined, fresh)).json()).user,
    ).toBeNull();
  });

  it("rejects cross-origin requests and attacker-supplied authority and sets secure cookie boundaries", async () => {
    await register();
    const loginResponse = await call("login", "POST", {
      email: "person@example.org",
      password,
    });
    const setCookies = loginResponse.headers.getSetCookie();
    expect(setCookies[0]).toContain("HttpOnly; SameSite=Strict; Path=/;");
    expect(setCookies[0]).toContain("Secure");
    expect(setCookies[1]).toContain("Path=/api/community; Max-Age=0");
    const cookie = setCookies[0].split(";")[0];
    expect(
      (
        await call("profile", "PATCH", { name: "Attack" }, cookie, {
          origin: "https://evil.example",
          host: "evil.example",
          "x-forwarded-host": "evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "forgot-password",
          "POST",
          { email: "person@example.org" },
          "",
          { host: "evil.example", "x-forwarded-host": "evil.example" },
        )
      ).status,
    ).toBe(202);
    expect(mails.at(-1)!.text).toContain(`${origin}/account#reset=`);
    expect(mails.at(-1)!.text).not.toContain("evil.example");
    expect(loginResponse.headers.get("cache-control")).toBe("no-store");
  });

  it("preserves legacy community identities and upgrades scrypt only after a valid login", async () => {
    const db = openCommunityDatabase(database),
      id = randomUUID(),
      salt = randomBytes(16).toString("hex");
    const legacy = scryptSync(password, salt, 64).toString("hex");
    db.prepare(
      "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email) VALUES(?,?,?,?,?,1,?,?)",
    ).run(
      id,
      "old_moderator",
      legacy,
      salt,
      "moderator",
      at.toISOString(),
      "legacy@example.org",
    );
    expect(
      (
        await call("login", "POST", {
          email: "legacy@example.org",
          password: replacement,
        })
      ).status,
    ).toBe(401);
    expect(
      db.prepare("SELECT password_hash FROM users WHERE id=?").get(id)!
        .password_hash,
    ).toBe(legacy);
    const cookie = await login("legacy@example.org");
    const row = db.prepare("SELECT * FROM users WHERE id=?").get(id)!;
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.role).toBe("moderator");
    const actor = (await (await call("me", "GET", undefined, cookie)).json())
      .user;
    expect(actor.id).toBe(id);
    expect(actor.role).toBe("user");
  });

  it("keeps preferred locations private and prevents cross-account deletion", async () => {
    await register();
    await register("other@example.org");
    const owner = await login(),
      other = await login("other@example.org");
    const saved = await call(
      "locations",
      "POST",
      {
        label: "Preferred place",
        coordinates: { lat: 30.6, lng: -96.3 },
        consent: true,
      },
      owner,
    );
    expect(saved.status).toBe(201);
    const id = (await saved.json()).location.id;
    expect(
      (await (await call("locations", "GET", undefined, other)).json())
        .locations,
    ).toEqual([]);
    await call("locations", "DELETE", { id }, other);
    expect(
      (await (await call("locations", "GET", undefined, owner)).json())
        .locations,
    ).toHaveLength(1);
    expect((await call("locations")).status).toBe(401);
  });

  it("deletes accounts with legacy community references atomically and revokes access", async () => {
    const id = await register(),
      otherId = await register("other@example.org");
    const cookie = await login();
    const db = openPantryDatabase(database),
      recordId = randomUUID();
    const pantryId = String(
      db.prepare("SELECT id FROM pantries LIMIT 1").get()!.id,
    );
    db.prepare("INSERT INTO pantry_favorites VALUES(?,?,?)").run(
      id,
      pantryId,
      at.toISOString(),
    );
    db.prepare("INSERT INTO pantry_managers VALUES(?,?,?,?)").run(
      pantryId,
      id,
      otherId,
      at.toISOString(),
    );
    db.prepare(
      "INSERT INTO pantry_corrections(id,pantry_id,submitted_by,description,status,created_at) VALUES(?,?,?,'Check hours','pending',?)",
    ).run(randomUUID(), pantryId, id, at.toISOString());
    db.prepare(
      "INSERT INTO pantry_audit(actor_id,action,pantry_id,details_json,created_at) VALUES(?,'fixture',?,'{}',?)",
    ).run(id, pantryId, at.toISOString());
    await call(
      "locations",
      "POST",
      {
        label: "Private place",
        coordinates: { lat: 30.6, lng: -96.3 },
        consent: true,
      },
      cookie,
    );
    db.prepare(
      "INSERT INTO records VALUES(?,'offer',?,'draft','{}',?,?,?,?,NULL)",
    ).run(
      recordId,
      id,
      at.toISOString(),
      new Date(+at + 3600000).toISOString(),
      at.toISOString(),
      at.toISOString(),
    );
    db.prepare("INSERT INTO requests VALUES(?,?,?,'requested',1,?,?)").run(
      randomUUID(),
      recordId,
      otherId,
      at.toISOString(),
      at.toISOString(),
    );
    db.prepare("INSERT INTO photos VALUES(?,?,'image/webp')").run(
      recordId,
      Buffer.from("private-photo-fixture"),
    );
    db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(
      otherId,
      id,
      at.toISOString(),
    );
    db.prepare(
      "INSERT INTO audit(actor_id,action,target_id,created_at) VALUES(?,'fixture',?,?)",
    ).run(id, recordId, at.toISOString());
    expect(
      (
        await call(
          "delete",
          "DELETE",
          { password: replacement, confirmation: "DELETE" },
          cookie,
        )
      ).status,
    ).toBe(401);
    expect(db.prepare("SELECT id FROM users WHERE id=?").get(id)).toBeDefined();
    expect(
      (
        await call(
          "delete",
          "DELETE",
          { password, confirmation: "DELETE" },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      db.prepare("SELECT id FROM users WHERE id=?").get(id),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT id FROM users WHERE id=?").get(otherId),
    ).toBeDefined();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db.prepare("SELECT * FROM photos WHERE record_id=?").get(recordId),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT * FROM account_locations WHERE user_id=?").get(id),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT * FROM pantry_favorites WHERE user_id=?").get(id),
    ).toBeUndefined();
    expect(
      db.prepare("SELECT * FROM pantry_managers WHERE user_id=?").get(id),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT submitted_by FROM pantry_corrections WHERE pantry_id=?",
        )
        .get(pantryId)!.submitted_by,
    ).toBeNull();
    expect(
      db
        .prepare("SELECT actor_id FROM pantry_audit WHERE action='fixture'")
        .get()!.actor_id,
    ).toBeNull();
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).user,
    ).toBeNull();
  });
});
