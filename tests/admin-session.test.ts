import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAccountHandler } from "../src/lib/account";
import {
  openCommunityDatabase,
  closeCommunityDatabases,
} from "../src/lib/community";
import { hashAccountPassword } from "../src/lib/auth-password";
const origin = "https://reach.example";
let directory: string, database: string;
let handle: ReturnType<typeof createAccountHandler>;
const password = "Fixture-admin-password-123!";
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "reach-admin-session-"));
  database = join(directory, "test.sqlite");
  vi.stubEnv("REACH_APP_ORIGIN", origin);
  vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
  const db = openCommunityDatabase(database);
  for (const role of ["moderator", "resident"]) {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email) VALUES(?,?,?,'',?,1,?,?)",
    ).run(
      id,
      id,
      await hashAccountPassword(password),
      role,
      new Date().toISOString(),
      `${role}@example.test`,
    );
  }
  handle = createAccountHandler(database);
});
afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
const call = (
  route: string,
  data: unknown = {},
  cookie = "",
  requestOrigin = origin,
) =>
  handle(
    new Request(`${origin}/api/account/${route}`, {
      method: "POST",
      headers: {
        origin: requestOrigin,
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify(data),
    }),
  );
it("rejects retired registration and recovery endpoints before creating any tokens", async () => {
  for (const route of [
    "signup",
    "forgot-password",
    "reset-password",
    "verify-email",
    "resend-verification",
    "attach-email",
  ]) {
    expect(
      (await call(route, { email: "moderator@example.test" })).status,
    ).toBe(404);
  }
  expect(
    openCommunityDatabase(database)
      .prepare("SELECT count(*) n FROM account_tokens")
      .get()?.n,
  ).toBe(0);
});
it("requires a correct moderator password and the same origin", async () => {
  expect(
    (
      await call(
        "login",
        { email: "moderator@example.test", password },
        "",
        "https://other.example",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call("login", {
        email: "moderator@example.test",
        password: "incorrect",
      })
    ).status,
  ).toBe(401);
  expect(
    (await call("login", { email: "resident@example.test", password })).status,
  ).toBe(403);
  const result = await call("login", {
    email: "moderator@example.test",
    password,
  });
  expect(result.status).toBe(200);
  expect(result.headers.get("set-cookie")).toContain(
    "HttpOnly; SameSite=Strict",
  );
  expect(result.headers.get("set-cookie")).toContain("Secure");
});
it("changes the moderator password and revokes all old sessions", async () => {
  const signed = await call("login", {
    email: "moderator@example.test",
    password,
  });
  const cookie = signed.headers.getSetCookie()[0].split(";")[0];
  const changed = await call(
    "change-password",
    {
      currentPassword: password,
      newPassword: "Fixture-new-admin-password-456!",
    },
    cookie,
  );
  expect(changed.status).toBe(200);
  expect(
    openCommunityDatabase(database)
      .prepare("SELECT count(*) n FROM sessions")
      .get()?.n,
  ).toBe(0);
  expect(
    (await call("login", { email: "moderator@example.test", password })).status,
  ).toBe(401);
  expect(
    (
      await call("login", {
        email: "moderator@example.test",
        password: "Fixture-new-admin-password-456!",
      })
    ).status,
  ).toBe(200);
  expect(
    openCommunityDatabase(database)
      .prepare("SELECT count(*) n FROM notification_outbox")
      .get()?.n,
  ).toBe(0);
});
