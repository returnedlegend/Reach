import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { renderEmail } from "../src/lib/email-templates";
import type {
  ManagedVolunteerRun,
  VolunteerRun,
} from "../src/lib/volunteer-types";

// Explicit synthetic fixtures. These are never public pantry records or real mail.
const fixtureRun = (): VolunteerRun => ({
  id: "fixture-run",
  offerId: "fixture-offer",
  pantryId: "fixture-pantry",
  pantryName: "Test destination pantry",
  offerTitle: "Test shelf-stable donation",
  pickupAreaId: "bryan",
  quantity: 3,
  foodCategory: "Pantry staples",
  allergens: "Contains wheat",
  storage: "Keep dry",
  useBy: "2027-01-10",
  startsAt: "2027-01-01T15:00:00.000Z",
  endsAt: "2027-01-01T17:00:00.000Z",
  status: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
async function mockVolunteer(
  page: Page,
  options: { signedIn?: boolean; pending?: boolean } = {},
) {
  const writes: { path: string; body: unknown }[] = [];
  let claimed = false;
  let approved = false;
  let pickupReads = 0;
  await page.route("**/api/pantries?*", (route) =>
    route.fulfill({
      json: {
        pantries: [
          {
            id: "fixture-pantry",
            name: "Test destination pantry",
            active: true,
          },
        ],
      },
    }),
  );
  await page.route("**/api/volunteer{,/**}", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      writes.push({ path, body: route.request().postDataJSON() });
      if (path.endsWith("/claim")) claimed = true;
      if (path.endsWith("/approve")) approved = true;
      return route.fulfill({ json: { run: fixtureRun() } });
    }
    if (path.endsWith("/pickup")) {
      pickupReads++;
      return route.fulfill({
        json: {
          instructions: "TEST PRIVATE INSTRUCTIONS — synthetic fixture only",
          area: {
            id: "bryan",
            name: "Bryan",
            lat: 30,
            lng: -96,
            precision: "approximate",
          },
        },
      });
    }
    if (path.endsWith("/eligible-offers"))
      return route.fulfill({ json: { offers: [{ ...fixtureRun() }] } });
    if (path.endsWith("/mine")) {
      if (!options.signedIn)
        return route.fulfill({
          status: 401,
          json: { error: "Sign in required" },
        });
      const managed: ManagedVolunteerRun = {
        ...fixtureRun(),
        status: claimed
          ? "assigned"
          : options.pending && !approved
            ? "pending"
            : "open",
        donorId: "fixture-owner",
        volunteerId: claimed ? "fixture-volunteer" : null,
        canApprove: !!options.pending && !approved,
        canCancel: false,
        canComplete: false,
        canRelease: claimed,
        canViewPickup: claimed,
      };
      return route.fulfill({
        json: {
          runs: claimed || options.pending ? [managed] : [],
          participationEnabled: true,
          emailVerified: true,
        },
      });
    }
    return route.fulfill({
      json: { runs: claimed || options.pending ? [] : [fixtureRun()] },
    });
  });
  return { writes, pickupReads: () => pickupReads };
}

