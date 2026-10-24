import { expect, test, type Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "controlled-background",
                type: "background",
                paint: { "background-color": "#e9eee8" },
              },
            ],
          },
        })
      : route.abort("blockedbyclient"),
  );
});

// These tests exercise UI contracts independently of the adapter's unit mocks.
// Real MapLibre rendering is independently exercised in osm-verification.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/[^/]*(googleapis|gstatic)\.com\//, (route) =>
    route.abort("blockedbyclient"),
  );
});

async function travelChoices(page: Page, need = "Food") {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(`^${need}\\b`) }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Advanced: enter coordinates", { exact: true }).click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

async function foodOptions(page: Page) {
  await travelChoices(page);
  await page
    .getByLabel("Where would you like to go?")
    .selectOption("bridge-ministries");
  await page
    .getByRole("button", { name: "Show my options", exact: true })
    .click();
}

const successfulRoute = {
  status: "available",
  label: "Controlled test route",
  distanceMiles: 1.25,
  durationMinutes: 18,
  steps: [{ instruction: "Controlled provider instruction" }],
};

test("food options expose the maintained sourced directory with a single selected destination", async ({
  page,
}, testInfo) => {
  await foodOptions(page);
  const directoryResponse = await page.request.get("/api/pantries?pageSize=100");
  expect(directoryResponse.ok()).toBe(true);
  const foodResources: { name: string; verificationStatus: string }[] = (await directoryResponse.json()).pantries;
  const options = page.getByRole("region", { name: "Food assistance options" });
  await expect(options.getByRole("article")).toHaveCount(foodResources.length);
  await expect(
    page
      .getByRole("region", { name: "Journey map", exact: true })
      .getByRole("button", { name: /— selected pantry$/ }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("region", { name: "Journey map", exact: true })
      .getByRole("button", {
        name: "The Bridge Ministries Bryan — selected pantry",
        exact: true,
      }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const resource of foodResources) {
    const card = options.getByRole("article", { name: resource.name, exact: true });
    await expect(
      card.getByRole("button", { name: `Get directions to ${resource.name}`, exact: true }),
    ).toBeEnabled();
    await expect(card).toContainText(resource.verificationStatus === "confirmed-site" ? "Location verified" : /[Dd]etails need confirmation|Needs confirmation/);
  }
  await options
    .getByRole("button", { name: "The Salvation Army", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Journey map", exact: true })
      .getByRole("button", { name: /— selected pantry$/ }),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".reach-resource-detail")
      .getByRole("heading", { name: "The Salvation Army", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close destination preview", exact: true })
    .click();
  await page
    .locator(".reach-resource-detail")
    .getByText("Sources & verification details", { exact: true })
    .click();
  await expect(page.locator(".reach-resource-detail")).toContainText(
    "checked 2026-10-16",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("v3-food-options.png"),
    fullPage: true,
  });
  let routedDestination: unknown;
  await page.route("**/api/journey", (route) => {
    routedDestination = route.request().postDataJSON().destination;
    return route.fulfill({ json: successfulRoute });
  });
  await page.locator(".reach-resource-detail")
    .getByRole("button", { name: "Get directions to The Salvation Army", exact: true }).click();
  await expect.poll(() => routedDestination).toEqual({ lat: 30.64562, lng: -96.36042 });
});

test("explicit route opt-in then mode, card, and manual-origin changes use current request coordinates", async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/journey", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: successfulRoute });
  });
  await foodOptions(page);
  await page.getByLabel("How will you travel?").selectOption("driving");
  await page
    .getByRole("region", { name: "Food assistance options", exact: true })
    .getByRole("button", { name: "Parkway Baptist", exact: true })
    .click();
  expect(bodies).toHaveLength(0);
  await page.getByRole("button", { name: "Close destination preview", exact: true }).click();
  await page.getByRole("button", { name: "Get directions", exact: true }).click();
  await expect(
    page.getByText("Controlled provider instruction", { exact: true }),
  ).toBeVisible();
  expect(bodies.at(-1)).toMatchObject({
    origin: { lat: 30.6501234, lng: -96.3505678 },
    destination: { lat: 30.6038539, lng: -96.3130975 },
    mode: "driving",
  });
  await page.getByLabel("How will you travel?").selectOption("transit");
  await expect.poll(() => bodies.at(-1)?.mode).toBe("transit");
  await page.getByRole("button", { name: "Browse places", exact: true }).click();
  await page
    .getByRole("region", { name: "Map resource list", exact: true })
    .getByRole("button", {
      name: "The Bridge Ministries Bryan",
      exact: true,
    })
    .click();
  await expect
    .poll(() => bodies.at(-1)?.destination)
    .toEqual({ lat: 30.6472913, lng: -96.3606034 });
  const previewClose = page.getByRole("button", {
    name: "Close destination preview",
    exact: true,
  });
  if (await previewClose.isVisible()) await previewClose.click();
  await page.getByRole("button", { name: "Directions", exact: true }).click();
  await page.getByRole("region", { name: "Trip directions", exact: true })
    .getByText("Edit starting point", { exact: true }).click();
  await page.getByText("Advanced: enter coordinates", { exact: true }).click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6609876");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3401234");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  await expect
    .poll(() => bodies.at(-1)?.origin)
    .toEqual({ lat: 30.6609876, lng: -96.3401234 });
  const url = new URL(
    (await page
      .getByRole("link", { name: "Open in Google Maps", exact: true })
      .getAttribute("href"))!,
  );
  expect(url.searchParams.get("origin")).toBe("30.6609876,-96.3401234");
  expect(url.searchParams.get("destination")).toBe("30.6472913,-96.3606034");
  expect(url.searchParams.get("travelmode")).toBe("transit");
});

for (const scenario of ["quota", "no-route", "network"] as const) {
  test(`${scenario} routing failure preserves external directions and allows a successful retry`, async ({
    page,
  }) => {
    let calls = 0;
    const message =
      scenario === "quota"
        ? "Google route quota is exhausted. Try again later."
        : "Google found no route for this request.";
    await page.route("**/api/journey", async (route) => {
      calls++;
      if (calls > 1) return route.fulfill({ json: successfulRoute });
      if (scenario === "network") return route.abort("internetdisconnected");
      return route.fulfill({
        status: 503,
        json: { status: "unavailable", reason: scenario, message },
      });
    });
    await foodOptions(page);
    await page.getByRole("button", { name: "Get directions", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Route unavailable", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        scenario === "network"
          ? "Routing is unavailable. Open Google Maps for directions, or contact the provider."
          : message,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open in Google Maps", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Routed distance:");
    await page.getByRole("button", { name: "Recalculate directions", exact: true }).click();
    await expect(
      page.getByText("Controlled provider instruction", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("1.25 miles");
    expect(calls).toBe(2);
  });
}

test("shelter question flow keeps unavailable beds explicit and offers no invented destination", async ({
  page,
}) => {
  await travelChoices(page, "Shelter");
  await expect(page.locator("main")).toContainText(
    "beds are not verified here",
  );
  await expect(page.getByLabel("Where would you like to go?")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show my options", exact: true })
    .click();
  await expect(page.locator("main")).toContainText(
    "We don’t have verified beds, eligibility or shelter hours",
  );
  await expect(
    page.getByRole("button", { name: "Calculate route here" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open in Google Maps", exact: true }),
  ).toHaveCount(0);
});
