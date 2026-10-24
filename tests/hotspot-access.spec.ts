import { expect, test } from "@playwright/test";

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

test("hotspot creation resumes after signup and requires organizer approval", async ({
  page,
}) => {
  test.skip(
    process.env.REACH_TEST_COMMUNITY !== "true",
    "Requires an isolated enabled community database.",
  );
  await page.goto("/food-hotspots");
  await expect(
    page.getByRole("combobox", { name: "Post type", exact: true }),
  ).toHaveValue("hotspot");
  await page
    .getByRole("button", { name: "Create Food Hotspot", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Sign in or create account", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New here? Create account", exact: true })
    .click();
  await page
    .locator('input[name="username"]')
    .fill(
      `hotspot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    );
  await page
    .locator('input[name="password"]')
    .fill("Synthetic access test password");
  await page
    .getByLabel("I confirm that I am 18 or older.", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Organizer approval required" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Request organizer approval", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Organizer request pending",
      exact: true,
    }),
  ).toBeDisabled();
  const role = await page.request.get("/api/community/me");
  expect((await role.json()).user.role).toBe("resident");
});
