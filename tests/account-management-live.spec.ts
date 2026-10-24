import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { hashAccountPassword } from "../src/lib/auth-password";

// Explicitly gated: this creates and removes only its own offline-verified test
// identity and pantry in an isolated local server database. No external email is sent.
test("real account sessions persist profile/favorites and authorize the pantry lifecycle", async ({
  page,
  browser,
}) => {
  test.skip(
    !process.env.REACH_ACCOUNT_TEST_DB,
    "Requires the isolated local server database path.",
  );
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const path = process.env.REACH_ACCOUNT_TEST_DB!;
  if (!path.startsWith("/tmp/"))
    throw new Error("Use an isolated /tmp database for this fixture.");
  const id = randomUUID(),
    email = `${id}@example.test`,
    password = `test-only-${randomUUID()}`,
    replacement = `changed-test-only-${randomUUID()}`;
  const originalName = `QA pantry ${id}`,
    updatedName = `${originalName} updated`;
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const existingPantry = String(
    db.prepare("SELECT id FROM pantries WHERE active=1 LIMIT 1").get()!.id,
  );
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,name,pantry_role) VALUES(?,?,?,'','resident',1,?,?,?,'Offline QA fixture','administrator')",
  ).run(
    id,
    `qa_${id.replaceAll("-", "")}`,
    await hashAccountPassword(password),
    new Date().toISOString(),
    email,
    new Date().toISOString(),
  );
  const anonymous = await browser.newContext({
    ignoreHTTPSErrors: process.env.REACH_TEST_LOCAL_TLS === "true",
  });
  const base = test.info().project.use.baseURL!;
  let createdId: string | undefined;
  async function signIn(secret: string) {
    await page.goto("/account");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(secret);
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/account/login") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .last()
      .click();
    expect((await response).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Your profile", exact: true }),
    ).toBeVisible();
  }
  try {
    await signIn(password);
    const cookie = (await page.context().cookies()).find(
      (value) => value.name === "reach_community_session",
    )!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
    });
    await page
      .getByLabel("Display name", { exact: true })
      .fill("Updated offline QA fixture");
    await page
      .getByRole("combobox", { name: "Travel preference", exact: true })
      .selectOption("transit");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(
      page.getByText("Profile updated.", { exact: true }),
    ).toBeVisible();
    await page.goto(`/pantries/${existingPantry}`);
    await page
      .getByRole("button", { name: "Save pantry", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Saved pantry", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.goto("/manage");
    await page.getByRole("button", { name: "Add pantry", exact: true }).click();
    await page.getByLabel("Pantry name", { exact: true }).fill(originalName);
    await page
      .getByLabel("Street address", { exact: true })
      .fill("Offline browser fixture; not a public food distribution");
    const creation = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/pantries") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create pantry listing", exact: true })
      .click();
    const created = await creation;
    expect(created.status()).toBe(201);
    createdId = (await created.json()).pantry.id;
    const workspace = page.getByRole("region", {
      name: "Selected pantry workspace",
      exact: true,
    });
    await workspace
      .getByLabel("Pantry name", { exact: true })
      .fill(updatedName);
    await workspace
      .getByRole("button", { name: "Save pantry information", exact: true })
      .click();
    await expect(
      page.getByText("Pantry information saved.", { exact: true }),
    ).toBeVisible();
    await workspace
      .getByRole("button", { name: "Food availability", exact: true })
      .click();
    await workspace
      .getByRole("button", { name: "Add food category", exact: true })
      .click();
    await workspace
      .getByLabel("Category", { exact: true })
      .fill("Offline fixture groceries");
    await workspace
      .getByRole("combobox", { name: "Availability", exact: true })
      .selectOption("limited");
    await workspace
      .getByLabel("Source of this observation", { exact: true })
      .fill("Automated local browser fixture");
    await workspace
      .getByRole("button", { name: "Save food availability", exact: true })
      .click();
    await expect(
      page.getByText("Food availability saved.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await (
          await anonymous.request.get(`${base}/api/pantries/${createdId}`)
        ).json()
      ).inventory,
    ).toMatchObject([
      { category: "Offline fixture groceries", status: "limited" },
    ]);

    await workspace
      .getByRole("button", { name: "Archive & restore", exact: true })
      .click();
    await workspace
      .getByLabel(`Type “${updatedName}” to confirm`, { exact: true })
      .fill(updatedName);
    await workspace
      .getByRole("button", { name: "Confirm archive pantry", exact: true })
      .click();
    await expect(
      page.getByText("Pantry archived and removed from public results.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await anonymous.request.get(`${base}/api/pantries/${createdId}`)
      ).status(),
    ).toBe(404);
    await workspace
      .getByLabel(`Type “${updatedName}” to confirm`, { exact: true })
      .fill(updatedName);
    await workspace
      .getByRole("button", { name: "Confirm restore pantry", exact: true })
      .click();
    await expect(
      page.getByText("Pantry restored to public results.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await anonymous.request.get(`${base}/api/pantries/${createdId}`)
      ).status(),
    ).toBe(200);

    await page.goto("/account");
    await page.getByLabel("Current password", { exact: true }).fill(password);
    await page.locator('input[name="newPassword"]').fill(replacement);
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(
      page.getByText(
        "Password changed. Sign in again with your new password.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (await (await page.request.get("/api/account/me")).json()).user,
    ).toBeNull();
    await signIn(replacement);
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
      "Updated offline QA fixture",
    );
    await expect(
      page.getByRole("combobox", { name: "Travel preference", exact: true }),
    ).toHaveValue("transit");
    expect(
      (await (await page.request.get("/api/pantries/favorites")).json())
        .favorites,
    ).toContain(existingPantry);
    await page
      .getByLabel("Password to confirm deletion", { exact: true })
      .fill(replacement);
    await page.getByLabel("Type DELETE", { exact: true }).fill("DELETE");
    await page
      .getByRole("button", { name: "Permanently delete account", exact: true })
      .click();
    await expect(
      page.getByText("Your account has been deleted.", { exact: true }),
    ).toBeVisible();
    expect(
      db.prepare("SELECT id FROM users WHERE id=?").get(id),
    ).toBeUndefined();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    await anonymous.close();
    // Remove only this test's own listing and identity, including failed runs.
    const fixtureId =
      createdId ??
      db
        .prepare("SELECT id FROM pantries WHERE name IN (?,?)")
        .get(originalName, updatedName)?.id;
    if (fixtureId) {
      db.prepare("DELETE FROM pantry_history WHERE pantry_id=?").run(
        String(fixtureId),
      );
      db.prepare("DELETE FROM pantry_audit WHERE pantry_id=?").run(
        String(fixtureId),
      );
      db.prepare("DELETE FROM pantry_corrections WHERE pantry_id=?").run(
        String(fixtureId),
      );
      db.prepare("DELETE FROM pantries WHERE id=?").run(String(fixtureId));
    }
    db.prepare("DELETE FROM users WHERE id=?").run(id);
    db.close();
  }
});
