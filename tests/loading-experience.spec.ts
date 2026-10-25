import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("inline spinner and skeletons prevent duplicates without blocking map access", async ({
  page,
}) => {
  let release!: () => void;
  let requests = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/food-search", async (route) => {
    requests++;
    await pending;
    await route
      .fulfill({ json: { assistance: "ai", intent: { service: "food" } } })
      .catch(() => {});
  });
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("Food in Bryan");
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
  const button = page.getByRole("button", { name: "Analyzing…", exact: true });
  await expect(button).toBeDisabled();
  await expect(button).toBeInViewport();
  await expect(button.getByRole("status")).toBeVisible();
  await expect(page.getByLabel("Preparing recommendations")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(
    page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article"),
  ).toHaveCount(3);
  await page
    .locator("form")
    .first()
    .evaluate((form) => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Map", exact: true }).first().click();
  await expect(
    page.getByRole("region", { name: "Journey map", exact: true }),
  ).toBeVisible();
  release();
  await page
    .getByRole("button", { name: "Explore", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Find best resources", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByLabel("What do you need?", { exact: true }),
  ).toHaveValue("Food in Bryan");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("errors stop loading and retry preserves the request", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/food-search", (route) => {
    requests++;
    return route.fulfill(
      requests === 1
        ? {
            status: 503,
            json: {
              error: "The comparison service is temporarily unavailable.",
            },
          }
        : { json: { assistance: "ai", intent: { service: "food" } } },
    );
  });
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("Food in Bryan");
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
  await expect(
    page.getByText(/comparison service is temporarily unavailable/),
  ).toBeVisible();
  await expect(page.getByLabel("Preparing recommendations")).toHaveCount(0);
  await page.getByRole("button", { name: "Try AI again", exact: true }).click();
  await expect(page.getByText(/AI helped understand/)).toBeVisible();
  expect(requests).toBe(2);
  await expect(
    page.getByLabel("What do you need?", { exact: true }),
  ).toHaveValue("Food in Bryan");
});

test("reduced motion disables animation and loading UI remains accessible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/food-search", async (route) => {
    await pending;
    await route
      .fulfill({
        json: {
          assistance: "directory",
          intent: { service: "food" },
          aiMessage: "Synthetic unavailable comparison",
        },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("Food in Bryan");
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
  const button = page.getByRole("button", { name: "Analyzing…", exact: true });
  await expect(button.locator('[aria-hidden="true"]')).toHaveCSS(
    "animation-name",
    "none",
  );
  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations).toEqual([]);
  await page
    .getByRole("button", { name: "Stop AI comparison", exact: true })
    .click();
  release();
  await expect(page.getByLabel("Preparing recommendations")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Find best resources", exact: true }),
  ).toBeEnabled();
});
