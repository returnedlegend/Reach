import { expect, test, type Page } from "@playwright/test";
import { foodCheckFixture } from "./fixtures/food-check";

async function start(page: Page) {
  await page.clock.install({ time: new Date("2026-10-26T15:30:00Z") });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/");
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("Brazos Church Pantry");
  await page.getByRole("button", { name: "Find best resources", exact: true }).click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.675");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.376");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
}
test("checked outbound and return instructions reach the map without a different route request", async ({
  page,
}) => {
  let newRoutes = 0;
  await page.route("**/api/food-search/plan", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...foodCheckFixture(),
        searchedAt: "2026-10-26T15:30:02Z",
      }),
    }),
  );
  await page.route("**/api/journey", (route) => {
    newRoutes++;
    return route.fulfill({ status: 503, body: "{}" });
  });
  await start(page);
  const trip = page.getByRole("region", { name: "Trip check", exact: true });
  await expect(
    trip
      .locator("p")
      .filter({ hasText: "Appointment arrangements need confirmation." }),
  ).toBeVisible();
  await expect(
    trip.locator("p").filter({
      hasText: "Step-free access and pedestrian pickup have not been verified.",
    }),
  ).toBeVisible();
  await expect(page.getByText(/This trip check has expired/)).toHaveCount(0);
  await trip
    .getByRole("button", { name: "See this trip on the map", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trip directions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic outbound instruction", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic return instruction", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Return: 1:30 PM–1:36 PM/)).toBeVisible();
  expect(newRoutes).toBe(0);
  await expect(page.getByText(/This trip check has expired/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Recheck food options", exact: true })
    .click();
  await expect(
    page.getByLabel("What do you need?", { exact: true }),
  ).toHaveValue("Brazos Church Pantry");
});
test("transit estimates are labeled as transit and an expired check requires rechecking", async ({
  page,
}) => {
  let planCalls = 0;
  await page.route("**/api/food-search/plan", (route) => {
    planCalls++;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        foodCheckFixture(route.request().postDataJSON().mode),
      ),
    });
  });
  await start(page);
  await page.getByRole("button", { name: "Bus", exact: true }).click();
  await expect(
    page.getByText("0.3 routed miles · about 6 min by scheduled transit"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "See this trip on the map", exact: true }),
  ).toBeVisible();
  const initialCalls = planCalls;
  await page.clock.runFor(70_000);
  await expect(page.getByText(/This trip check has expired/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "See this trip on the map", exact: true }),
  ).toHaveCount(0);
  expect(planCalls).toBe(initialCalls);
  await page
    .getByRole("button", { name: "Recheck my trip", exact: true })
    .click();
  await expect.poll(() => planCalls).toBeGreaterThan(initialCalls);
});
