import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const origin = { lat: 30.654321, lng: -96.654321 };
const syntheticPlan = {
  timezone: "America/Chicago",
  searchedAt: "2026-10-23T12:00:00.000Z",
  routingCalls: 0,
  aiCalls: 0,
  message: "Synthetic assistant browser fixture only.",
  guidance: {
    assistance: "deterministic",
    status: "ready",
    headline: "Synthetic route comparison",
    paragraphs: ["Synthetic trip evidence only; no pantry was contacted."],
    selectedId: "a-hopeful-harvest",
    alternativeIds: [],
    evidence: [],
    modules: [],
    limitations: ["Synthetic fixture; real availability is unknown."],
    aiCalls: 0,
  },
  options: [
    {
      id: "a-hopeful-harvest",
      kind: "pantry",
      resource: {
        id: "a-hopeful-harvest",
        name: "Synthetic Assistant Pantry",
        address: "Synthetic fixture address, Bryan, TX",
        coordinates: { lat: 30.66, lng: -96.65 },
        hours: "Synthetic fixture hours",
        eligibility: "Confirm directly",
        notes: "Synthetic fixture only.",
        offering: "Synthetic groceries",
        verificationStatus: "needs-confirmation",
        detailsNeedConfirmation: true,
        sources: [],
      },
      status: "confirm",
      reasons: ["Synthetic browser fixture; no route was measured."],
      warnings: ["Synthetic fixture only; food stock is unknown."],
      labels: [],
      availability: {
        status: "unknown",
        source: "Synthetic fixture; stock unknown",
        reportedAt: null,
        expiresAt: null,
      },
      outbound: {
        mode: "driving",
        distanceMiles: 2.1,
        durationMinutes: 9,
        departure: 1080,
        arrival: 1089,
        walkingMinutes: 0,
        walkingMiles: 0,
        fare: null,
        transfers: 0,
        source: "routed",
        steps: ["Synthetic fixture route only."],
        paths: [],
        attribution: [],
        warnings: ["Synthetic browser fixture only."],
      },
      returnJourney: null,
      serviceStart: 1140,
      serviceEnd: 1200,
      intakeCutoff: null,
      score: -1,
    },
  ],
};

async function openAssistant(
  page: import("@playwright/test").Page,
  fromMap = false,
) {
  await page.goto("/");
  // The food-first homepage keeps the assistant in the map toolbar.
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "Reach AI assistant", exact: true }).click();
  return page.getByRole("dialog", { name: "Reach AI assistant" });
}

async function setManualOrigin(dialog: import("@playwright/test").Locator) {
  await dialog.getByText("Choose a starting point (optional)").click();
  const picker = dialog.locator(".location-picker").first();
  const advanced = picker.locator("details.location-advanced");
  await advanced.locator("summary").click();
  await picker.getByLabel("Latitude", { exact: true }).fill(String(origin.lat));
  await picker.getByLabel("Longitude", { exact: true }).fill(String(origin.lng));
  await picker.getByRole("button", { name: "Use these coordinates", exact: true }).click();
}

