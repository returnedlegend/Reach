import { expect, test, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";

// Real MapLibre rendering, controlled background style. No external provider
// uptime, street cartography, geocoding or route accuracy is claimed here.
async function controlledMap(page: Page) {
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
}
async function openMapResourceChooser(
  page: Page,
  marker: Locator,
  expectedNames: string[],
  touch: (control: Locator) => Promise<void>,
) {
  const renderer = page.getByRole("region", { name: "Interactive journey map", exact: true });
  const chooser = page.getByRole("dialog", { name: "Choose a map resource", exact: true });
  const insideMap = async (control: Locator) =>
    (await control.isVisible()) && control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const viewport = element
        .closest(".maplibregl-map")!
        .getBoundingClientRect();
      return (
        rect.left >= viewport.left &&
        rect.right <= viewport.right &&
        rect.top >= viewport.top &&
        rect.bottom <= viewport.bottom
      );
    });
  for (let attempt = 0; attempt < 9; attempt++) {
    // At district scale only a cluster representative is a pointer target.
    // Inspect real visible chooser contents instead of clicking a hidden member.
    const candidates = [marker, ...await renderer.locator('button[data-clustered="true"]:visible').all()];
    for (const candidate of candidates) {
      if (!(await insideMap(candidate))) continue;
      if (Number(await candidate.getAttribute("data-overlap-count")) < 2) continue;
      await candidate.scrollIntoViewIfNeeded();
      await touch(candidate);
      if (await chooser.isVisible()) {
        const containsExpected = await Promise.all(expectedNames.map((name) =>
          chooser.getByRole("button", { name, exact: true }).isVisible()));
        if (containsExpected.every(Boolean)) return candidate;
        await page.keyboard.press("Escape");
      }
      await page.waitForTimeout(350); // Avoid interpreting repeated touch taps as map zoom.
    }
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await page.waitForTimeout(350); // Settle the real map animation before the next zoom.
  }
  throw new Error(`No visible map chooser contained ${expectedNames.join(", ")}`);
}

async function locationStep(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Food\b/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  return page.getByRole("region", { name: "Choose a starting location" });
}

async function manualLocation(page: Page) {
  const picker = await locationStep(page);
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  return picker;
}

test.beforeEach(async ({ page }) => controlledMap(page));

test("local place suggestions are keyboard usable and send no external geocoder request while typing", async ({
  page,
}) => {
  let geocoderRequests = 0;
  await page.route("**/api/geocode", (route) => {
    geocoderRequests++;
    return route.fulfill({ status: 503, json: { status: "unavailable" } });
  });
  const picker = await locationStep(page);
  await expect(
    picker.getByLabel("Latitude", { exact: true }),
  ).not.toBeVisible();
  await picker
    .getByLabel("Address", { exact: true })
    .pressSequentially("Bridge", { delay: 35 });
  const suggestion = picker
    .getByRole("group", { name: "Local places" })
    .getByRole("button", { name: /The Bridge Ministries Bryan/ });
  await expect(suggestion).toBeVisible();
  expect(geocoderRequests).toBe(0);
  await suggestion.focus();
  await page.keyboard.press("Enter");
  await expect(picker).toContainText("Local place selected");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6472913",
  );
  await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3606034",
  );
  expect(geocoderRequests).toBe(0);
});

test("map selection can be cancelled and never silently replaces the committed origin", async ({
  page,
}) => {
  const picker = await manualLocation(page);
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  await expect(
    map.getByText("Interactive map ready.", { exact: true }),
  ).toBeVisible();
  await map.getByRole("button", { name: "Choose on map", exact: true }).click();
  await expect(
    map.getByRole("button", { name: "Confirm location", exact: true }),
  ).toBeDisabled();
  const canvas = map.locator("canvas");
  const bounds = (await canvas.boundingBox())!;
  await canvas.click({
    position: { x: bounds.width * 0.7, y: bounds.height * 0.3 },
  });
  await expect(
    map.getByRole("button", { name: "Confirm location", exact: true }),
  ).toBeEnabled();
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6501234",
  );
  await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
  await map
    .getByRole("button", { name: "Cancel map selection", exact: true })
    .click();
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6501234",
  );
  await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
});

test("shared navigation preserves precise selected origin and offers an accessible responsive shell", async ({
  page,
}, testInfo) => {
  const picker = await manualLocation(page);
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  await nav.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Journey map", exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Community", exact: true }).click();
  await nav.getByRole("button", { name: "Explore", exact: true }).click();
  await expect(picker).toBeVisible();
  if (!(await picker.getByLabel("Latitude", { exact: true }).isVisible()))
    await picker
      .getByText("Advanced: enter coordinates", { exact: true })
      .click();
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6501234",
  );
  await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    report.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("transformed-location-shell.png"),
    fullPage: true,
  });
});

