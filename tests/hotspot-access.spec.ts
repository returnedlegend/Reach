import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { accountHash } from "../src/lib/account-store";
import {
  openCommunityDatabase,
  closeCommunityDatabases,
} from "../src/lib/community";

test("hotspot shortcut preserves the selected starting point and progress", async ({
  page,
}) => {
  await page.route("**/api/community/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Community sharing is disabled." },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browse food hotspots", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await expect(picker).toBeVisible();
  if (!(await picker.getByLabel("Latitude", { exact: true }).isVisible()))
    await picker
      .getByText("Advanced: enter coordinates", { exact: true })
      .click();
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6501234",
  );
  await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
});

test("hotspot entry remains clear when the community service is disabled", async ({
  page,
}) => {
  await page.route("**/api/community/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Community sharing is disabled." },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Browse food hotspots", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Community sharing is not enabled" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What do you need?", exact: true }),
  ).toBeVisible();
});

test("structured community-disabled status does not depend on English error wording", async ({
  page,
}) => {
  await page.route("**/api/community/**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "community_disabled",
        error: "Community sharing is not available on this server.",
      },
    }),
  );
  await page.goto("/food-hotspots");
  await expect(
    page.getByRole("heading", { name: "Community sharing is not enabled" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check again", exact: true }),
  ).toBeVisible();
});

test("a transient community error is not reported as a disabled feature", async ({
  page,
}) => {
  await page.route("**/api/community/**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "temporarily_unavailable",
        error:
          "Community updates are temporarily unavailable; posting is disabled until recovery.",
      },
    }),
  );
  await page.goto("/food-hotspots");
  await expect(page.getByTestId("community-error")).toContainText(
    "temporarily unavailable",
  );
  await expect(
    page.getByRole("heading", { name: "Community sharing is not enabled" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh community", exact: true }),
  ).toBeVisible();
});

test("public hotspot sharing needs no signup; account hotspots require organizer approval", async ({
  page,
}) => {
  test.skip(
    process.env.REACH_TEST_COMMUNITY !== "true",
    "Requires an isolated enabled community database.",
  );
  const configuredPath = process.env.REACH_COMMUNITY_DB || "";
  const dbPath = resolve(configuredPath);
  expect(configuredPath).toBeTruthy();
  expect(dbPath.startsWith(`${resolve(tmpdir())}${sep}`)).toBe(true);
  const db = openCommunityDatabase(dbPath);
  const userId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?, '', '', 'resident',1,?)",
  ).run(
    userId,
    `hotspot_${userId.replaceAll("-", "").slice(0, 16)}`,
    now.toISOString(),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    userId,
    new Date(+now + 3600000).toISOString(),
  );
  try {
    // A guest reaches the account-free sharing flow directly.
    await page.goto("/food-hotspots");
    await page
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "Create Food Hotspot", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Create Food Hotspot", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/without an account/i)).toBeVisible();
    const sharingLink = page.getByRole("link", {
      name: "Host a Food Pickup / Share Extra Food",
      exact: true,
    });
    await expect(sharingLink).toHaveAttribute("href", "/share");
    await sharingLink.click();
    await expect(
      page.getByRole("heading", {
        name: "Share food with your neighbors",
        exact: true,
      }),
    ).toBeVisible();
    const account = await page.request.get("/api/account/me");
    expect(account.ok()).toBe(true);
    expect((await account.json()).user).toBeNull();

    // A pre-existing resident can request the role but cannot bypass approval.
    await page.context().addCookies([
      {
        name: "reach_community_session",
        value: token,
        url: new URL(page.url()).origin,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    await page.goto("/food-hotspots");
    await page
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "Create Food Hotspot", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Organizer approval required",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Request organizer approval", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Organizer request pending",
        exact: true,
      }),
    ).toBeDisabled();
    const resident = await page.request.get("/api/community/me");
    expect((await resident.json()).user.role).toBe("resident");
    expect((await resident.json()).organizerRequested).toBe("pending");
  } finally {
    closeCommunityDatabases();
  }
});
