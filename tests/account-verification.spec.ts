import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("account controls expose configuration honestly and remain accessible on narrow screens", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your Reach account",
  );
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  const status = await (await page.request.get("/api/account/status")).json();
  if (!status.emailConfigured) {
    await expect(
      page.getByText(/Email delivery is not configured/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Forgot password", exact: true }),
    ).toBeDisabled();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("email links remove their token from the address and require explicit confirmation", async ({
  page,
}) => {
  const token = "f".repeat(64);
  let verificationRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/account/verify-email"))
      verificationRequests++;
  });
  await page.goto(`/account#verify=${token}`);
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { name: "Confirm your email", exact: true }),
  ).toBeVisible();
  expect(verificationRequests).toBe(0);
  expect(
    await page.evaluate(
      (value) =>
        JSON.stringify(localStorage).includes(value) ||
        JSON.stringify(sessionStorage).includes(value),
      token,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Confirm email verification", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "invalid or expired" }),
  ).toBeVisible();
  expect(verificationRequests).toBe(1);
  await page.goto(`/account#reset=${token}`);
  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { name: "Choose a new password", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
});

test("public pantry details render while management requires an authenticated account", async ({
  page,
}) => {
  const directory = await (await page.request.get("/api/pantries")).json();
  expect(directory.pantries.length).toBeGreaterThan(0);
  const pantry = directory.pantries[0];
  await page.goto(`/pantries/${encodeURIComponent(pantry.id)}`);
  await expect(
    page.getByRole("heading", { name: pantry.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(pantry.address, { exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/manage");
  await expect(
    page.getByRole("heading", {
      name: "Sign in to manage pantries",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in to your account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add pantry", exact: true }),
  ).toHaveCount(0);
});
