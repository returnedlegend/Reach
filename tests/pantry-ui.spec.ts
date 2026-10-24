import { expect, test, type Page } from "@playwright/test";
import type { BusySummary } from "../src/lib/crowd-types";
import type { PantryRecord } from "../src/lib/pantry-types";

// Deliberately synthetic UI contract fixtures. Never used as public pantry data.
const fixturePantry = (): PantryRecord => ({
  id: "ui-fixture-pantry",
  name: "UI Test Pantry",
  address: "Test address — not a real service",
  coordinates: null,
  hours: "Monday, 9 AM–noon. Test schedule only.",
  eligibility: "Eligibility unknown.",
  accessibility: "Accessibility unknown.",
  notes: "Explicit browser test fixture.",
  sources: [
    { title: "Browser test source" },
    { title: "Provider test schedule" },
  ],
  scheduleSources: [
    { id: "test-source", title: "Browser test source" },
    { id: "provider-test-source", title: "Provider test schedule" },
  ],
  active: true,
  version: 1,
  website: null,
  lastVerified: null,
  windows: [
    {
      id: "test-window",
      rule: { kind: "weekly", weekdays: [1] },
      opens: "09:00",
      closes: "12:00",
      policyKnown: false,
      conflictingSources: true,
      sourceIds: ["test-source", "unavailable-test-source"],
      registrationCutoff: "11:30",
    },
  ],
  closures: [],
  updatedAt: "2026-01-01T12:00:00.000Z",
});
const fixtureCrowd = (): BusySummary => ({
  pantryId: "ui-fixture-pantry",
  timeZone: "America/Chicago",
  days: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ].map((label, weekday) => ({
    label,
    weekday,
    hours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      level: weekday === 1 && hour === 9 ? 2 : null,
      waitMinutes: weekday === 1 && hour === 9 ? 12 : null,
      status:
        weekday === 1 && hour === 9
          ? ("observed" as const)
          : ("insufficient" as const),
      confidence: weekday === 1 && hour === 9 ? ("medium" as const) : null,
    })),
  })),
  hourly: [],
  recent: null,
  quieterWindow: null,
  method: "Explicit test fixture",
  explanation:
    "Synthetic observations used only to verify the browser interface.",
});
async function mockDetail(page: Page, signedIn = false) {
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        user: signedIn
          ? {
              id: "ui-admin",
              email: "admin@example.test",
              name: "Test administrator",
              emailVerified: true,
              role: "administrator",
            }
          : null,
      },
    }),
  );
  await page.route("**/api/pantries/favorites", (route) =>
    route.fulfill({ json: { favorites: [], pantries: [] } }),
  );
  await page.route("**/api/pantries/ui-fixture-pantry", (route) =>
    route.fulfill({
      json: {
        pantry: fixturePantry(),
        inventory: [],
        permissions: { canEdit: signedIn, isAdmin: signedIn },
      },
    }),
  );
  await page.route("**/api/crowd/ui-fixture-pantry", (route) =>
    route.fulfill({ json: fixtureCrowd() }),
  );
}

