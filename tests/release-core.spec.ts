import { expect, test } from "@playwright/test";
test.skip(
  !process.env.REACH_TEST_URL,
  "Requires the production CORE build with canonical local HTTPS origin.",
);
test("direct optional requests stay gated while anonymous directory endpoints work", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const endpoints = [
      "/api/account/me",
      "/api/community/offers",
      "/api/volunteer/runs",
      "/api/outreach",
      "/api/pantries/management",
    ];
    const statuses = await Promise.all(
      endpoints.map(async (url) => [url, (await fetch(url)).status]),
    );
    const account = await (await fetch("/api/account/status")).json();
    const ai = await (await fetch("/api/ai/status")).json();
    const google = await (await fetch("/api/auth/google/status")).json();
    const assistant = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return { statuses, account, ai, google, assistant: assistant.status };
  });
  expect(results.account.enabled).toBe(false);
  expect(results.ai.state).toBe("disabled");
  expect(results.google.configured).toBe(false);
  expect(results.assistant).toBe(404);
  for (const [, status] of results.statuses)
    expect([401, 404, 503]).toContain(status);
  expect((await page.request.get("/api/pantries")).status()).toBe(200);
});
test("standalone pantry supports device saving and anonymous correction without optional dead ends", async ({
  page,
}) => {
  await page.goto("/pantries/brazos-church-pantry");
  await expect(
    page.getByRole("heading", { name: "Brazos Church Pantry", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Pedestrian pickup permission is unknown/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Sign in|Reach AI assistant/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Ask about availability" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save pantry", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.getByText("Report incorrect information", { exact: true }).click();
  await page
    .getByLabel("Suggested correction")
    .fill(
      "Synthetic release browser check: please review the published entrance source. Not an organization report.",
    );
  await page
    .getByRole("button", { name: "Send correction for review" })
    .click();
  await expect(page.getByText(/Report recorded for review/)).toBeVisible();
});
test("a missing routing provider gives an honest planner result with useful fallback", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() + 86400000));
    const response = await fetch("/api/access/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          origin: { lat: 30.6729992, lng: -96.3718935 },
          date,
          departure: "09:00",
          mode: "walking",
          maxWalkingMinutes: 60,
          maxWalkingMiles: 4,
          fareBudget: 5,
          maxTransfers: 1,
          mobility: "standard",
          appointment: "unknown",
          eligibilityConfirmed: false,
          dietaryPreference: "",
          dietaryRequired: false,
          visitMinutes: 20,
          arrivalBufferMinutes: 10,
          allowWaiting: true,
        },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(result.status).toBe(200);
  expect(result.body.recommendation.selectedId).toBeNull();
  expect(
    result.body.options.every((o: { outbound: unknown }) => !o.outbound),
  ).toBe(true);
  expect(JSON.stringify(result.body)).toContain("No verified itinerary");
});

test("saving in embedded pantry details updates Saved immediately without a reload", async ({
  page,
}) => {
  await page.goto("/");
  const picker = page.locator(".location-picker").first();
  await picker
    .getByText("Advanced: enter coordinates", { exact: true })
    .click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6729992");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3718935");
  await picker
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await page
    .getByLabel("What do you need?", { exact: true })
    .fill("Brazos Church Pantry");
  await page.getByRole("button", { name: "Find food", exact: true }).click();
  await page
    .getByRole("article", { name: "Brazos Church Pantry", exact: true })
    .getByRole("button", {
      name: "More pantry details",
      exact: true,
    })
    .first()
    .click();
  const details = page.getByRole("dialog");
  await details
    .getByRole("button", { name: "Save pantry", exact: true })
    .click();
  await expect(details.getByRole("status")).toContainText(
    "Saved on this device",
  );
  await details
    .getByRole("button", { name: "Back to your trip", exact: true })
    .click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Brazos Church Pantry", exact: true }),
  ).toBeVisible();
});
