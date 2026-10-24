import { expect, test } from "@playwright/test";

test("first visit is dark with an OS light scheme and before app hydration", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.route("**/_next/static/**/*.js", (route) =>
    route.abort("blockedbyclient"),
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("reach-theme")),
  ).toBeNull();
});

test("saved light survives reload and an explicit dark toggle persists", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("reach-theme") === null)
      localStorage.setItem("reach-theme", "reach");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");

  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  expect(await page.evaluate(() => localStorage.getItem("reach-theme"))).toBe(
    "reach-dark",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
});

test("blocked storage falls back to dark and the toggle remains usable", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"] as const)
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() {
          throw new DOMException("Synthetic storage denial", "SecurityError");
        },
      });
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
});

test("OS light changes do not override the dark default", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("reach-theme")),
  ).toBeNull();
});

test("removing a saved theme in another tab returns to dark", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");

  const otherTab = await page.context().newPage();
  await otherTab.goto("/");
  await otherTab.evaluate(() => localStorage.removeItem("reach-theme"));
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  await otherTab.close();
});