test("volunteer acceptance requires explicit consent and private instructions require a separate request", async ({
  page,
}) => {
  const fixture = await mockVolunteer(page, { signedIn: true });
  await page.goto("/volunteer");
  await expect(
    page.getByRole("heading", { name: "Help with a food pickup." }),
  ).toBeVisible();
  const accept = page.getByRole("button", { name: "Accept this pickup" });
  await expect(accept).toBeDisabled();
  expect(fixture.pickupReads()).toBe(0);
  await expect(page.getByText("fixture-run", { exact: false })).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "I can meet this pickup window" })
    .check();
  await accept.click();
  await expect(page.getByRole("status")).toContainText("Pickup accepted");
  expect(fixture.writes[0]).toEqual({
    path: "/api/volunteer/fixture-run/claim",
    body: { pickupConsent: true },
  });
  expect(fixture.pickupReads()).toBe(0);
  await expect(
    page.getByText("TEST PRIVATE INSTRUCTIONS", { exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reveal private pickup instructions" })
    .click();
  await expect(
    page.getByText("TEST PRIVATE INSTRUCTIONS", { exact: false }),
  ).toBeVisible();
  expect(fixture.pickupReads()).toBe(1);
  await page.getByRole("button", { name: "Hide pickup instructions" }).click();
  await expect(
    page.getByText("TEST PRIVATE INSTRUCTIONS", { exact: false }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("donors select an existing approved offer and manager approval remains explicit", async ({
  page,
}) => {
  const fixture = await mockVolunteer(page, { signedIn: true, pending: true });
  await page.goto("/volunteer");
  await page.getByLabel("Approved food offer").selectOption("fixture-offer");
  await page.getByLabel("Destination pantry").selectOption("fixture-pantry");
  await page.getByRole("button", { name: "Request pantry approval" }).click();
  await expect(page.getByRole("status")).toContainText(
    "awaiting pantry manager approval",
  );
  expect(fixture.writes[0]).toEqual({
    path: "/api/volunteer",
    body: { offerId: "fixture-offer", pantryId: "fixture-pantry" },
  });
  await page
    .getByRole("button", { name: "Approve pickup", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Pickup approved");
  expect(fixture.writes[1]).toEqual({
    path: "/api/volunteer/fixture-run/approve",
    body: {},
  });
});

test("anonymous discovery has no acceptance action and disabled service has a recovery state", async ({
  page,
}) => {
  await mockVolunteer(page);
  await page.goto("/volunteer");
  await expect(
    page.getByRole("heading", { name: "Sign in to coordinate a pickup" }),
  ).toBeVisible();
  await expect(
    page.getByText("Test shelf-stable donation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept this pickup" }),
  ).toHaveCount(0);
  await page.route("**/api/volunteer", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Pickup coordination disabled" },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Pickup coordination is unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
});

test("unsubscribe fragment is removed and no mutation occurs before confirmation", async ({
  page,
}) => {
  const posts: unknown[] = [];
  await page.route("**/api/notifications/unsubscribe", (route) => {
    expect(route.request().method()).toBe("POST");
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { message: "Unsubscribed" } });
  });
  await page.goto(
    "/unsubscribe#token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const confirm = page.getByRole("button", { name: "Confirm unsubscribe" });
  await expect(confirm).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(posts).toEqual([]);
  await confirm.click();
  await expect(page.getByRole("status")).toContainText(
    "If this link is current, optional emails are now off",
  );
  expect(posts).toEqual([
    {
      token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ]);
  await expect(
    page.getByText("Essential account security messages will continue.", {
      exact: false,
    }),
  ).toBeVisible();
});

test("account preferences preserve explicit opt-ins and distinguish provider acceptance from delivery", async ({
  page,
}) => {
  const writes: unknown[] = [];
  const preferences = {
    pantry: false,
    volunteer: false,
    pickup: false,
    volunteerParticipation: false,
  };
  await page.route("**/api/account/status", (route) =>
    route.fulfill({ json: { enabled: true, emailConfigured: true } }),
  );
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "fixture-user",
          email: "fixture@example.test",
          emailVerified: true,
          name: "Test participant",
          role: "user",
        },
        preferences: {},
      },
    }),
  );
  await page.route("**/api/account/locations", (route) =>
    route.fulfill({ json: { locations: [] } }),
  );
  await page.route("**/api/pantries/favorites", (route) =>
    route.fulfill({ json: { pantries: [] } }),
  );
  await page.route("**/api/notifications", (route) => {
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          preferences: route.request().postDataJSON(),
          deliveryMode: "preview",
        },
      });
    }
    return route.fulfill({ json: { preferences, deliveryMode: "preview" } });
  });
  await page.route("**/api/notifications/deliveries", (route) =>
    route.fulfill({
      json: {
        deliveries: [
          {
            id: "test-delivery",
            status: "accepted",
            createdAt: "2026-01-01T00:00:00Z",
          },
          { id: "test-preview", status: "preview" },
          ...["pending", "delayed", "held", "bounced", "delivered"].map(
            (status) => ({ id: `test-${status}`, status }),
          ),
        ],
      },
    }),
  );
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Notifications & volunteering" }),
  ).toBeVisible();
  await expect(
    page.getByText("Preview mode: messages are recorded for testing.", {
      exact: false,
    }),
  ).toBeVisible();
  const card = page.getByRole("region", {
    name: "Notifications & volunteering",
  });
  const checks = card.getByRole("checkbox");
  await expect(checks).toHaveCount(4);
  for (const checkbox of await checks.all())
    await expect(checkbox).not.toBeChecked();
  await card
    .getByRole("checkbox", { name: "Pantry updates", exact: true })
    .check();
  await card
    .getByRole("checkbox", {
      name: "I want to participate as a volunteer",
      exact: true,
    })
    .check();
  await card
    .getByRole("button", { name: "Save notification preferences", exact: true })
    .click();
  await expect(card.getByRole("status")).toHaveText(
    "Notification preferences saved.",
  );
  expect(writes[0]).toEqual({
    pantry: true,
    volunteer: false,
    pickup: false,
    volunteerParticipation: true,
  });
  await card
    .getByRole("button", {
      name: "Unsubscribe from optional emails",
      exact: true,
    })
    .click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({
    pantry: false,
    volunteer: false,
    pickup: false,
    volunteerParticipation: true,
  });
  await card.locator("summary").click();
  await card
    .getByRole("button", { name: "Refresh email status", exact: true })
    .click();
  await expect(
    card.getByRole("listitem").filter({
      hasText: "Accepted by the email provider — delivery is not confirmed",
    }),
  ).toBeVisible();
  await expect(
    card
      .getByRole("listitem")
      .filter({ hasText: "Preview only — no email sent" }),
  ).toBeVisible();
  for (const label of [
    "Pending with the email provider — delivery is not confirmed",
    "Delayed by the email provider",
    "Held by the email provider",
    "Bounced — could not be delivered",
    "Accepted by recipient mail server — inbox placement is not confirmed",
  ]) {
    await expect(
      card.getByRole("listitem").filter({ hasText: label }),
    ).toBeVisible();
  }
  await expect(card).not.toContainText("fixture@example.test");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("shared email HTML is accessible and fits the viewport", async ({
  page,
}, testInfo) => {
  const previousOrigin = process.env.REACH_APP_ORIGIN;
  process.env.REACH_APP_ORIGIN = "https://reach.example.test";
  let html: string;
  try {
    html = renderEmail({
      heading: "A pickup is ready for your review",
      paragraphs: [
        "A donor has requested a pickup for a pantry you manage.",
        "Sign in to review the request. Private pickup instructions are shared only with authorized participants.",
      ],
      action: {
        label: "Review pickup request",
        url: "https://reach.example.test/volunteer",
      },
      footer:
        "You are receiving this optional pantry update because you chose it in your Reach preferences.",
      unsubscribeUrl: `https://reach.example.test/unsubscribe#token=${"a".repeat(64)}`,
    }).html;
  } finally {
    if (previousOrigin === undefined) delete process.env.REACH_APP_ORIGIN;
    else process.env.REACH_APP_ORIGIN = previousOrigin;
  }
  await page.route("**/*", (route) => route.abort());
  await page.setContent(html);
  await expect(
    page.locator("img, iframe, script, link[rel=stylesheet]"),
  ).toHaveCount(0);
  expect(html).not.toMatch(/@import|@font-face|url\(/i);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "no-referrer",
  );
  for (const link of await page.getByRole("link").all())
    await expect(link).toHaveAttribute("rel", "noreferrer");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A pickup is ready for your review",
  );
  await expect(
    page.getByRole("link", { name: "Review pickup request" }),
  ).toHaveAttribute("href", "https://reach.example.test/volunteer");
  await expect(
    page.getByRole("link", { name: "Unsubscribe from these emails" }),
  ).toHaveAttribute("href", /\/unsubscribe#token=a{64}$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("reach-email-template.png"),
    fullPage: true,
  });
});

test("shared app header keeps account and More volunteer destination usable at each viewport", async ({
  page,
}) => {
  await page.goto("/food-hotspots");
  const header = page.locator(".reach-header");
  for (const width of [page.viewportSize()!.width, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const menu = header.locator("summary[aria-label='More navigation']");
    await menu.focus();
    await page.keyboard.press("Enter");
    const volunteer = header
      .getByRole("navigation", { name: "More pages", exact: true })
      .getByRole("link", { name: "Volunteer pickups", exact: true });
    const account = header.getByRole("link", { name: "Account", exact: true });
    await expect(volunteer).toHaveAttribute("href", "/volunteer");
    await expect(account).toHaveAttribute("href", "/account");
    for (const link of [volunteer, account]) {
      await expect(link).toBeVisible();
      const bounds = (await link.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(() =>
        Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ),
      ),
    ).toBeLessThanOrEqual(width);
    const links = await header
      .getByRole("link")
      .filter({ visible: true })
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right };
        }),
      );
    expect(
      links.every((bounds) => bounds.left >= 0 && bounds.right <= width),
    ).toBe(true);
    await volunteer.focus();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
  }
});
