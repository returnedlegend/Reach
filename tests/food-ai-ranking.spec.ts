import { test, expect } from "@playwright/test";
test("AI reorders pantry cards and exposes supporting facts without claiming availability", async ({
  page,
}) => {
  await page.route("**/api/food-search", (route) =>
    route.fulfill({
      json: {
        assistance: "ai",
        intent: { service: "food" },
        rankedAt: new Date().toISOString(),
        ranking: [
          {
            id: "brazos-church-pantry",
            reasons: ["Published requirements need confirmation."],
          },
          {
            id: "bridge-ministries",
            reasons: ["Appointment requirements are published."],
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("food in Bryan");
  await page.getByRole("button", { name: "Find best resources", exact: true }).click();
  const cards = page
    .getByRole("region", { name: "Places to try", exact: true })
    .getByRole("article");
  await expect(cards.first()).toHaveAttribute(
    "aria-label",
    "Brazos Church Pantry",
  );
  await expect(
    cards.first().getByText("AI's first suggestion to check"),
  ).toBeVisible();
  await cards
    .first()
    .getByText("Why this suggestion?", { exact: true })
    .click();
  await expect(
    cards.first().getByText("Published requirements need confirmation."),
  ).toBeVisible();
  await expect(page.getByText(/AI compared these food options/)).toBeVisible();
  await page
    .getByRole("checkbox", { name: /Use AI to help understand/ })
    .uncheck();
  await expect(page.getByText("AI's first suggestion to check")).toHaveCount(0);
});
test("expired comparisons do not replace directory order", async ({ page }) => {
  await page.route("**/api/food-search", (route) =>
    route.fulfill({
      json: {
        assistance: "ai",
        intent: { service: "food" },
        rankedAt: "2000-01-01T00:00:00Z",
        ranking: [{ id: "brazos-church-pantry", reasons: ["Stale fixture"] }],
      },
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("food in Bryan");
  await page.getByRole("button", { name: "Find best resources", exact: true }).click();
  await expect(page.getByText(/AI helped understand/)).toBeVisible();
  await expect(page.getByText("Stale fixture")).toHaveCount(0);
});

test("a slow comparison leaves results usable and has an explicit stop button", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/food-search", async (route) => {
    await pending;
    await route
      .fulfill({ json: { assistance: "ai", intent: { service: "food" } } })
      .catch(() => {});
  });
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("food in Bryan");
  await page.getByRole("button", { name: "Find best resources", exact: true }).click();
  await expect(
    page.getByText(/comparison can take up to two minutes/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article"),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Stop AI comparison", exact: true })
    .click();
  release();
  await expect(page.getByText(/AI comparison stopped/)).toBeVisible();
  await expect(page.getByText(/AI helped understand/)).toHaveCount(0);
});
