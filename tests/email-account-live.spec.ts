import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Explicit local preview only. This suite must never contact an email transport.
test("real preview signup, verification and password recovery preserve account security", async ({
  page,
}) => {
  const database = process.env.REACH_EMAIL_TEST_DB;
  const preview = process.env.REACH_EMAIL_TEST_PREVIEW_DIR;
  test.skip(
    !database || !preview,
    "Requires an isolated preview server and private /tmp fixture paths.",
  );
  if (!database!.startsWith("/tmp/") || !preview!.startsWith("/tmp/"))
    throw new Error("Use isolated /tmp paths.");
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const status = await (await page.request.get("/api/account/status")).json();
  expect(status.deliveryMode).toBe("preview");
  const db = new DatabaseSync(database!);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  const email = `preview-${randomUUID()}@example.test`;
  const password = `original-${randomUUID()}`;
  const replacement = `replacement-${randomUUID()}`;
  const base = String(test.info().project.use.baseURL);
  const captures = () =>
    existsSync(preview!)
      ? readdirSync(preview!)
          .filter((name) => name.endsWith(".json"))
          .flatMap((name) => {
            try {
              const file = join(preview!, name);
              const mail = JSON.parse(readFileSync(file, "utf8"));
              return mail.to === email ? [{ file, ...mail }] : [];
            } catch {
              return [];
            }
          })
      : [];
  async function token(kind: "verify" | "reset") {
    await expect
      .poll(() =>
        captures().some((mail) => String(mail.text).includes(`#${kind}=`)),
      )
      .toBe(true);
    const mail = captures().find((mail) =>
      String(mail.text).includes(`#${kind}=`),
    )!;
    return String(mail.text).match(new RegExp(`#${kind}=([a-f0-9]{64})`))![1];
  }
  async function signIn(secret: string) {
    await page.goto("/account");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(secret);
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("heading", { name: "Your profile", exact: true }),
    ).toBeVisible();
  }
  try {
    await page.goto("/account");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Local preview fixture");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByRole("checkbox", { name: /I confirm I am at least 18/ })
      .check();
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .last()
      .click();
    await expect(
      page.getByText(/a development email preview was saved locally/),
    ).toBeVisible();
    const verification = await token("verify");
    expect(
      db
        .prepare("SELECT email_verified_at FROM users WHERE email=?")
        .get(email)!.email_verified_at,
    ).toBeNull();
    let verificationPosts = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/account/verify-email") &&
        request.method() === "POST"
      )
        verificationPosts++;
    });
    await page.goto(`/account#verify=${verification}`);
    await expect(page).toHaveURL(`${base}/account`);
    expect(verificationPosts).toBe(0);
    await page
      .getByRole("button", { name: "Confirm email verification", exact: true })
      .click();
    await expect(
      page.getByText("Email verified. You can sign in to continue.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(verificationPosts).toBe(1);
    expect(
      (
        await page.request.post("/api/account/verify-email", {
          headers: { origin: base },
          data: { token: verification },
        })
      ).status(),
    ).toBe(400);
    await signIn(password);
    const session = (await page.context().cookies()).find(
      (cookie) => cookie.name === "reach_community_session",
    )!;
    expect(session).toMatchObject({
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
      .getByRole("button", { name: "Forgot password", exact: true })
      .click();
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page
      .getByRole("button", { name: "Request recovery email", exact: true })
      .click();
    await expect(
      page.getByText(/a development email preview was saved locally/),
    ).toBeVisible();
    const reset = await token("reset");
    await page.goto(`/account#reset=${reset}`);
    await expect(page).toHaveURL(`${base}/account`);
    await page.getByLabel("New password", { exact: true }).fill(replacement);
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    await expect(
      page.getByText("Password reset. Sign in with your new password.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await page.request.post("/api/account/reset-password", {
          headers: { origin: base },
          data: { token: reset, password: replacement },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post("/api/account/login", {
          headers: { origin: base },
          data: { email, password },
        })
      ).status(),
    ).toBe(401);
    await signIn(replacement);
    const userId = String(
      db.prepare("SELECT id FROM users WHERE email=?").get(email)!.id,
    );
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM notification_outbox WHERE user_id=? AND kind='password-changed'",
        )
        .get(userId)!.n,
    ).toBe(1);
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM notification_outbox WHERE user_id=? AND kind='email-verified'",
        )
        .get(userId)!.n,
    ).toBe(1);
    expect(
      JSON.stringify(
        db.prepare("SELECT * FROM account_tokens WHERE user_id=?").all(userId),
      ),
    ).not.toContain(reset);
    expect(
      (
        await page.request.delete("/api/account/delete", {
          headers: { origin: base },
          data: { password: replacement, confirmation: "DELETE" },
        })
      ).status(),
    ).toBe(200);
    expect(
      db.prepare("SELECT id FROM users WHERE id=?").get(userId),
    ).toBeUndefined();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    const user = db.prepare("SELECT id FROM users WHERE email=?").get(email);
    if (user) db.prepare("DELETE FROM users WHERE id=?").run(String(user.id));
    db.close();
    for (const capture of captures()) rmSync(capture.file, { force: true });
  }
});
