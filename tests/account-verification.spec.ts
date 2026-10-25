import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

test("account page creates and signs in to a community username account without email", async ({
  page,
}) => {
  const username = `account_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const password = `community-${randomUUID()}`;
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("checkbox", { name: "I confirm I am at least 18 years old and agree to the terms and privacy policy.", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Your profile", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".account-identity")).toContainText(username);
  await expect(
    page.getByText("Email not verified", { exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page
    .getByLabel("Email address or username", { exact: true })
    .fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Your profile", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".account-identity")).toContainText(username);
});

test("account controls expose configuration honestly and remain accessible on narrow screens", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your Reach account",
  );
  await expect(
    page.getByLabel("Email address or username", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  const status = await (await page.request.get("/api/account/status")).json();
  if (!status.emailConfigured) {
    await expect(
      page.getByText(/Email delivery is not configured/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Forgot password", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account", exact: true }).last(),
    ).toBeEnabled();
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
