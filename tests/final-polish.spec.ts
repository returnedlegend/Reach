import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

// Cartography is neutralized only for repeatable UI/accessibility checks.
// Directory records and server responses remain the real local application data.
test.beforeEach(async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "qa-background",
                type: "background",
                paint: { "background-color": "#edf3f2" },
              },
            ],
          },
        })
      : route.abort(),
  );
});

const evidence = (name: string) => resolve("docs/evidence", name);

test("homepage quick start leads directly to real food options and preserves focus", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.screenshot({
    path: evidence(`final-polish-${info.project.name}-after.png`),
    fullPage: true,
  });
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
    .getByRole("checkbox", { name: /Compare with AI/ })
    .uncheck();
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("Food in Bryan");
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
  const heading = page.getByRole("heading", {
    name: "Places to try",
    exact: true,
  });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  const directory = await page.request.get("/api/pantries?pageSize=100");
  expect(directory.ok()).toBe(true);
  const data = await directory.json();
  const cards = page
    .getByRole("region", { name: "Places to try", exact: true })
    .getByRole("article");
  await expect(cards).toHaveCount(3);
  const recordedNames = new Set(
    data.pantries.map((pantry: { name: string }) => pantry.name),
  );
  for (const card of await cards.all())
    expect(recordedNames.has(await card.getAttribute("aria-label"))).toBe(true);
  await expect(cards.first()).not.toContainText("Sample Community Pantry");
  await page.screenshot({
    path: evidence(`final-polish-${info.project.name}-options.png`),
    fullPage: true,
  });
});

test("homepage light and dark themes fit a small phone and pass automated accessibility checks", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 740 });
  if (info.project.name === "mobile") {
    const primary = await page
      .getByRole("button", { name: "Find best resources", exact: true })
      .boundingBox();
    const navigation = await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .boundingBox();
    expect(primary).not.toBeNull();
    expect(navigation).not.toBeNull();
    expect(
      primary!.y + primary!.height,
      "The primary action must be visible above the fixed phone navigation without scrolling.",
    ).toBeLessThanOrEqual(navigation!.y + 1);
  }
  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark")
      await page
        .getByRole("button", { name: "Switch to dark mode", exact: true })
        .click();
    expect(
      await page.evaluate(() =>
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ),
      ),
    ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    await page.screenshot({
      path: evidence(`final-polish-${info.project.name}-${theme}.png`),
      fullPage: true,
    });
  }
});

test("missing pages offer an accessible route back to food discovery", async ({
  page,
}) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "back on track",
  );
  await expect(
    page.getByRole("link", { name: "Call 211", exact: true }),
  ).toHaveAttribute("href", "tel:211");
  await page
    .locator(".reach-recovery")
    .getByRole("link", { name: "Find food", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Let’s find you food",
  );
});

test("the map loads the real official district boundary and can hide it again", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const toggle = page.getByRole("checkbox", {
    name: "Show TX-10 boundary",
    exact: true,
  });
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/coverage",
  );
  await toggle.check();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const boundary = await response.json();
  expect(boundary.type).toBe("Feature");
  expect(["Polygon", "MultiPolygon"]).toContain(boundary.geometry.type);
  expect(boundary.geometry.coordinates.length).toBeGreaterThan(0);
  await expect(
    page.getByText("Official TX-10 boundary shown.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Boundary source", exact: true }),
  ).toHaveAttribute("href", /^https:\/\//);
  await toggle.uncheck();
  await expect(
    page.getByText("Official TX-10 boundary shown.", { exact: false }),
  ).toBeHidden();
});