test("anonymous pantry detail uses the persistent directory and management stays gated", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/pantries?pageSize=1");
  expect(response.ok()).toBeTruthy();
  const { pantries } = await response.json();
  expect(pantries.length).toBeGreaterThan(0);
  const pantry = pantries[0];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/pantries/${encodeURIComponent(pantry.id)}`);
  await expect(
    page.getByRole("heading", { level: 1, name: pantry.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(pantry.address, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today’s distribution hours" }),
  ).toBeVisible();
  await expect(
    page.getByText("This is not live occupancy.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save pantry", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sign in to your account" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.goto("/manage");
  await expect(
    page.getByRole("heading", { name: "Sign in to manage pantries" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("explicit crowd fixture exposes hourly evidence and missing days never become quiet data", async ({
  page,
}) => {
  // The conflicting published window belongs to Monday. Keep the status
  // assertion on that day rather than inheriting the machine's current date.
  await page.clock.setFixedTime(new Date("2026-10-19T15:00:00Z"));
  await mockDetail(page);
  await page.goto("/pantries/ui-fixture-pantry");
  await expect(
    page.getByRole("heading", { name: "UI Test Pantry", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Current status unknown", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Monday", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Monday", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", {
      name: "9 AM: Moderately busy; reported wait about 12 minutes; medium confidence",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "9 AM: Moderately busy" }),
  ).toContainText("12 minutes");
  await page.getByRole("button", { name: "Tuesday", exact: true }).click();
  await expect(
    page.getByText("Not enough data", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".busy-chart")).toHaveCount(0);
  await expect(
    page.getByText("Missing reports do not mean a pantry is quiet.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("administrator forms preserve schedule evidence and send versioned pantry changes", async ({
  page,
}) => {
  let pantry = fixturePantry();
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await mockDetail(page, true);
  await page.route("**/api/pantries/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/pantries/", "");
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      if (path === pantry.id)
        pantry = { ...pantry, ...body, version: pantry.version + 1 };
      if (path.endsWith("/hours"))
        pantry = {
          ...pantry,
          windows: body.windows,
          closures: body.closures,
          version: pantry.version + 1,
        };
      if (path.endsWith("/archive"))
        pantry = { ...pantry, active: false, version: pantry.version + 1 };
      return route.fulfill({ json: { pantry } });
    }
    if (path === "management")
      return route.fulfill({ json: { pantries: [pantry], page: 1, total: 1 } });
    if (path === "assignments")
      return route.fulfill({ json: { assignments: [], page: 1, total: 0 } });
    if (path === pantry.id)
      return route.fulfill({
        json: {
          pantry,
          inventory: [],
          permissions: { canEdit: true, isAdmin: true },
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: "Unexpected test request" },
    });
  });
  await page.goto("/manage");
  await page
    .getByRole("button", { name: "Manage UI Test Pantry", exact: true })
    .click();
  await page
    .getByLabel("Pantry name", { exact: true })
    .fill("Updated UI Test Pantry");
  await page
    .getByRole("button", { name: "Save pantry information", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pantry information saved." }),
  ).toBeVisible();
  expect(writes[0].body).toMatchObject({
    version: 1,
    name: "Updated UI Test Pantry",
  });
  await page
    .getByRole("button", { name: "Hours & closures", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add distribution window", exact: true })
    .click();
  await expect(
    page.getByLabel("Distribution opens", { exact: true }).nth(1),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Distribution closes", { exact: true }).nth(1),
  ).toHaveValue("");
  const existingWindow = page.getByRole("group", {
    name: "Distribution window 1",
    exact: true,
  });
  await expect(
    existingWindow.getByRole("checkbox", {
      name: "Browser test source",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    existingWindow.getByText("A previously linked source needs confirmation.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(existingWindow).not.toContainText("unavailable-test-source");
  const newWindow = page.getByRole("group", {
    name: "Distribution window 2",
    exact: true,
  });
  await newWindow
    .getByLabel("Distribution opens", { exact: true })
    .fill("13:00");
  await newWindow
    .getByLabel("Distribution closes", { exact: true })
    .fill("14:00");
  await newWindow
    .getByRole("checkbox", { name: "Monday", exact: true })
    .check();
  await newWindow
    .getByRole("checkbox", { name: "Provider test schedule", exact: true })
    .check();
  await expect(
    newWindow.getByRole("checkbox", {
      name: "Provider test schedule",
      exact: true,
    }),
  ).toBeChecked();
  await existingWindow
    .getByLabel("Distribution opens", { exact: true })
    .fill("10:00");
  await page
    .getByRole("button", { name: "Save distribution hours", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Distribution schedule saved." }),
  ).toBeVisible();
  expect(writes[1]).toMatchObject({
    path: "ui-fixture-pantry/hours",
    body: {
      version: 2,
      windows: [
        {
          opens: "10:00",
          policyKnown: false,
          conflictingSources: true,
          sourceIds: ["test-source", "unavailable-test-source"],
          registrationCutoff: "11:30",
        },
        {
          opens: "13:00",
          closes: "14:00",
          rule: { kind: "weekly", weekdays: [1] },
          sourceIds: ["provider-test-source"],
        },
      ],
    },
  });
  await page
    .getByRole("button", { name: "Archive & restore", exact: true })
    .click();
  const archive = page.getByRole("button", {
    name: "Confirm archive pantry",
    exact: true,
  });
  await expect(archive).toBeDisabled();
  await page
    .getByLabel("Type “Updated UI Test Pantry” to confirm", { exact: true })
    .fill("Wrong name");
  await expect(archive).toBeDisabled();
  await page
    .getByLabel("Type “Updated UI Test Pantry” to confirm", { exact: true })
    .fill("Updated UI Test Pantry");
  await archive.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pantry archived" }),
  ).toBeVisible();
  expect(writes[2]).toEqual({
    path: "ui-fixture-pantry/archive",
    body: { confirmation: "Updated UI Test Pantry" },
  });
});
