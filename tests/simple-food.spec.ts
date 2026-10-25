import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { foodResources } from "../src/data/resources";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/food-search", (route) =>
    route.fulfill({
      json: {
        assistance: "directory",
        intent: { service: "food" },
        aiMessage: "AI is unavailable. Directory matching remains available.",
      },
    }),
  );
  // These checks deliberately do not use external providers. Pantry results
  // come from the real local directory; route/GPS failures are synthetic.
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
});
async function submit(page: Page, text: string) {
  await page.getByLabel("What do you need?", { exact: true }).fill(text);
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
}
test("first screen already has food options without location, account, or forms", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Let’s find you food." }),
  ).toBeVisible();
  const results = page.getByRole("region", {
    name: "Places to try",
    exact: true,
  });
  await expect(results.getByRole("article")).toHaveCount(3);
  await expect(
    page.getByRole("navigation", { name: "Your progress" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Where would you like to go?", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Use my location", exact: true }),
  ).toBeEnabled();
  const link = results
    .getByRole("link", { name: "Google Maps directions" })
    .first();
  expect(
    new URL((await link.getAttribute("href"))!).searchParams.has("origin"),
  ).toBe(false);
  await expect(
    page.getByRole("link", { name: "Call 211", exact: true }),
  ).toBeVisible();
});
test("plain language finds Bryan pantries in one action and can be cleared", async ({
  page,
}) => {
  await page.goto("/");
  await submit(page, "I need food in Bryan and I’m walking");
  await expect(
    page.getByText("AI is unavailable. Directory matching remains available.", {
      exact: false,
    }),
  ).toBeVisible();
  const results = page.getByRole("region", {
    name: "Places to try",
    exact: true,
  });
  for (const address of await results.locator("article").allTextContents())
    expect(address).toContain("Bryan");
  await page
    .getByRole("button", { name: "Clear request", exact: true })
    .click();
  await expect(
    page.getByLabel("What do you need?", { exact: true }),
  ).toHaveValue("");
  await expect(results.getByRole("article")).toHaveCount(3);
});
test("unsupported area or meal requests give honest alternatives and a useful next action", async ({
  page,
}) => {
  await page.goto("/");
  await submit(page, "I need food in Boston");
  await expect(
    page.getByText(/does not mean there is no help nearby/),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Other listed food options", exact: true })
      .getByRole("article"),
  ).toHaveCount(3);
  await submit(page, "I need hot meals and cannot cook");
  await expect(
    page.getByText(/No prepared-meal service is verified/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Call 211", exact: true }),
  ).toBeVisible();
});

test("an explicit inability to walk never produces walking links or route requests", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/food-search/plan", (route) => {
    calls++;
    return route.fulfill({ status: 503, body: "{}" });
  });
  await page.goto("/");
  await submit(page, "I need food and cannot walk");
  await expect(
    page.getByText(/You said walking does not work for you/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Google Maps directions" }),
  ).toHaveCount(0);
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.65");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.35");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Google Maps directions" }),
  ).toHaveCount(0);
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "Ride", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Google Maps directions" }).first(),
  ).toBeVisible();
  expect(
    new URL(
      (await page
        .getByRole("link", { name: "Google Maps directions" })
        .first()
        .getAttribute("href"))!,
    ).searchParams.get("travelmode"),
  ).toBe("driving");
});
test("geolocation denial leaves immediate results and manual address entry usable", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(_success: unknown, error: (value: unknown) => void) {
          error({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 });
        },
      },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Location permission was denied",
  );
  await expect(
    page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article"),
  ).toHaveCount(3);
  await page.getByText("Enter an address instead", { exact: true }).click();
  await page.getByLabel("Address", { exact: true }).fill("Brazos Church");
  await page.getByRole("button", { name: /Brazos Church Pantry.*304/ }).click();
  await expect(
    page.getByRole("region", { name: "Choose a starting location" }),
  ).toContainText("Selected:");
});
test("corrected origin changes route requests and links; failed routes never remove results", async ({
  page,
}) => {
  const requested: { origin: { lat: number; lng: number }; mode: string }[] =
    [];
  await page.route("**/api/food-search/plan", async (route) => {
    requested.push(route.request().postDataJSON());
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unavailable",
        message: "Synthetic route failure",
      }),
    });
  });
  await page.goto("/");
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
  await expect(
    page.getByText(/No checked trip is available right now/),
  ).toBeVisible();
  expect(requested.length).toBeGreaterThan(0);
  expect(
    requested.every(
      (body) =>
        body.origin.lat === 30.6501234 && body.origin.lng === -96.3505678,
    ),
  ).toBe(true);
  const link = page
    .getByRole("link", { name: "Google Maps directions" })
    .first();
  expect(
    new URL((await link.getAttribute("href"))!).searchParams.get("origin"),
  ).toBe("30.6501234,-96.3505678");
  requested.length = 0;
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6601234");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  expect(requested.every((body) => body.origin.lat === 30.6601234)).toBe(true);
  expect(
    new URL((await link.getAttribute("href"))!).searchParams.get("origin"),
  ).toBe("30.6601234,-96.3505678");
  await page.getByRole("button", { name: "Bus", exact: true }).click();
  expect(
    new URL((await link.getAttribute("href"))!).searchParams.get("travelmode"),
  ).toBe("transit");
  await expect(
    page.getByText(/Public-transit itineraries are outside this discovery feature/),
  ).toBeVisible();
});
test("retrieved route metrics are labeled, saving updates the Saved tab, and layout is accessible", async ({
  page,
}) => {
  await page.route("**/api/food-search/plan", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        options: foodResources.map((resource) => ({
          id: resource.id,
          resource,
          status: "confirm",
          outbound: {
            distanceMiles: 1.25,
            durationMinutes: 24.3,
            source: "routed",
            arrival: 625,
            departure: 600,
            attribution: [],
          },
        })),
        recommendation: {
          selectedId: "brazos-church-pantry",
          explanation: [
            "Synthetic fixture: route and published intake timing were checked.",
          ],
          status: "confirm",
        },
        assumptions: ["Fixture planning assumptions"],
        message: "Synthetic response, not live routing",
      }),
    }),
  );
  await page.goto("/");
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.65");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.35");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await expect(
    page.getByText("1.3 routed miles · about 25 min walking").first(),
  ).toBeVisible();
  const card = page
    .getByRole("region", { name: "Places to try", exact: true })
    .getByRole("article")
    .first();
  const name = await card.getByRole("heading").innerText();
  await card.getByRole("button", { name: `Save ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const axe = await new AxeBuilder({ page }).include("#main-content").analyze();
  expect(axe.violations).toEqual([]);
});
