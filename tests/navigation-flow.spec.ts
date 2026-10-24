import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

function supportedProject(name: string) {
  return name === "mobile" || name === "desktop";
}

async function openPlanner(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find food I can reach", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Find food I can reach", exact: true }),
  ).toBeVisible();
}

async function selectManualOrigin(
  picker: import("@playwright/test").Locator,
) {
  const advanced = picker.locator("details.location-advanced");
  await advanced.locator("summary").click();
  await advanced.getByLabel("Latitude", { exact: true }).fill("30.674");
  await advanced.getByLabel("Longitude", { exact: true }).fill("-96.376");
  await advanced
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
}

const unsupportedShelterResponse = {
  timezone: "America/Chicago",
  options: [],
  searchedAt: "2026-10-23T15:00:00.000Z",
  routingCalls: 0,
  aiCalls: 0,
  message: "No verified matching shelter service is available in this catalog.",
  guidance: {
    assistance: "deterministic",
    status: "not-requested",
    headline: "A workable trip is not confirmed",
    paragraphs: [
      "No verified shelter catalog is available; food resources cannot be treated as shelter.",
    ],
    selectedId: null,
    alternativeIds: [],
    evidence: [],
    modules: [
      { name: "needs", status: "complete" },
      { name: "resources", status: "limited" },
      { name: "transport", status: "limited" },
      { name: "ranking", status: "complete" },
      { name: "guidance", status: "complete" },
    ],
    limitations: [
      "No verified shelter catalog is available; food resources cannot be treated as shelter.",
    ],
    aiCalls: 0,
  },
};

const noAiGuidanceResponse = {
  ...unsupportedShelterResponse,
  message: "Synthetic navigation result; no service was contacted.",
  guidance: {
    ...unsupportedShelterResponse.guidance,
    status: "unavailable",
    headline: "A workable trip is not confirmed",
    paragraphs: [
      "No option has a retrieved itinerary that meets the known requirements.",
    ],
    limitations: [
      "Optional AI guidance was not available or could not be validated. The computed explanation and route checks remain available.",
    ],
  },
};

function drivingOption(id: string, name: string, lng: number, duration: number) {
  return {
    id,
    kind: "pantry" as const,
    resource: {
      id,
      name,
      address: "Synthetic address, Bryan, TX",
      coordinates: { lat: 30.67, lng },
      hours: "Synthetic fixture hours; not verified",
      eligibility: "Unknown / needs confirmation",
      notes: "Synthetic browser fixture only; not a real service.",
      accessibility: "Not verified",
      offering: "Synthetic grocery fixture",
      phone: "979-555-0198",
      verificationStatus: "confirmed-site" as const,
      detailsNeedConfirmation: false,
      sources: [{ title: "Synthetic fixture only", url: "https://example.test/fixture", checkedOn: "2026-10-22" }],
    },
    status: "confirm" as const,
    reasons: ["Synthetic fixture route only."],
    warnings: ["Synthetic browser fixture; no service was contacted."],
    labels: [],
    availability: { status: "unknown" as const, source: "Synthetic; availability unknown", reportedAt: null, expiresAt: null },
    outbound: {
      mode: "driving" as const,
      departure: 600,
      arrival: 600 + duration,
      durationMinutes: duration,
      distanceMiles: 5.2,
      walkingMinutes: 0,
      walkingMiles: 0,
      fare: null,
      transfers: 0,
      source: "routed" as const,
      steps: ["Synthetic driving step; no directions were requested from a provider."],
      paths: [],
      attribution: [],
      warnings: ["Fuel, parking, loading and walking from parking are unknown."],
    },
    returnJourney: null,
    serviceStart: 660,
    serviceEnd: 680,
    intakeCutoff: 690,
    score: -duration,
  };
}