test.describe("real local community backend", () => {
  test.skip(
    process.env.REACH_TEST_COMMUNITY !== "true",
    "Requires explicitly enabled isolated community server and moderator test credentials.",
  );

  test("real sessions, moderation, private pickup and concurrent reservations enforce ownership", async ({
    playwright,
    baseURL,
    page,
  }, testInfo) => {
    const origin = new URL(baseURL!).origin;
    const contexts = await Promise.all(
      Array.from({ length: 4 }, () =>
        playwright.request.newContext({
          baseURL,
          extraHTTPHeaders: { Origin: origin },
        }),
      ),
    );
    const [donor, first, second, moderator] = contexts;
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const credentials = {
      password: "Independent QA password 2026",
      adultConfirmed: true,
    };
    try {
      const donorSignup = await donor.post("/api/community/auth/signup", {
        data: { username: `donor_${suffix}`, ...credentials },
      });
      expect(donorSignup.status()).toBe(201);
      expect(donorSignup.headers()["set-cookie"]).toContain("HttpOnly");
      expect(donorSignup.headers()["set-cookie"]).toContain("SameSite=Strict");
      expect(donorSignup.headers()["cache-control"]).toBe("no-store");
      for (const [client, prefix] of [
        [first, "first"],
        [second, "second"],
      ] as const)
        expect(
          (
            await client.post("/api/community/auth/signup", {
              data: { username: `${prefix}_${suffix}`, ...credentials },
            })
          ).status(),
        ).toBe(201);
      expect(
        (
          await moderator.post("/api/community/auth/login", {
            data: {
              username: process.env.REACH_TEST_MODERATOR_USERNAME,
              password: process.env.REACH_TEST_MODERATOR_PASSWORD,
            },
          })
        ).status(),
      ).toBe(200);
      expect((await first.get("/api/community/moderation")).status()).toBe(403);
      const own = await donor.get("/api/community/me");
      expect((await own.json()).user.role).toBe("resident");
      expect(
        (
          await donor.post("/api/community/organizer-request", {
            headers: { Origin: "https://attacker.invalid" },
            data: {},
          })
        ).status(),
      ).toBe(403);
      const endsAt = new Date(Date.now() + 3 * 3600000).toISOString();
      const privateInstructions = `QA private pickup instructions ${suffix}`;
      const offer = {
        title: `QA fixture sealed food ${suffix}`,
        description: "Synthetic QA listing; not real food availability.",
        pickupAreaId: "bryan",
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt,
        quantity: 1,
        foodCategory: "canned-groceries",
        labelsIntact: true,
        noExcludedProducts: true,
        allergens: "Fixture allergen disclosure",
        storage: "Store sealed in a cool dry place",
        useBy: endsAt.slice(0, 10),
        sealed: true,
        shelfStable: true,
        notHomemade: true,
        packagingUndamaged: true,
        notRecalled: true,
        privatePickupInstructions: privateInstructions,
        pickupIsPublicPlace: true,
        sharePickupInstructions: true,
      };
      expect(
        (
          await donor.post("/api/community/offers", {
            data: { ...offer, sealed: false },
          })
        ).status(),
      ).toBe(400);
      const created = await donor.post("/api/community/offers", {
        data: offer,
      });
      expect(created.status()).toBe(201);
      const id = (await created.json()).record.id;
      expect(
        (
          await first.patch(`/api/community/offers/${id}`, { data: offer })
        ).status(),
      ).toBe(403);
      expect(
        (
          await first.post(`/api/community/offers/${id}/cancel`, { data: {} })
        ).status(),
      ).toBe(403);
      expect(
        (await first.get("/api/community/discovery")).headers()[
          "cache-control"
        ],
      ).toBe("no-store");
      expect(
        JSON.stringify(
          await (await first.get("/api/community/discovery")).json(),
        ),
      ).not.toContain(id);
      expect(
        (
          await donor.post(`/api/community/offers/${id}/submit`, { data: {} })
        ).status(),
      ).toBe(200);
      expect(
        JSON.stringify(
          await (await first.get("/api/community/discovery")).json(),
        ),
      ).not.toContain(id);
      expect(
        (
          await moderator.post(
            `/api/community/moderation/offers/${id}/approve`,
            { data: {} },
          )
        ).status(),
      ).toBe(200);
      const publicData = await (
        await first.get("/api/community/discovery")
      ).json();
      const publicOffer = publicData.offers.find(
        (v: { id: string }) => v.id === id,
      );
      expect(publicOffer).toBeTruthy();
      expect(publicOffer).not.toHaveProperty("privatePickupInstructions");
      expect(publicOffer).not.toHaveProperty("lat");
      expect(publicOffer).not.toHaveProperty("lng");
      expect(JSON.stringify(publicData)).not.toContain(privateInstructions);
      const overlappingOffer = await donor.post("/api/community/offers", {
        data: { ...offer, title: `QA overlapping area ${suffix}` },
      });
      expect(overlappingOffer.status()).toBe(201);
      const overlappingId = (await overlappingOffer.json()).record.id;
      expect(
        (
          await donor.post(`/api/community/offers/${overlappingId}/submit`, {
            data: {},
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await moderator.post(
            `/api/community/moderation/offers/${overlappingId}/approve`,
            { data: {} },
          )
        ).status(),
      ).toBe(200);
      await manualLocation(page);
      const mainNav = page.getByRole("navigation", {
        name: "Main navigation",
        exact: true,
      });
      await mainNav.getByRole("button", { name: "Map", exact: true }).click();
      const offerPin = page.getByRole("button", {
        name: `${offer.title} — community food offer`,
        exact: true,
      });
      await expect(offerPin).toHaveAttribute("data-marker-kind", "offer");
      expect(await offerPin.locator("svg path").count()).toBeGreaterThan(0);
      await page.getByText("Filter resources", { exact: true }).click();
      await page
        .getByLabel("Resource type", { exact: true })
        .selectOption("transportation");
      const renderer = page.getByRole("region", {
        name: "Interactive journey map",
        exact: true,
      });
      const topOffer = renderer.locator('[data-marker-kind="offer"]').last();
      const touch = async (control: Locator) =>
        testInfo.project.use.hasTouch ? control.tap() : control.click();
      const busName =
        "BTD Bryan Terminal - Roy Kelly Parking Garage — official bus stop";
      const expectedNames = [
        `${offer.title} — community food offer`,
        `QA overlapping area ${suffix} — community food offer`,
        busName,
      ];
      const pointerTrigger = await openMapResourceChooser(page, topOffer, expectedNames, touch);
      await expect
        .poll(async () =>
          Number(await pointerTrigger.getAttribute("data-overlap-count")),
        )
        .toBeGreaterThanOrEqual(2);
      await expect(pointerTrigger.locator("[data-overlap-badge]")).toBeVisible();
      const chooser = page.getByRole("dialog", {
        name: "Choose a map resource",
        exact: true,
      });
      await expect(chooser).toBeVisible();
      await expect(
        chooser.getByRole("button", {
          name: `${offer.title} — community food offer`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        chooser.getByRole("button", {
          name: `QA overlapping area ${suffix} — community food offer`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        chooser.getByRole("button", { name: busName, exact: true }),
      ).toBeVisible();
      await chooser.screenshot({
        path: testInfo.outputPath("crowded-map-chooser-fixture.png"),
      });
      await page.keyboard.press("Escape");
      await expect(chooser).toHaveCount(0);
      await expect(pointerTrigger).toBeFocused();
      // Escape is a keyboard action between taps; avoid a synthetic mobile double-tap zoom.
      await page.waitForTimeout(350);
      await touch(pointerTrigger);
      await expect(chooser).toBeVisible();
      await touch(chooser.getByRole("button", { name: busName, exact: true }));
      await expect(chooser).toHaveCount(0);
      await expect(
        renderer.getByRole("button", { name: busName, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(renderer).toHaveAttribute(
        "data-origin-latitude",
        "30.6501234",
      );
      await expect(renderer).toHaveAttribute(
        "data-origin-longitude",
        "-96.3505678",
      );
      await page
        .getByRole("button", { name: "Close destination preview", exact: true })
        .click();
      await openMapResourceChooser(page, topOffer, expectedNames, touch);
      await expect(chooser).toBeVisible();
      await touch(
        chooser.getByRole("button", {
          name: `${offer.title} — community food offer`,
          exact: true,
        }),
      );
      const offerCard = page.locator(`#community-item-${id}`);
      await expect(offerCard).toBeVisible();
      await expect(
        offerCard.getByRole("link", { name: /directions|Google Maps/i }),
      ).toHaveCount(0);
      await mainNav.getByRole("button", { name: "Map", exact: true }).click();
      await expect(offerPin).toHaveAttribute("aria-pressed", "true");
      await expect(offerPin).toHaveAttribute("data-marker-kind", "offer");
      const requests = await Promise.all(
        [first, second].map((client) =>
          client.post(`/api/community/offers/${id}/request`, {
            data: { pickupConsent: true },
          }),
        ),
      );
      expect(requests.map((r) => r.status())).toEqual([201, 201]);
      const requestIds = await Promise.all(
        requests.map(async (r) => (await r.json()).id),
      );
      expect(
        (
          await first.get(`/api/community/requests/${requestIds[0]}/pickup`)
        ).status(),
      ).toBe(403);
      expect(
        (
          await first.post(`/api/community/offers/${id}/request`, {
            data: { pickupConsent: true },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await first.post(`/api/community/requests/${requestIds[0]}/accept`, {
            data: {},
          })
        ).status(),
      ).toBe(403);
      const accepts = await Promise.all(
        requestIds.map((rid) =>
          donor.post(`/api/community/requests/${rid}/accept`, { data: {} }),
        ),
      );
      expect(accepts.map((r) => r.status()).sort()).toEqual([200, 409]);
      const winnerIndex = accepts.findIndex((r) => r.status() === 200);
      const winner = [first, second][winnerIndex],
        loser = [first, second][1 - winnerIndex];
      const acceptedId = requestIds[winnerIndex];
      expect(
        (
          await winner.get(`/api/community/requests/${acceptedId}/pickup`)
        ).status(),
      ).toBe(200);
      expect(
        (
          await (
            await winner.get(`/api/community/requests/${acceptedId}/pickup`)
          ).json()
        ).instructions,
      ).toBe(privateInstructions);
      expect(
        (
          await loser.get(`/api/community/requests/${acceptedId}/pickup`)
        ).status(),
      ).toBe(403);
      expect(
        JSON.stringify(
          await (await loser.get("/api/community/discovery")).json(),
        ),
      ).not.toContain(id);
      expect(
        (
          await donor.post(`/api/community/requests/${acceptedId}/collect`, {
            data: {},
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await winner.get(`/api/community/requests/${acceptedId}/pickup`)
        ).status(),
      ).toBe(403);
      expect(
        (
          await donor.post(`/api/community/requests/${acceptedId}/collect`, {
            data: {},
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await donor.post(`/api/community/offers/${overlappingId}/cancel`, {
            data: {},
          })
        ).status(),
      ).toBe(200);
      const donorId = (await own.json()).user.id;
      expect(
        (
          await donor.post("/api/community/organizer-request", { data: {} })
        ).status(),
      ).toBe(200);
      expect(
        (
          await moderator.post(
            `/api/community/moderation/organizers/${donorId}/approve`,
            { data: {} },
          )
        ).status(),
      ).toBe(200);
      expect(
        (await (await donor.get("/api/community/me")).json()).user.role,
      ).toBe("organizer");
      const hotspotDraft = {
        title: `QA public hotspot ${suffix}`,
        description: "Synthetic QA fixture, not an actual distribution.",
        organizerName: "QA fixture organization",
        address: "QA public venue, Bryan",
        lat: 30.6744,
        lng: -96.3698,
        startsAt: offer.startsAt,
        endsAt,
        foodCategory: "Canned groceries",
        eligibility: "QA fixture",
        accessibility: "Unverified fixture",
        contact: "QA fixture contact",
        pickupInstructions: "QA public event instructions",
      };
      const hotspotResponse = await donor.post("/api/community/hotspots", {
        data: hotspotDraft,
      });
      expect(hotspotResponse.status()).toBe(201);
      const hotspotId = (await hotspotResponse.json()).record.id;
      expect(
        (
          await donor.post(`/api/community/hotspots/${hotspotId}/submit`, {
            data: {},
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await moderator.post(
            `/api/community/moderation/hotspots/${hotspotId}/reject`,
            { data: { reason: "QA correction required" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await donor.patch(`/api/community/hotspots/${hotspotId}`, {
            data: {
              ...hotspotDraft,
              description: "Corrected synthetic QA fixture.",
            },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await donor.post(`/api/community/hotspots/${hotspotId}/submit`, {
            data: {},
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await moderator.post(
            `/api/community/moderation/hotspots/${hotspotId}/approve`,
            { data: {} },
          )
        ).status(),
      ).toBe(200);
      expect(
        JSON.stringify(
          await (await first.get("/api/community/discovery")).json(),
        ),
      ).toContain(hotspotId);
      await mainNav
        .getByRole("button", { name: "Community", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Refresh listings", exact: true })
        .click();
      await expect(page.locator(`#community-item-${hotspotId}`)).toBeVisible();
      await mainNav.getByRole("button", { name: "Map", exact: true }).click();
      const hotspotPin = page.getByRole("button", {
        name: `${hotspotDraft.title} — community food hotspot`,
        exact: true,
      });
      await expect(hotspotPin).toHaveAttribute("data-marker-kind", "hotspot");
      expect(await hotspotPin.locator("svg path").count()).toBeGreaterThan(0);
      await hotspotPin.focus();
      await page.keyboard.press("Enter");
      const hotspotCard = page.locator(`#community-item-${hotspotId}`);
      const directions = new URL(
        (await hotspotCard
          .getByRole("link", {
            name: /^Walking directions in Google Maps/,
          })
          .getAttribute("href"))!,
      );
      expect(directions.searchParams.get("origin")).toBe(
        "30.6501234,-96.3505678",
      );
      expect(directions.searchParams.get("destination")).toBe(
        "30.6744,-96.3698",
      );
      expect(directions.searchParams.get("travelmode")).toBe("walking");
      await mainNav.getByRole("button", { name: "Map", exact: true }).click();
      await page
        .getByRole("button", { name: "Edit starting point", exact: true })
        .click();
      await page
        .getByText("Advanced: enter coordinates", { exact: true })
        .click();
      await page.getByLabel("Latitude", { exact: true }).fill("30.6609876");
      await page.getByLabel("Longitude", { exact: true }).fill("-96.3401234");
      await page
        .getByRole("button", { name: "Use these coordinates", exact: true })
        .click();
      await mainNav
        .getByRole("button", { name: "Community", exact: true })
        .click();
      const editedDirections = new URL(
        (await hotspotCard
          .getByRole("link", { name: /^Walking directions in Google Maps/ })
          .getAttribute("href"))!,
      );
      expect(editedDirections.searchParams.get("origin")).toBe(
        "30.6609876,-96.3401234",
      );
      expect(editedDirections.searchParams.get("destination")).toBe(
        "30.6744,-96.3698",
      );
      await mainNav.getByRole("button", { name: "Map", exact: true }).click();
      await expect(hotspotPin).toHaveAttribute("aria-pressed", "true");
      await expect(hotspotPin).toHaveAttribute("data-marker-kind", "hotspot");
      expect(
        (
          await first.post("/api/community/reports", {
            data: {
              targetType: "hotspot",
              targetId: hotspotId,
              reason: "QA safety report fixture",
            },
          })
        ).status(),
      ).toBe(201);
      const queue = await (
        await moderator.get("/api/community/moderation")
      ).json();
      const reportId = queue.reports.find(
        (item: { targetId: string }) => item.targetId === hotspotId,
      ).id;
      expect(
        (
          await first.post(
            `/api/community/moderation/hotspots/${hotspotId}/remove`,
            { data: { reason: "Unauthorized" } },
          )
        ).status(),
      ).toBe(403);
      expect(
        (
          await moderator.post(
            `/api/community/moderation/hotspots/${hotspotId}/remove`,
            { data: { reason: "QA takedown" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        JSON.stringify(
          await (await first.get("/api/community/discovery")).json(),
        ),
      ).not.toContain(hotspotId);
      expect(
        (
          await moderator.post(
            `/api/community/moderation/reports/${reportId}/resolve`,
            { data: { reason: "QA removed after report" } },
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await (await moderator.get("/api/community/moderation")).json()
        ).reports.some((item: { id: string }) => item.id === reportId),
      ).toBe(false);
      const blockOfferResponse = await donor.post("/api/community/offers", {
        data: { ...offer, title: `QA block fixture ${suffix}` },
      });
      expect(blockOfferResponse.status()).toBe(201);
      const blockOfferId = (await blockOfferResponse.json()).record.id;
      expect(
        (
          await donor.post(`/api/community/offers/${blockOfferId}/submit`, {
            data: {},
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await moderator.post(
            `/api/community/moderation/offers/${blockOfferId}/approve`,
            { data: {} },
          )
        ).status(),
      ).toBe(200);
      const blockRequestResponse = await first.post(
        `/api/community/offers/${blockOfferId}/request`,
        { data: { pickupConsent: true } },
      );
      expect(blockRequestResponse.status()).toBe(201);
      const blockRequestId = (await blockRequestResponse.json()).id;
      expect(
        (
          await donor.post(`/api/community/requests/${blockRequestId}/accept`, {
            data: {},
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await first.get(`/api/community/requests/${blockRequestId}/pickup`)
        ).status(),
      ).toBe(200);
      expect(
        (
          await first.post("/api/community/blocks", {
            data: { userId: donorId },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await first.get(`/api/community/requests/${blockRequestId}/pickup`)
        ).status(),
      ).toBe(403);
      const blockedRequest = (
        await (await first.get("/api/community/mine")).json()
      ).requests.find((item: { id: string }) => item.id === blockRequestId);
      expect(blockedRequest.status).toBe("cancelled");
      expect(
        JSON.stringify(
          await (await first.get("/api/community/discovery")).json(),
        ),
      ).not.toContain(blockOfferId);
      expect(
        (
          await donor.post(`/api/community/offers/${blockOfferId}/cancel`, {
            data: {},
          })
        ).status(),
      ).toBe(200);
      expect(
        (await donor.post("/api/community/auth/logout", { data: {} })).status(),
      ).toBe(200);
      expect((await donor.get("/api/community/mine")).status()).toBe(401);
      expect(
        (await (await donor.get("/api/community/me")).json()).user,
      ).toBeNull();
    } finally {
      await Promise.all(contexts.map((c) => c.dispose()));
    }
  });
});

async function communityView(page: Page) {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Community", exact: true })
    .click();
  await expect(page.getByTestId("community-discovery")).toBeVisible();
}
async function communityAccount(
  page: Page,
  username: string,
  password: string,
  signup: boolean,
) {
  await communityView(page);
  await page
    .getByRole("navigation", { name: "Community views", exact: true })
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  const form = page.getByTestId("community-account");
  if (signup)
    await form
      .getByRole("button", { name: "New here? Create account", exact: true })
      .click();
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  if (signup) await form.getByRole("checkbox").check();
  await form
    .getByRole("button", {
      name: signup ? "Create account" : "Sign in",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("community-dashboard")).toBeVisible();
}

test("real browser accounts create and moderate an offer, accept a request and confirm collection", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.REACH_TEST_COMMUNITY !== "true",
    "Requires isolated enabled community backend and moderator test credentials.",
  );
  test.setTimeout(120_000);
  const contextOptions = {
    baseURL,
    viewport: page.viewportSize()!,
    isMobile: Boolean(testInfo.project.use.isMobile),
    hasTouch: Boolean(testInfo.project.use.hasTouch),
    userAgent: testInfo.project.use.userAgent,
    timezoneId: "America/Chicago",
  };
  const receiverContext = await browser.newContext(contextOptions),
    moderatorContext = await browser.newContext(contextOptions);
  const receiver = await receiverContext.newPage(),
    moderator = await moderatorContext.newPage();
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const title = `QA browser fixture ${suffix}`,
    secret = `QA private public-place meeting ${suffix}`;
  const password = "Browser QA passphrase 2026";
  try {
    await communityAccount(page, `ui_giver_${suffix}`, password, true);
    await page
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "Share Food", exact: true })
      .click();
    const form = page.getByTestId("community-create-form");
    await form.locator('[name="title"]').fill(title);
    await form
      .locator('[name="description"]')
      .fill("Synthetic QA fixture; no real food is available.");
    const dates = await page.evaluate(() => {
      const local = (time: number) => {
        const d = new Date(time);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      };
      return {
        start: local(Date.now() - 120000),
        end: local(Date.now() + 3600000),
        useBy: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      };
    });
    await form.locator('[name="startsAt"]').fill(dates.start);
    await form.locator('[name="endsAt"]').fill(dates.end);
    await form.locator('[name="pickupAreaId"]').selectOption("bryan");
    await form.locator('[name="quantity"]').fill("1");
    await form.locator('[name="useBy"]').fill(dates.useBy);
    await form
      .locator('[name="allergens"]')
      .fill("Fixture label: contains wheat.");
    await form
      .locator('[name="storage"]')
      .fill("Sealed in a clean dry cupboard.");
    await form.locator('[name="privatePickupInstructions"]').fill(secret);
    await form
      .locator('[name="foodCategory"]')
      .selectOption("canned-groceries");
    await form.locator('input[name="photo"]').setInputFiles({
      name: "invalid-fixture.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("not an actual image"),
    });
    for (const checkbox of await form.getByRole("checkbox").all())
      await checkbox.check();
    await form.getByRole("button", { name: "Save draft", exact: true }).click();
    const ownPost = page
      .getByTestId("community-dashboard")
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(ownPost).toContainText("draft");
    await expect(page.getByTestId("community-error")).toContainText(
      "Your draft was saved, but its photo was not saved.",
    );
    await ownPost
      .getByRole("button", { name: "Edit draft", exact: true })
      .click();
    const fixturePhoto = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 3,
        background: { r: 120, g: 170, b: 80 },
      },
    })
      .withExif({ IFD0: { Artist: "Synthetic QA image metadata" } })
      .png()
      .toBuffer();
    await form.locator('input[name="photo"]').setInputFiles({
      name: "qa-fixture.png",
      mimeType: "image/png",
      buffer: fixturePhoto,
    });
    await form.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(ownPost).toContainText("draft");
    await ownPost.getByText("Post details", { exact: true }).click();
    const draftImage = ownPost.getByRole("img", {
      name: `Photo supplied for ${title}`,
      exact: true,
    });
    await expect(draftImage).toBeVisible();
    await expect
      .poll(() =>
        draftImage.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(32);
    const mediaPath = (await draftImage.getAttribute("src"))!;
    expect(
      (
        await receiver.request.get(new URL(mediaPath, baseURL!).toString())
      ).status(),
    ).toBe(404);
    const sanitizedMedia = await page.request.get(
      new URL(mediaPath, baseURL!).toString(),
    );
    expect(sanitizedMedia.status()).toBe(200);
    expect(sanitizedMedia.headers()["content-type"]).toBe("image/jpeg");
    const metadata = await sharp(await sanitizedMedia.body()).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.format).toBe("jpeg");
    await page.reload();
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Community", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "My activity", exact: true })
      .click();
    await expect(ownPost).toContainText("draft");
    await ownPost
      .getByRole("button", { name: "Submit for review", exact: true })
      .click();
    await expect(ownPost).toContainText("pending");
    await communityAccount(
      moderator,
      process.env.REACH_TEST_MODERATOR_USERNAME!,
      process.env.REACH_TEST_MODERATOR_PASSWORD!,
      false,
    );
    await moderator
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "Moderation", exact: true })
      .click();
    const review = moderator
      .getByTestId("community-moderation")
      .getByRole("article")
      .filter({
        has: moderator.getByRole("heading", { name: title, exact: true }),
      });
    await expect(review).not.toContainText(secret);
    await review.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(review).toHaveCount(0);
    await communityAccount(receiver, `ui_receiver_${suffix}`, password, true);
    await receiver
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "Find best resources", exact: true })
      .click();
    await receiver
      .getByLabel("Search community posts", { exact: true })
      .fill(title);
    const publicPost = receiver
      .getByTestId("community-discovery")
      .getByRole("article")
      .filter({
        has: receiver.getByRole("heading", { name: title, exact: true }),
      });
    await expect(publicPost).not.toContainText(secret);
    const publicImage = publicPost.getByRole("img", {
      name: `Photo supplied for ${title}`,
      exact: true,
    });
    await expect(publicImage).toBeVisible();
    await expect
      .poll(() =>
        publicImage.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(32);
    expect(
      (
        await receiver.request.get(new URL(mediaPath, baseURL!).toString())
      ).status(),
    ).toBe(200);
    await publicPost.getByRole("checkbox").check();
    await publicPost
      .getByRole("button", { name: "Request this food", exact: true })
      .click();
    await expect(publicPost).toContainText("You have a request for this offer");
    await page.reload();
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Community", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "My activity", exact: true })
      .click();
    await page
      .getByTestId("community-dashboard")
      .getByRole("button", { name: "Accept request", exact: true })
      .click();
    await expect(page.getByTestId("community-dashboard")).toContainText(
      "accepted",
    );
    await receiver.reload();
    await receiver
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Community", exact: true })
      .click();
    await receiver
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "My activity", exact: true })
      .click();
    await receiver
      .getByRole("button", { name: "View pickup instructions", exact: true })
      .click();
    await expect(receiver.getByTestId("community-dashboard")).toContainText(
      secret,
    );
    const accessibility = await new AxeBuilder({ page: receiver })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      accessibility.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    expect(
      await receiver.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await receiver.screenshot({
      path: testInfo.outputPath("community-accepted-request.png"),
      fullPage: true,
    });
    await receiver
      .getByRole("button", { name: "Mark collected", exact: true })
      .click();
    await expect(receiver.getByTestId("community-dashboard")).toContainText(
      "collected",
    );
    await expect(receiver.getByTestId("community-dashboard")).not.toContainText(
      secret,
    );
    await receiver
      .getByRole("navigation", { name: "Community views", exact: true })
      .getByRole("button", { name: "My account", exact: true })
      .click();
    await receiver
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(
      receiver
        .getByRole("navigation", { name: "Community views", exact: true })
        .getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  } finally {
    await receiverContext.close();
    await moderatorContext.close();
  }
});

test("GPS origin is centered at street scale and its accuracy and exact point survive tab changes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            timestamp: Date.now(),
            coords: {
              latitude: 30.6501234,
              longitude: -96.3505678,
              accuracy: 35,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
          } as GeolocationPosition);
        },
      },
    });
  });
  const picker = await locationStep(page);
  await picker
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  const map = page.getByRole("region", { name: "Journey map", exact: true });
  const renderer = page.getByRole("region", {
    name: "Interactive journey map",
    exact: true,
  });
  await expect(
    map.getByText("Interactive map ready.", { exact: true }),
  ).toBeVisible();
  await expect(renderer).toHaveAttribute("data-origin-latitude", "30.6501234");
  await expect(renderer).toHaveAttribute(
    "data-origin-longitude",
    "-96.3505678",
  );
  await expect(renderer).toHaveAttribute("data-location-source", "gps");
  await expect(renderer).toHaveAttribute("data-accuracy-meters", "35");
  await expect(map).toContainText(
    "Blue shading shows your estimated location accuracy (±35 m)",
  );
  const canvas = renderer.locator("canvas"),
    pin = renderer.getByRole("button", {
      name: "Your starting location",
      exact: true,
    });
  await expect
    .poll(async () => {
      const area = (await canvas.boundingBox())!,
        marker = (await pin.boundingBox())!;
      return Math.abs(marker.x + marker.width / 2 - (area.x + area.width / 2));
    })
    .toBeLessThan(20);
  for (const name of ["Zoom in", "Zoom out"]) {
    const control = map.getByRole("button", { name, exact: true });
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const icon = await control.locator(".maplibregl-ctrl-icon").boundingBox();
    expect(icon?.width).toBeGreaterThanOrEqual(24);
    expect(icon?.height).toBeGreaterThanOrEqual(24);
  }
  await map.screenshot({
    path: testInfo.outputPath("gps-accuracy-controlled-map.png"),
  });
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Map", exact: true })
    .click();
  await expect(renderer).toHaveAttribute("data-origin-latitude", "30.6501234");
  await expect(renderer).toHaveAttribute(
    "data-origin-longitude",
    "-96.3505678",
  );
  await expect(renderer).toHaveAttribute("data-accuracy-meters", "35");
  await page.getByText("Filter resources", { exact: true }).click();
  await page
    .getByLabel("Resource type", { exact: true })
    .selectOption("transportation");
  await expect(renderer.locator('[data-marker-kind="pantry"]')).toHaveCount(0);
  await expect(renderer.locator('[data-marker-kind="bus"]')).toHaveCount(6);
  const busPin = renderer.getByRole("button", {
    name: "Sandy Point @ Forest Park Apartments — official bus stop",
    exact: true,
  });
  // Wait for each real zoom animation; rapid clicks interrupt the prior one.
  for (let attempt = 0; attempt < 8; attempt++) {
    const insideMap = await busPin.evaluate((element) => {
      const marker = element.getBoundingClientRect();
      const viewport = element
        .closest(".maplibregl-map")!
        .getBoundingClientRect();
      return (
        marker.left >= viewport.left &&
        marker.right <= viewport.right &&
        marker.top >= viewport.top &&
        marker.bottom <= viewport.bottom
      );
    });
    if (insideMap) break;
    await map.getByRole("button", { name: "Zoom out", exact: true }).click();
    await page.waitForTimeout(350);
  }
  await expect(busPin).toBeInViewport();
  await busPin.click();
  const crowdedBusChooser = page.getByRole("dialog", {
    name: "Choose a map resource",
    exact: true,
  });
  if (await crowdedBusChooser.isVisible())
    await crowdedBusChooser
      .getByRole("button", {
        name: "Sandy Point @ Forest Park Apartments — official bus stop",
        exact: true,
      })
      .click();
  await expect(busPin).toHaveAttribute("aria-pressed", "true");
  await expect(busPin).toHaveAttribute("data-marker-kind", "bus");
  expect(await busPin.locator("svg path").count()).toBeGreaterThan(0);
  const preview = page.getByRole("region", {
    name: "Destination preview",
    exact: true,
  });
  await expect(preview).toContainText("Sandy Point @ Forest Park Apartments");
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await page.getByLabel("Verified accessibility only", { exact: true }).check();
  await expect(
    page.getByRole("heading", {
      name: "No listings match these filters",
      exact: true,
    }),
  ).toBeVisible();
  await expect(renderer.locator('[data-marker-kind="bus"]')).toHaveCount(0);
  await page
    .getByLabel("Verified accessibility only", { exact: true })
    .uncheck();
  await expect(renderer.locator('[data-marker-kind="bus"]')).toHaveCount(6);
});

test("saved resource and trip survive reload while precise origin requires explicit consent", async ({
  page,
}) => {
  await manualLocation(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Where would you like to go?")
    .selectOption("bridge-ministries");
  await page
    .getByRole("button", { name: "Show my options", exact: true })
    .click();
  const detail = page.locator(".reach-resource-detail");
  await detail
    .getByRole("button", {
      name: "Save The Bridge Ministries Bryan",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save trip", exact: true }).click();
  const storageWithoutConsent = await page.evaluate(() =>
    JSON.stringify(localStorage),
  );
  expect(storageWithoutConsent).not.toContain("30.6501234");
  expect(storageWithoutConsent).not.toContain("-96.3505678");
  await page
    .getByLabel(
      "Include my precise starting location and route details in this saved trip",
      { exact: true },
    )
    .check();
  await page.getByRole("button", { name: "Save trip", exact: true }).click();
  const storageWithConsent = await page.evaluate(() =>
    JSON.stringify(localStorage),
  );
  expect(storageWithConsent).toContain("30.6501234");
  expect(storageWithConsent).toContain("-96.3505678");
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Your saved places & trips.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Unsave The Bridge Ministries Bryan",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Starting location not saved.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Precise starting location included with your consent.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete trip", exact: true }),
  ).toHaveCount(2);
  while (
    await page.getByRole("button", { name: "Delete trip", exact: true }).count()
  )
    await page
      .getByRole("button", { name: "Delete trip", exact: true })
      .first()
      .click();
  await page
    .getByRole("button", {
      name: "Unsave The Bridge Ministries Bryan",
      exact: true,
    })
    .click();
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Saved", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delete trip", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Tap Save on a resource to find it here.", { exact: true }),
  ).toBeVisible();
});
