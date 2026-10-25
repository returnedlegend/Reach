import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { hashAccountPassword } from "../src/lib/auth-password";
import {
  openCommunityDatabase,
  closeCommunityDatabases,
} from "../src/lib/community";

test("discovery starts compact and comparison details remain available on demand", async ({
  page,
}) => {
  await page.route("**/api/food-search", (route) =>
    route.fulfill({
      json: {
        assistance: "directory",
        intent: { service: "food" },
        aiMessage: "Fixture: AI unavailable.",
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("How this score is calculated")).toHaveCount(0);
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("Food in Bryan");
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
  const comparison = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Compare your top" }) })
    .first();
  await expect(comparison).not.toHaveAttribute("open", "");
  await comparison.locator("summary").first().click();
  await expect(
    page.getByRole("heading", { name: "Your top 3 options" }),
  ).toBeVisible();
  await expect(
    page.getByText("How this score is calculated").first(),
  ).toBeVisible();
});
test("retired account pages do not send visitors into a sign-in loop", async ({
  page,
}) => {
  for (const path of ["/manage", "/volunteer"]) {
    await page.goto(path);
    await expect(
      page.getByText(/optional service is not available/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Sign in to your account|Your account/ }),
    ).toHaveCount(0);
  }
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "AI assistance", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Groq is the default/)).toBeVisible();
});
test("administrator signs in, changes password, and must authenticate again", async ({
  page,
}) => {
  test.setTimeout(60000);
  const path = process.env.REACH_SHARING_TEST_DB;
  test.skip(
    !path?.startsWith("/tmp/"),
    "Requires an isolated temporary database.",
  );
  const db = openCommunityDatabase(path);
  const id = randomUUID();
  const email = `audit-${id}@example.test`;
  const initial = "Synthetic-temp-123!";
  const updated = "Synthetic-new-password-456!";
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,pantry_role,must_change_password) VALUES(?,?,?,'','moderator',1,?,?,'administrator',1)",
  ).run(
    id,
    "audit_" + id,
    await hashAccountPassword(initial),
    new Date().toISOString(),
    email,
  );
  try {
    await page.goto("/admin/change-password");
    await expect(page).toHaveURL(/\/admin\/sign-in$/);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(initial);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/change-password$/);
    await page.getByLabel("Current password", { exact: true }).fill(initial);
    await page.getByLabel("New password", { exact: true }).fill(updated);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(updated);
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(
      page.getByText(/Password changed. All previous sessions/),
    ).toBeVisible();
    expect((await page.request.get("/api/sharing/admin")).status()).toBe(401);
    await page.goto("/admin/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(updated);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect((await page.request.get("/api/sharing/admin")).status()).toBe(200);
  } finally {
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    db.prepare("DELETE FROM users WHERE id=?").run(id);
    closeCommunityDatabases();
  }
});

test("public pages contain no delivery controls and retired endpoints are absent", async ({
  page,
}) => {
  for (const path of ["/", "/share", "/privacy", "/admin/sign-in"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText(
      /email delivery|SMTP|Resend|Postal|development email preview|email notifications|Ask about availability/i,
    );
  }
  for (const path of [
    "/outreach",
    "/unsubscribe",
    "/api/outreach",
    "/api/notifications",
  ]) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
});