test.describe("assistant conversation", () => {

    test("asks for a location before route work and forwards only the selected coordinates to planning", async ({ page }, testInfo) => {
      const requests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.url().endsWith("/api/assistant") && request.method() === "POST") {
          try {
            requests.push(JSON.parse(request.postData() || "{}"));
          } catch {
            requests.push({ malformed: true });
          }
        }
      });
      const dialog = await openAssistant(page, true);
      await expect(dialog.getByRole("button", { name: "Close assistant" })).toBeFocused();
      await dialog.getByLabel("Departure time (America/Chicago)").fill("18:00");
      await dialog.getByLabel("What do you need help finding?").fill("I need groceries soon, by bus.");
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await expect(dialog.getByText(/Choose your starting point/)).toBeVisible();
      expect(requests[0]).toMatchObject({ message: "I need groceries soon, by bus." });
      expect(requests[0]).not.toHaveProperty("input");

      await setManualOrigin(dialog);
      const planningResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/assistant") &&
        response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      const actualAssistantResponse = await planningResponse;
      const actualAssistant = await actualAssistantResponse.json();
      await expect(dialog.getByText(/could not confirm a workable trip/i)).toBeVisible();
      expect(requests[1].input).toMatchObject({
        origin,
        mode: "transit",
        departure: "18:00",
      });
      expect(requests[1].departureExplicit).toBe(true);
      expect(JSON.stringify(requests[1].message)).not.toContain(`${origin.lat}`);
      await expect(dialog.getByText(/No route, opening time or food stock has been invented/)).toBeVisible();
      await expect(dialog.locator(".reach-assistant__option").first()).toContainText(/No outbound route was returned/);

      const axe = await new AxeBuilder({ page }).include(".reach-assistant").analyze();
      expect(axe.violations.filter((violation) => ["critical", "serious"].includes(violation.impact || ""))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await dialog.screenshot({ path: `test-results/assistant-${testInfo.project.name}-no-route.png` });
      const selectedOption = actualAssistant.plan.options.find(
        (option: { id: string }) => option.id === actualAssistant.plan.guidance.selectedId,
      ) ?? actualAssistant.plan.options[0];
      const noRouteCard = dialog.locator(".reach-assistant__option").first();
      const calculateRouteLink = noRouteCard.getByRole("link", { name: /Google Maps/ });
      await expect(calculateRouteLink).toBeVisible();
      await expect(calculateRouteLink).toContainText("calculate a route");
      const noRouteUrl = new URL((await calculateRouteLink.getAttribute("href"))!);
      const destination = selectedOption.resource.coordinates;
      expect(noRouteUrl.searchParams.get("origin")).toBe(`${origin.lat},${origin.lng}`);
      expect(noRouteUrl.searchParams.get("destination")).toBe(`${destination.lat},${destination.lng}`);
      expect(noRouteUrl.searchParams.get("travelmode")).toBe("transit");
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(
        page.locator(".reach-map-view").getByRole("button", { name: "Reach AI assistant", exact: true }),
      ).toBeFocused();
    });

    test("shows synthetic recommendations and requires an explicit map selection", async ({ page }, testInfo) => {
      const assistantRequests: Array<Record<string, unknown>> = [];
      await page.route("**/api/assistant", async (route) => {
        assistantRequests.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "cache-control": "private, no-store" },
          body: JSON.stringify({
            status: "ready",
            assistance: "computed",
            reply: "Synthetic fixture results are ready for review.",
            plan: syntheticPlan,
          }),
        });
      });
      const dialog = await openAssistant(page);
      await setManualOrigin(dialog);
      await dialog.getByLabel("Travel mode").selectOption("driving");
      await dialog.getByLabel("What do you need help finding?").fill("Synthetic groceries by car");
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await expect(dialog.getByRole("heading", { name: "Synthetic Assistant Pantry" })).toBeVisible();
      await expect(dialog.getByText(/Synthetic fixture only/).first()).toBeVisible();
      await expect(dialog.getByText(/9 minutes · 2.1 routed miles by driving/)).toBeVisible();
      expect(assistantRequests[0].input).toMatchObject({ origin, mode: "driving" });
      await dialog.getByRole("button", { name: "Show on map", exact: true }).click();
      const directions = page.getByRole("region", { name: "Trip directions" });
      await expect(directions.getByRole("heading", { name: "A Hopeful Harvest" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Driving directions" })).toBeVisible();
      await expect(directions.getByText(/Routed distance: 2\.10 miles · 9 minutes/)).toBeVisible();
      await expect(directions.getByRole("combobox", { name: "How will you travel?" })).toHaveValue("driving");
      await expect(directions.getByText("Synthetic fixture route only.")).toBeVisible();
      const directionsLink = directions.getByRole("link", { name: /Google Maps/ });
      const directionsUrl = new URL((await directionsLink.getAttribute("href"))!);
      const actualDestination = await page.evaluate(async () => {
        const response = await fetch("/api/pantries?pageSize=100");
        const body = await response.json();
        return body.pantries.find((pantry: { id: string }) => pantry.id === "a-hopeful-harvest")?.coordinates;
      });
      expect(directionsUrl.searchParams.get("origin")).toBe(`${origin.lat},${origin.lng}`);
      expect(directionsUrl.searchParams.get("destination")).toBe(`${actualDestination.lat},${actualDestination.lng}`);
      expect(directionsUrl.searchParams.get("travelmode")).toBe("driving");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/assistant-${testInfo.project.name}-map-selection.png`, fullPage: true });
    });

    test("availability inquiry only opens the reviewed outreach panel and sends no email", async ({ page }, testInfo) => {
      const outreachRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/outreach/"))
          outreachRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      });
      await page.route("**/api/assistant", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ready",
            assistance: "computed",
            reply: "This synthetic pantry can be reviewed for an inquiry.",
            inquiryPantryId: "synthetic-public-pantry",
          }),
        });
      });
      const dialog = await openAssistant(page);
      await dialog.getByLabel("What do you need help finding?").fill("Please ask about availability");
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await dialog.getByRole("button", { name: "Ask about availability", exact: true }).click();
      await expect(dialog.getByText(/Outreach|Sign in|inquiry/i).first()).toBeVisible();
      expect(outreachRequests.every((entry) => entry.startsWith("GET "))).toBe(true);
      expect(outreachRequests).toEqual(
        expect.not.arrayContaining([expect.stringMatching(/^POST /)]),
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await dialog.screenshot({ path: `test-results/assistant-${testInfo.project.name}-inquiry-review.png` });
    });
});