const drivingGuidanceResponse = {
  timezone: "America/Chicago",
  searchedAt: "2026-10-23T15:00:00.000Z",
  routingCalls: 2,
  aiCalls: 0,
  message: "Synthetic browser fixture only. No real journey was measured.",
  options: [
    drivingOption("synthetic-drive-alpha", "Synthetic Driving Pantry Alpha", -96.376, 14),
    drivingOption("synthetic-drive-beta", "Synthetic Driving Pantry Beta", -96.37, 18),
  ],
  guidance: {
    assistance: "deterministic",
    status: "not-requested",
    headline: "Review Synthetic Driving Pantry Alpha before leaving",
    paragraphs: [
      "Driving: leave 10:00 AM, arrive 10:14 AM (America/Chicago). 14 min driving, 5.2 miles routed; fuel and parking costs unknown.",
      "Food availability: unknown. A dated report never guarantees stock on arrival.",
    ],
    selectedId: "synthetic-drive-alpha",
    alternativeIds: ["synthetic-drive-beta"],
    evidence: [
      { id: "option-0-route", resourceId: "synthetic-drive-alpha", text: "Driving: leave 10:00 AM, arrive 10:14 AM (America/Chicago). 14 min driving, 5.2 miles routed; fuel and parking costs unknown." },
      { id: "option-1-route", resourceId: "synthetic-drive-beta", text: "Driving: leave 10:00 AM, arrive 10:18 AM (America/Chicago). 18 min driving, 5.2 miles routed; fuel and parking costs unknown." },
    ],
    modules: [
      { name: "needs", status: "complete" },
      { name: "resources", status: "limited" },
      { name: "transport", status: "complete" },
      { name: "ranking", status: "complete" },
      { name: "guidance", status: "complete" },
    ],
    limitations: ["Synthetic route fixture only; do not travel based on this result."],
    aiCalls: 0,
  },
};

test("declared shelter needs never become a pantry recommendation when the catalog has no verified shelter records", async ({
  page,
}, testInfo) => {
  test.skip(!supportedProject(testInfo.project.name), "Run on mobile and desktop widths.");
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/access/plan", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: unsupportedShelterResponse });
  });

  await openPlanner(page);
  const planner = page.locator(".access-planner");
  const needsSelects = planner.locator(".navigation-preferences select");
  await expect(needsSelects.nth(0)).toHaveValue("food");
  await expect(needsSelects.nth(1)).toHaveValue("today");
  await expect(planner.locator(".navigation-preferences__ai input")).not.toBeChecked();
  await needsSelects.nth(0).selectOption("shelter");
  await needsSelects.nth(1).selectOption("soon");

  const locationPicker = planner.locator(".location-picker").first();
  await selectManualOrigin(locationPicker);
  await planner.getByRole("button", { name: "Find food I can reach", exact: true }).click();
  await expect(planner.getByRole("heading", { name: "Review your trip", exact: true })).toBeVisible();
  await expect(planner.getByText("No verified shelter catalog is available; food resources cannot be treated as shelter.").first()).toBeVisible();
  await expect(planner.locator(".access-planner__card")).toHaveCount(0);
  expect(submitted).toMatchObject({
    needs: {
      service: "shelter",
      urgency: "soon",
      hasIdentification: "unknown",
      preferTransitNearby: false,
    },
    explain: false,
    input: { mode: "transit", origin: { lat: 30.674, lng: -96.376 } },
  });
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-navigation-shelter-limits.png`), fullPage: true });
});

test("preference interpretation stays opt-in, reviewable, and separate from trip controls until applied", async ({
  page,
}, testInfo) => {
  test.skip(!supportedProject(testInfo.project.name), "Run on mobile and desktop widths.");
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  let assistRequest: Record<string, unknown> | null = null;
  await page.route("**/api/access/assist", async (route) => {
    assistRequest = route.request().postDataJSON();
    await route.fulfill({
      json: {
        status: "available",
        patch: { mode: "driving" },
        needs: {
          service: "groceries",
          urgency: "soon",
          householdSize: 3,
          hasIdentification: "unknown",
          preferTransitNearby: false,
        },
        message: "Review these clearly stated preferences before applying them.",
      },
    });
  });

  await openPlanner(page);
  const planner = page.locator(".access-planner");
  const service = planner.locator(".navigation-preferences select").nth(0);
  const travelMode = planner.getByRole("combobox", { name: /Travel by/ });
  await expect(service).toHaveValue("food");
  await expect(travelMode).toHaveValue("transit");
  const description = planner.getByLabel("Describe what matters to your trip", { exact: true });
  await description.fill("I need groceries soon for a household of 3. I prefer driving.");
  await planner.getByRole("button", { name: "Interpret preferences", exact: true }).click();
  await expect(planner.getByRole("button", { name: "Review and apply suggested preferences", exact: true })).toBeVisible();
  await expect(service).toHaveValue("food");
  await expect(travelMode).toHaveValue("transit");
  expect(assistRequest).toEqual({
    task: "preferences",
    text: "I need groceries soon for a household of 3. I prefer driving.",
  });

  await planner.getByRole("button", { name: "Review and apply suggested preferences", exact: true }).click();
  await expect(service).toHaveValue("groceries");
  await expect(planner.locator(".navigation-preferences select").nth(1)).toHaveValue("soon");
  await expect(planner.locator(".navigation-preferences__advanced-content select").nth(0)).toHaveValue("3");
  await expect(travelMode).toHaveValue("driving");
  await expect(planner.getByText("Preferences applied. Check the fields above and search when ready.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-navigation-needs-reviewed.png`), fullPage: true });
});

