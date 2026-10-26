import { expect, test } from "@playwright/test";

test("public account route opens food sharing while the legacy feature flag is false", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/share$/);
  await expect(
    page.getByRole("heading", { name: "Share food" }),
  ).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Description", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Share Extra Food/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /account|sign in|manage a pantry/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /create account|sign in/i }),
  ).toHaveCount(0);
});
