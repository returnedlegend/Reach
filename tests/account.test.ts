import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountHandler } from "../src/lib/account";
import { createModerator, openCommunityDatabase } from "../src/lib/community";
import { randomBytes } from "node:crypto";
import { accountHash } from "../src/lib/account-store";
import type { AccountMail } from "../src/lib/mail-account";
const password = "long-test-password-123";
let directory: string,
  database: string,
  handle: ReturnType<typeof createAccountHandler>,
  mails: AccountMail[],
  instant: Date;
async function call(
  route: string,
  method = "GET",
  data?: unknown,
  cookie?: string,
) {
  return handle(
    new Request(`http://localhost/api/account/${route}`, {
      method,
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      ...(method !== "GET" ? { body: JSON.stringify(data ?? {}) } : {}),
    }),
  );
}
function token(purpose: "verify" | "reset") {
  return mails
    .findLast((m) => m.text.includes(`#${purpose}=`))!
    .text.match(new RegExp(`#${purpose}=([a-f0-9]{64})`))![1];
}
async function signup(email = "alice@example.com") {
  return call("signup", "POST", {
    email,
    name: "Alice",
    password,
    adultConfirmed: true,
  });
}
async function login(email = "alice@example.com", value = password) {
  const response = await call("login", "POST", { email, password: value });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie()[0].split(";")[0];
}
function legacy(username = "legacy") {
  createModerator(username, password, database);
  const db = openCommunityDatabase(database),
    row = db.prepare("SELECT id FROM users WHERE username=?").get(username)!;
  const session = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(session),
    String(row.id),
    new Date(+instant + 7 * 86400000).toISOString(),
  );
  return { id: String(row.id), cookie: `reach_community_session=${session}` };
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-account-"));
  database = join(directory, "app.sqlite");
  mails = [];
  instant = new Date();
  process.env.REACH_APP_ORIGIN = "http://localhost";
  handle = createAccountHandler(database, {
    sendMail: async (mail) => {
      mails.push(mail);
    },
    now: () => instant,
  });
});
afterEach(() => {
  delete process.env.REACH_APP_ORIGIN;
  rmSync(directory, { recursive: true, force: true });
});
describe("account lifecycle", () => {
  it("normalizes email, protects stored credentials and shares private root sessions", async () => {
    const signupResponse = await signup(" ALICE@EXAMPLE.COM ");
    expect(signupResponse.status).toBe(202);
    expect(signupResponse.headers.get("set-cookie")).toBeNull();
    const row = openCommunityDatabase(database)
      .prepare("SELECT * FROM users")
      .get()!;
    expect(row.email).toBe("alice@example.com");
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.pantry_role).toBe("user");
    expect(JSON.stringify(row)).not.toContain(password);
    const cookie = await login();
    const me = await call("me", "GET", undefined, cookie);
    expect(me.headers.get("cache-control")).toBe("no-store");
    expect((await me.json()).user).toMatchObject({
      email: "alice@example.com",
      name: "Alice",
      emailVerified: false,
      role: "user",
    });
    const loginResponse = await call("login", "POST", {
      email: "alice@example.com",
      password,
    });
    expect(loginResponse.headers.getSetCookie()[0]).toContain(
      "HttpOnly; SameSite=Strict; Path=/;",
    );
    expect(loginResponse.headers.getSetCookie()[1]).toContain(
      "Path=/api/community; Max-Age=0",
    );
    expect((await call("logout", "POST", {}, cookie)).status).toBe(200);
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).user,
    ).toBeNull();
  });
  it("keeps signup and recovery responses generic and rejects unexpected privileges", async () => {
    const first = await signup();
    const second = await signup();
    expect(await first.json()).toEqual(await second.json());
    const found = await call("forgot-password", "POST", {
      email: "alice@example.com",
    });
    const missing = await call("forgot-password", "POST", {
      email: "nobody@example.com",
    });
    expect(await found.json()).toEqual(await missing.json());
    expect(
      (
        await call("signup", "POST", {
          email: "admin@example.com",
          name: "Admin",
          password,
          adultConfirmed: true,
          role: "administrator",
        })
      ).status,
    ).toBe(400);
    for (const email of ["alice@example.com", "nobody@example.com"])
      expect(
        (await call("login", "POST", { email, password: "wrong-password-123" }))
          .status,
      ).toBe(401);
  });
  it("stores hashed purpose-bound single-use tokens and expires links", async () => {
    await signup();
    const verify = token("verify"),
      db = openCommunityDatabase(database);
    expect(
      db.prepare("SELECT token_hash FROM account_tokens").get()!.token_hash,
    ).toBe(accountHash(verify));
    expect(
      (await call("reset-password", "POST", { token: verify, password }))
        .status,
    ).toBe(400);
    expect((await call("verify-email", "POST", { token: verify })).status).toBe(
      200,
    );
    expect((await call("verify-email", "POST", { token: verify })).status).toBe(
      400,
    );
    const cookie = await login();
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).user
        .emailVerified,
    ).toBe(true);
    await call("forgot-password", "POST", { email: "alice@example.com" });
    const reset = token("reset");
    instant = new Date(+instant + 31 * 60000);
    expect(
      (await call("reset-password", "POST", { token: reset, password })).status,
    ).toBe(400);
  });
  it("allows exactly one reset and revokes all sessions and remaining email links", async () => {
    await signup();
    const first = await login(),
      second = await login();
    await call("forgot-password", "POST", { email: "alice@example.com" });
    const reset = token("reset"),
      nextPassword = "new-secure-password-123";
    const results = await Promise.all(
      [1, 2].map(() =>
        call("reset-password", "POST", {
          token: reset,
          password: nextPassword,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    for (const cookie of [first, second])
      expect(
        (await (await call("me", "GET", undefined, cookie)).json()).user,
      ).toBeNull();
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT count(*) AS n FROM account_tokens")
        .get()!.n,
    ).toBe(0);
    await login("alice@example.com", nextPassword);
  });
  it("changes profile and password with reauthentication and session revocation", async () => {
    await signup();
    const cookie = await login();
    expect(
      (
        await call(
          "profile",
          "PATCH",
          { name: "New name", preferences: { transportation: "transit" } },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).preferences,
    ).toEqual({ transportation: "transit" });
    expect(
      (
        await call(
          "change-password",
          "POST",
          { currentPassword: "wrong-password-123", newPassword: password },
          cookie,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          "change-password",
          "POST",
          {
            currentPassword: password,
            newPassword: "replacement-password-123",
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).user,
    ).toBeNull();
    await login("alice@example.com", "replacement-password-123");
  });
  it("keeps saved locations private and deletes account material transactionally", async () => {
    await signup();
    const alice = await login();
    await signup("bob@example.com");
    const bob = await login("bob@example.com");
    const saved = await call(
      "locations",
      "POST",
      {
        label: "Library",
        coordinates: { lat: 30.6, lng: -96.3 },
        consent: true,
      },
      alice,
    );
    const location = (await saved.json()).location;
    expect(
      (await (await call("locations", "GET", undefined, bob)).json()).locations,
    ).toEqual([]);
    await call("locations", "DELETE", { id: location.id }, bob);
    expect(
      (await (await call("locations", "GET", undefined, alice)).json())
        .locations,
    ).toHaveLength(1);
    expect(
      (
        await call(
          "delete",
          "DELETE",
          { password, confirmation: "DELETE" },
          alice,
        )
      ).status,
    ).toBe(200);
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT count(*) AS n FROM account_locations")
        .get()!.n,
    ).toBe(0);
    expect(
      (await (await call("me", "GET", undefined, alice)).json()).user,
    ).toBeNull();
    expect(
      (await (await call("me", "GET", undefined, bob)).json()).user,
    ).not.toBeNull();
  });
  it("requires canonical email setup and reports delivery failure honestly", async () => {
    delete process.env.REACH_APP_ORIGIN;
    expect(
      (
        await call("signup", "POST", {
          email: "a@example.com",
          name: "A",
          password,
          adultConfirmed: true,
        })
      ).status,
    ).toBe(503);
    process.env.REACH_APP_ORIGIN = "http://localhost";
    handle = createAccountHandler(database, {
      sendMail: async () => {
        throw Error("mail transport offline");
      },
    });
    expect((await signup()).status).toBe(503);
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT count(*) AS n FROM account_tokens")
        .get()!.n,
    ).toBe(0);
    for (const email of ["alice@example.com", "missing@example.com"])
      expect((await call("forgot-password", "POST", { email })).status).toBe(
        503,
      );
  });
  it("enforces rate limits, same-origin JSON and bounded bodies", async () => {
    expect(
      (
        await handle(
          new Request("http://localhost/api/account/login", {
            method: "POST",
            headers: {
              origin: "https://evil.example",
              "content-type": "application/json",
            },
            body: JSON.stringify({ email: "alice@example.com", password }),
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("login", "POST", {
          email: "alice@example.com",
          password: "x".repeat(9000),
        })
      ).status,
    ).toBe(413);
    for (let i = 0; i < 10; i++)
      expect(
        (
          await call("login", "POST", {
            email: "missing@example.com",
            password,
          })
        ).status,
      ).toBe(401);
    expect(
      (await call("login", "POST", { email: "missing@example.com", password }))
        .status,
    ).toBe(429);
  });
});

describe("legacy account email attachment", () => {
  it("requires password and recipient confirmation while preserving identity and roles", async () => {
    const user = legacy();
    expect(
      (
        await call("attach-email", "POST", {
          email: "legacy@example.com",
          currentPassword: password,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: "legacy@example.com", currentPassword: "wrong" },
          user.cookie,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: " LEGACY@EXAMPLE.COM ", currentPassword: password },
          user.cookie,
        )
      ).status,
    ).toBe(202);
    const db = openCommunityDatabase(database);
    expect(
      db.prepare("SELECT email FROM users WHERE id=?").get(user.id)!.email,
    ).toBeNull();
    const claim = token("verify");
    expect(
      db
        .prepare("SELECT token_hash FROM account_email_claims WHERE user_id=?")
        .get(user.id)!.token_hash,
    ).toBe(accountHash(claim));
    expect(
      (
        await call("reset-password", "POST", {
          token: claim,
          password: "different-password-123",
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
        .prepare(
          "SELECT id,email,role,pantry_role,username FROM users WHERE id=?",
        )
        .get(user.id),
    ).toMatchObject({
      id: user.id,
      email: "legacy@example.com",
      role: "moderator",
      pantry_role: "user",
      username: "legacy",
    });
    const cookie = await login("legacy@example.com");
    expect(
      (await (await call("me", "GET", undefined, cookie)).json()).user,
    ).toMatchObject({ id: user.id, emailVerified: true });
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: "changed@example.com", currentPassword: password },
          cookie,
        )
      ).status,
    ).toBe(409);
  });
  it("replaces pending attachment and expires unused links", async () => {
    const user = legacy();
    await call(
      "attach-email",
      "POST",
      { email: "first@example.com", currentPassword: password },
      user.cookie,
    );
    const first = token("verify");
    await call(
      "attach-email",
      "POST",
      { email: "second@example.com", currentPassword: password },
      user.cookie,
    );
    const second = token("verify");
    expect((await call("verify-email", "POST", { token: first })).status).toBe(
      400,
    );
    instant = new Date(+instant + 25 * 3600000);
    expect((await call("verify-email", "POST", { token: second })).status).toBe(
      400,
    );
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT email FROM users WHERE id=?")
        .get(user.id)!.email,
    ).toBeNull();
  });
  it("never merges identities or takes an occupied address, including concurrent claims", async () => {
    await signup("occupied@example.com");
    const one = legacy("legacy_one"),
      two = legacy("legacy_two");
    const before = mails.length;
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: "occupied@example.com", currentPassword: password },
          one.cookie,
        )
      ).status,
    ).toBe(202);
    expect(mails[before].text).not.toContain("#verify=");
    await call(
      "attach-email",
      "POST",
      { email: "shared@example.com", currentPassword: password },
      one.cookie,
    );
    const first = token("verify");
    await call(
      "attach-email",
      "POST",
      { email: "shared@example.com", currentPassword: password },
      two.cookie,
    );
    const second = token("verify");
    const responses = await Promise.all(
      [first, second].map((token) => call("verify-email", "POST", { token })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    const db = openCommunityDatabase(database);
    expect(db.prepare("SELECT count(*) AS n FROM users").get()!.n).toBe(3);
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM users WHERE email='shared@example.com'",
        )
        .get()!.n,
    ).toBe(1);
    expect(
      db.prepare("SELECT count(*) AS n FROM users WHERE email IS NULL").get()!
        .n,
    ).toBe(1);
  });
  it("revokes pending attachments on password change and account deletion", async () => {
    const user = legacy();
    await call(
      "attach-email",
      "POST",
      { email: "legacy@example.com", currentPassword: password },
      user.cookie,
    );
    const claim = token("verify");
    expect(
      (
        await call(
          "change-password",
          "POST",
          {
            currentPassword: password,
            newPassword: "replacement-password-123",
          },
          user.cookie,
        )
      ).status,
    ).toBe(200);
    expect((await call("verify-email", "POST", { token: claim })).status).toBe(
      400,
    );
    const other = legacy("legacy_other");
    await call(
      "attach-email",
      "POST",
      { email: "other@example.com", currentPassword: password },
      other.cookie,
    );
    expect(
      (
        await call(
          "delete",
          "DELETE",
          { password, confirmation: "DELETE" },
          other.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      openCommunityDatabase(database)
        .prepare("SELECT count(*) AS n FROM account_email_claims")
        .get()!.n,
    ).toBe(0);
  });
  it("leaves no claim or email on delivery failure and rejects privilege fields", async () => {
    const user = legacy();
    expect(
      (
        await call(
          "attach-email",
          "POST",
          {
            email: "legacy@example.com",
            currentPassword: password,
            role: "administrator",
          },
          user.cookie,
        )
      ).status,
    ).toBe(400);
    handle = createAccountHandler(database, {
      sendMail: async () => {
        throw Error("mail transport offline");
      },
    });
    expect(
      (
        await call(
          "attach-email",
          "POST",
          { email: "legacy@example.com", currentPassword: password },
          user.cookie,
        )
      ).status,
    ).toBe(503);
    const db = openCommunityDatabase(database);
    expect(
      db.prepare("SELECT email FROM users WHERE id=?").get(user.id)!.email,
    ).toBeNull();
    expect(
      db.prepare("SELECT count(*) AS n FROM account_email_claims").get()!.n,
    ).toBe(0);
  });
});

it("accepts only direct local hosts when Next rewrites the development request URL", async () => {
  delete process.env.REACH_APP_ORIGIN;
  async function local(host: string, origin: string, forwarded?: string) {
    return handle(
      new Request("http://localhost:3060/api/account/logout", {
        method: "POST",
        headers: {
          host,
          origin,
          "content-type": "application/json",
          ...(forwarded ? { "x-forwarded-host": forwarded } : {}),
        },
        body: "{}",
      }),
    );
  }
  expect((await local("127.0.0.1:3060", "http://127.0.0.1:3060")).status).toBe(
    200,
  );
  expect((await local("127.0.0.1:3060", "http://evil.example")).status).toBe(
    403,
  );
  expect((await local("evil.example", "http://evil.example")).status).toBe(503);
  expect(
    (await local("localhost:3060", "http://evil.example", "evil.example"))
      .status,
  ).toBe(403);
});