test("driving result preserves driving costs, grounded guidance, map selection and exports", async ({
  page,
}, testInfo) => {
  test.skip(!supportedProject(testInfo.project.name), "Run on mobile and desktop widths.");
  await page.addInitScript(() => {
    Object.defineProperty(window, "__reachPrintCalls", { value: 0, writable: true });
    window.print = () => {
      (window as unknown as { __reachPrintCalls: number }).__reachPrintCalls += 1;
    };
  });
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/access/plan", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: drivingGuidanceResponse });
  });

  await openPlanner(page);
  const planner = page.locator(".access-planner");
  await selectManualOrigin(planner.locator(".location-picker").first());
  await planner.getByRole("combobox", { name: /Travel by/ }).selectOption("driving");
  await planner.getByRole("button", { name: "Find food I can reach", exact: true }).click();
  await expect(planner.getByRole("heading", { name: "Review your trip", exact: true })).toBeVisible();
  expect(submitted).toMatchObject({
    input: { mode: "driving", origin: { lat: 30.674, lng: -96.376 } },
  });
  await expect(planner.getByText(/14 min drive \(5\.2 mi routed\) · fuel and parking costs unknown/)).toBeVisible();
  await expect(planner.locator(".access-planner__card").first()).not.toContainText(/fare \$0\.00|No travel fare/i);
  await expect(planner.getByRole("heading", { name: "Suggested option", exact: true })).toBeVisible();
  await expect(planner.getByText(/14 min driving, 5\.2 miles routed; fuel and parking costs unknown/).first()).toBeVisible();

  const guidance = planner.locator(".navigation-guidance");
  await guidance.getByRole("button", { name: "Synthetic Driving Pantry Beta", exact: true }).click();
  const alpha = planner.locator(".access-planner__choose").filter({ hasText: "Synthetic Driving Pantry Alpha" });
  const beta = planner.locator(".access-planner__choose").filter({ hasText: "Synthetic Driving Pantry Beta" });
  await expect(alpha).toHaveAttribute("aria-pressed", "false");
  await expect(beta).toHaveAttribute("aria-pressed", "true");
  const map = planner.getByRole("region", { name: "Journey map" });
  await expect(map.locator(".map-summary")).toContainText(
    "Destination: Synthetic Driving Pantry Beta.",
  );

  const externalDirections = planner.getByRole("link", { name: "Open directions in Google Maps", exact: true });
  await expect(externalDirections).toHaveAttribute("href", /travelmode=driving/);
  const downloadPromise = page.waitForEvent("download");
  await planner.getByRole("button", { name: "Download text itinerary", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("reach-food-itinerary.txt");
  const itinerary = await readFile((await download.path())!, "utf8");
  expect(itinerary).toContain("Travel mode: Driving");
  expect(itinerary).toContain("Routed driving: 18 minutes, 5.2 miles");
  await planner.getByRole("button", { name: "Print itinerary", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __reachPrintCalls: number }).__reachPrintCalls)).toBe(1);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-navigation-driving-result.png`), fullPage: true });
});
