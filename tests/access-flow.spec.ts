import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { accountHash } from "../src/lib/account-store";
import { openPantryDatabase } from "../src/lib/pantry-store";
import {
  addOrganizationContact,
  initializeOutreach,
} from "../src/lib/outreach-store";
import { dispatchOutreach } from "../src/lib/outreach-worker";
import { deliverMail, emailDeliveryMode } from "../src/lib/mail-delivery";
import { privateAvailability } from "../src/lib/access-service";
import { chicagoNow } from "../src/lib/journey";
import { shiftDate } from "../src/lib/time";

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

async function selectCoordinates(
  picker: import("@playwright/test").Locator,
  latitude: string,
  longitude: string,
) {
  const advanced = picker.locator("details.location-advanced");
  await advanced.locator("summary").click();
  await advanced.getByLabel("Latitude", { exact: true }).fill(latitude);
  await advanced.getByLabel("Longitude", { exact: true }).fill(longitude);
  await advanced
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
}

const fixtureResponse = {
  timezone: "America/Chicago",
  searchedAt: new Date().toISOString(),
  routingCalls: 0,
  aiCalls: 0,
  message: "Synthetic browser fixture only. No real journey was measured.",
  options: [
    {
      id: "synthetic-alpha",
      kind: "pantry",
      resource: {
        id: "synthetic-alpha",
        name: "Synthetic Pantry Alpha",
        address: "Synthetic address, Bryan, TX",
        coordinates: { lat: 30.674, lng: -96.376 },
        hours: "Synthetic fixture hours",
        eligibility: "Fixture eligibility requires confirmation",
        notes: "Synthetic test data. Not a real service.",
        offering: "Synthetic grocery fixture",
        verificationStatus: "needs-confirmation",
        detailsNeedConfirmation: true,
        sources: [],
      },
      status: "confirm",
      reasons: ["Synthetic route fixture only."],
      warnings: ["Synthetic browser data; no service was contacted."],
      labels: ["No travel fare"],
      availability: {
        status: "unknown",
        source: "Synthetic fixture; food availability unknown",
        reportedAt: null,
        expiresAt: null,
      },
      outbound: {
        departure: 600,
        arrival: 625,
        walkingMinutes: 10,
        walkingMiles: 0.6,
        fare: 0,
        transfers: 0,
        source: "routed",
        steps: ["Synthetic outbound walking direction."],
        paths: [
          {
            id: "synthetic-outbound",
            mode: "walking",
            label: "Synthetic route only",
            coordinates: [
              [-96.38, 30.67],
              [-96.376, 30.674],
            ],
          },
        ],
        attribution: [],
        warnings: ["Synthetic browser fixture only."],
      },
      returnJourney: {
        departure: 660,
        arrival: 685,
        walkingMinutes: 10,
        walkingMiles: 0.6,
        fare: 0,
        transfers: 0,
        source: "routed",
        steps: ["Synthetic return walking direction."],
        paths: [],
        attribution: [],
        warnings: ["Synthetic browser fixture only."],
      },
      serviceStart: 630,
      serviceEnd: 660,
      intakeCutoff: 645,
      score: -1,
    },
    {
      id: "synthetic-beta",
      kind: "pantry",
      resource: {
        id: "synthetic-beta",
        name: "Synthetic Pantry Beta",
        address: "Another synthetic address, Bryan, TX",
        coordinates: { lat: 30.68, lng: -96.37 },
        hours: "Synthetic fixture hours",
        eligibility: "Fixture eligibility requires confirmation",
        notes: "Synthetic test data. Not a real service.",
        offering: "Synthetic grocery fixture",
        verificationStatus: "needs-confirmation",
        detailsNeedConfirmation: true,
        sources: [],
      },
      status: "confirm",
      reasons: ["Synthetic route fixture only."],
      warnings: ["Synthetic browser data; no service was contacted."],
      labels: [],
      availability: {
        status: "unknown",
        source: "Synthetic fixture; food availability unknown",
        reportedAt: null,
        expiresAt: null,
      },
      outbound: null,
      returnJourney: null,
      serviceStart: null,
      serviceEnd: null,
      intakeCutoff: null,
      score: -2,
    },
  ],
};

test("location denial and manual origin keep the real planner honest when routing is unconfigured", async ({
  page,
}, testInfo) => {
  test.skip(
    !supportedProject(testInfo.project.name),
    "Run this flow at mobile and desktop widths.",
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: unknown,
          error: (value: { code: number }) => void,
        ) => error({ code: 1 }),
        watchPosition: (
          _success: unknown,
          error: (value: { code: number }) => void,
        ) => error({ code: 1 }),
        clearWatch: () => {},
      },
    });
  });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await openPlanner(page);
  const planner = page.locator(".access-planner");
  const picker = planner.locator(".location-picker").first();
  await expect(planner.locator("form form")).toHaveCount(0);
  await picker
    .getByRole("button", { name: "Use my location", exact: true })
    .click();
  await expect(picker.getByRole("status")).toContainText(
    /location is unavailable/i,
  );

  await planner
    .getByRole("button", { name: "Find food I can reach", exact: true })
    .click();
  await expect(
    planner.getByText("Choose a starting location before searching.", {
      exact: true,
    }),
  ).toBeVisible();

  const advanced = picker.locator("details.location-advanced");
  await advanced.locator("summary").click();
  await advanced.getByLabel("Latitude", { exact: true }).fill("91");
  await advanced.getByLabel("Longitude", { exact: true }).fill("181");
  expect(
    await advanced
      .getByLabel("Latitude", { exact: true })
      .evaluate((input) => (input as HTMLInputElement).checkValidity()),
  ).toBe(false);
  expect(
    await advanced
      .getByLabel("Longitude", { exact: true })
      .evaluate((input) => (input as HTMLInputElement).checkValidity()),
  ).toBe(false);

  await advanced.getByLabel("Latitude", { exact: true }).fill("30.674");
  await advanced.getByLabel("Longitude", { exact: true }).fill("-96.376");
  await advanced
    .getByRole("button", { name: "Use these coordinates", exact: true })
    .click();
  await planner
    .getByRole("button", { name: "Find food I can reach", exact: true })
    .click();
  const firstCard = planner.locator(".access-planner__card").first();
  await expect(firstCard).toBeVisible();
  await expect(firstCard.locator(".access-planner__route-check")).toContainText(
    /no outbound itinerary/i,
  );
  await expect(firstCard).not.toContainText(/Board at .*\d{1,2}:\d{2}/);
  await expect(
    planner.getByText(/Routing is not configured for this deployment/i),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("fixture results select from the map list and retain return and travel preferences", async ({
  page,
}, testInfo) => {
  test.skip(
    !supportedProject(testInfo.project.name),
    "Run this flow at mobile and desktop widths.",
  );
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/access/plan", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: fixtureResponse });
  });
  await openPlanner(page);
  const planner = page.locator(".access-planner");
  await expect(planner).toBeVisible();
  await expect(planner.locator("form form")).toHaveCount(0);
  const pickers = planner.locator(".location-picker");
  await selectCoordinates(pickers.nth(0), "30.674", "-96.376");

  await planner
    .getByRole("combobox", { name: /Travel by/ })
    .selectOption("walking");
  await planner
    .getByLabel("Maximum walking time (minutes)", { exact: true })
    .fill("8");
  await planner.getByLabel("Fare budget (dollars)", { exact: true }).fill("0");
  await planner.getByLabel("Maximum transfers", { exact: true }).fill("0");
  await planner.getByLabel("I need step-free travel", { exact: false }).check();
  await planner
    .getByText("Plan a return trip too (optional)", { exact: true })
    .click();
  const returnPicker = planner.locator(
    ".access-planner__return .location-picker",
  );
  await selectCoordinates(returnPicker, "30.61", "-96.31");
  await planner
    .getByLabel("Return by (optional)", { exact: true })
    .fill("11:30");
  const nextDayCheckbox = planner.getByLabel(
    "Return deadline is the next day",
    { exact: true },
  );
  const nextDayLabel = planner.locator(".access-planner__next-day");
  const checkboxBox = await nextDayCheckbox.boundingBox();
  const labelBox = await nextDayLabel.boundingBox();
  expect(checkboxBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(checkboxBox!.width).toBeGreaterThanOrEqual(23);
  expect(checkboxBox!.width).toBeLessThanOrEqual(25);
  expect(checkboxBox!.height).toBeGreaterThanOrEqual(23);
  expect(checkboxBox!.height).toBeLessThanOrEqual(25);
  expect(labelBox!.height).toBeGreaterThanOrEqual(44);
  await nextDayLabel.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-next-day-checkbox.png`),
  });
  await nextDayCheckbox.check();

  const assist = planner.getByLabel("Describe what matters to your trip", {
    exact: true,
  });
  await assist.fill("I can walk about 8 minutes and need step-free travel.");
  const preferenceResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/access/assist") &&
      response.request().method() === "POST",
  );
  await planner
    .getByRole("button", { name: "Interpret preferences", exact: true })
    .click();
  const unavailableResponse = await preferenceResponse;
  expect(unavailableResponse.ok()).toBe(true);
  const unavailablePreferences = await unavailableResponse.json();
  expect(unavailablePreferences.status).toBe("unavailable");
  expect(unavailablePreferences.message).toMatch(
    /not enabled|unavailable|configured/i,
  );
  await expect(planner.locator(".access-planner__assist")).toContainText(
    unavailablePreferences.message,
  );

  await planner
    .getByRole("button", { name: "Find food I can reach", exact: true })
    .click();
  await expect(
    planner.getByRole("heading", { name: "Review your trip", exact: true }),
  ).toBeVisible();
  await expect(
    planner.getByText(
      "Synthetic browser fixture only. No real journey was measured.",
    ),
  ).toBeVisible();
  await expect(
    planner
      .getByText("Synthetic outbound walking direction.", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    planner
      .getByText("Synthetic return walking direction.", { exact: true })
      .first(),
  ).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  const map = planner.getByRole("region", { name: "Journey map" });
  const mapChoices = map.locator('ul[aria-label="Map pantry alternatives"]');
  await expect(mapChoices).toBeVisible();
  await mapChoices
    .getByRole("button", { name: "Synthetic Pantry Beta", exact: true })
    .click();
  await expect(
    planner
      .locator(".access-planner__choose")
      .filter({ hasText: "Synthetic Pantry Beta" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-synthetic-planner.png`),
    fullPage: true,
  });
  expect(submitted).toMatchObject({
    input: {
      origin: { lat: 30.674, lng: -96.376 },
      mode: "walking",
      maxWalkingMinutes: 8,
      fareBudget: 0,
      maxTransfers: 0,
      mobility: "step-free",
      returnTo: { lat: 30.61, lng: -96.31 },
      returnDeadline: "35:30",
    },
  });
  expect(JSON.stringify(fixtureResponse)).toContain(
    "Synthetic browser fixture",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("verified account reviews outreach and private reply in isolated preview storage", async ({
  page,
}, testInfo) => {
  test.skip(
    !supportedProject(testInfo.project.name),
    "Run this flow at mobile and desktop widths.",
  );
  const databasePath = process.env.REACH_ACCESS_TEST_DB || "";
  const previewRoot = process.env.REACH_ACCESS_TEST_PREVIEW_DIR || "";
  test.skip(
    !databasePath || !previewRoot,
    "Requires explicit isolated /tmp database and preview paths.",
  );
  const dbPath = resolve(databasePath);
  const configuredDb = process.env.REACH_COMMUNITY_DB || "";
  expect(isAbsolute(databasePath)).toBe(true);
  expect(dbPath.startsWith(resolve(tmpdir()) + sep)).toBe(true);
  expect(resolve(previewRoot).startsWith(resolve(tmpdir()) + sep)).toBe(true);
  expect(resolve(configuredDb)).toBe(dbPath);
  expect(process.env.REACH_EMAIL_PROVIDER).toBe("preview");
  expect(emailDeliveryMode()).toBe("preview");

  const baseOrigin = new URL(testInfo.project.use.baseURL as string).origin;
  expect(process.env.REACH_APP_ORIGIN).toBe(baseOrigin);
  mkdirSync(resolve(previewRoot), { recursive: true, mode: 0o700 });
  const isolatedPreview = mkdtempSync(
    join(resolve(previewRoot), "browser-preview-"),
  );
  chmodSync(isolatedPreview, 0o700);
  const db = openPantryDatabase(dbPath);
  initializeOutreach(db);
  const userId = randomUUID();
  const rawSession = randomBytes(32).toString("hex");
  const at = new Date();
  const email = `access-flow-${userId}@example.test`;
  const pantryId = `access-browser-${userId}`;
  let recipientId = "";
  try {
    db.prepare(
      "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at,name) VALUES(?,?,?,'','resident',1,?,?,?,'Synthetic browser account')",
    ).run(
      userId,
      userId,
      "fixture-only-no-login",
      at.toISOString(),
      email,
      at.toISOString(),
    );
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      accountHash(rawSession),
      userId,
      new Date(+at + 7 * 86400000).toISOString(),
    );
    const syntheticResource = {
      id: pantryId,
      name: "Synthetic Browser Pantry",
      address: "Synthetic fixture address",
      coordinates: null,
      hours: "Synthetic fixture hours",
      eligibility: "Synthetic fixture eligibility",
      notes: "Synthetic browser fixture; not a real service.",
      offering: "Synthetic browser fixture",
      verificationStatus: "needs-confirmation",
      detailsNeedConfirmation: true,
      sources: [],
      windows: [],
      closures: [],
      scheduleNotes: "Synthetic browser fixture only.",
    };
    const syntheticPlanner = {
      id: pantryId,
      name: "Synthetic Browser Pantry",
      address: "Synthetic fixture address",
      windows: [],
      walkConnections: [],
      directWalks: [],
      sources: [],
      notes: "Synthetic browser fixture; not a real service.",
      coordinates: null,
      pickupFormat: "unknown",
      pedestrianPickup: "unknown",
    };
    db.prepare(
      "INSERT INTO pantries(id,name,address,resource_json,planner_json,active,version,website,last_verified,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?,?,?)",
    ).run(
      pantryId,
      "Synthetic Browser Pantry",
      "Synthetic fixture address",
      JSON.stringify(syntheticResource),
      JSON.stringify(syntheticPlanner),
      "https://fixture.example.test/",
      at.toISOString().slice(0, 10),
      at.toISOString(),
      at.toISOString(),
    );
    recipientId = addOrganizationContact(db, {
      pantryId,
      name: "Synthetic Browser Pantry",
      email: `recipient-${userId}@example.test`,
      sourceUrl: "https://fixture.example.test/participation",
      consentConfirmed: true,
    });

    await page.context().addCookies([
      {
        name: "reach_community_session",
        value: rawSession,
        url: baseOrigin,
        httpOnly: true,
        secure: baseOrigin.startsWith("https:"),
        sameSite: "Strict",
      },
    ]);
    await page.goto("/outreach");
    const panel = page.getByRole("region", { name: "Ask a trusted recipient" });
    await expect(panel.getByText(/Preview mode is active\./)).toBeVisible();
    await panel
      .getByLabel("Trusted recipient", { exact: true })
      .selectOption(recipientId);
    await panel
      .getByLabel("What would you like to ask?", { exact: true })
      .fill("Do you have produce available tomorrow?");
    await panel
      .getByRole("button", { name: "Create a draft", exact: true })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Review your draft", exact: true }),
    ).toBeVisible();
    const subject = panel.getByLabel("Subject", { exact: true });
    const body = panel.getByLabel("Message", { exact: true });
    await subject.fill("Synthetic browser inquiry, reviewed");
    await body.fill(
      `${await body.inputValue()}\n\nSynthetic browser fixture note.`,
    );
    await expect(body).toContainText(
      "Reach is sending an AI-assisted inquiry on a user's behalf.",
    );
    const consent = panel.getByRole("checkbox", {
      name: /I reviewed the recipient and message and authorize this email/,
    });
    await expect(
      panel.getByRole("button", { name: "Authorize and queue", exact: true }),
    ).toBeDisabled();
    await consent.check();
    await panel
      .getByRole("button", { name: "Authorize and queue", exact: true })
      .click();
    await expect(
      panel.getByText("Queued for delivery", { exact: true }),
    ).toBeVisible();

    // Keep the active provider explicit and preview-only. The aliases avoid
    // mutating Node's readonly NODE_ENV typing, and only redirect the capture.
    const fixtureEnv = process.env as Record<string, string | undefined>;
    const oldPreviewDir = fixtureEnv.REACH_EMAIL_PREVIEW_DIR;
    fixtureEnv.REACH_EMAIL_PREVIEW_DIR = isolatedPreview;
    try {
      const previewResult = await dispatchOutreach(db, {
        now: () => new Date(),
        send: deliverMail,
      });
      // Dispatch through the actual preview transport only. It writes a private local
      // capture and cannot contact an email service because preview is the active provider.
      expect(previewResult.preview).toBe(1);
    } finally {
      if (oldPreviewDir === undefined)
        delete fixtureEnv.REACH_EMAIL_PREVIEW_DIR;
      else fixtureEnv.REACH_EMAIL_PREVIEW_DIR = oldPreviewDir;
    }
    const captures = readdirSync(isolatedPreview);
    expect(captures).toHaveLength(1);
    const capturePath = join(isolatedPreview, captures[0]);
    expect(statSync(capturePath).mode & 0o777).toBe(0o600);
    const capture = readFileSync(capturePath, "utf8");
    expect(capture).toContain("Synthetic browser inquiry, reviewed");
    expect(capture).toContain("Synthetic browser fixture note.");
    expect(capture).toContain(
      "Reach is sending an AI-assisted inquiry on a user's behalf.",
    );
    expect(capture).not.toContain("recipient@example.org");

    await page.reload();
    await expect(
      panel.getByText("Preview only · no email sent", { exact: true }),
    ).toBeVisible();
    expect((await page.request.get("/api/outreach")).status()).toBe(200);
    const thread = db
      .prepare(
        "SELECT id FROM outreach_threads WHERE user_id=? AND recipient_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId, recipientId)!;
    const reportDate = shiftDate(chicagoNow(new Date()).date, 1);
    const replyText = "We have produce available tomorrow from 9 AM to 10 AM.";
    db.prepare(
      "INSERT INTO outreach_replies(id,thread_id,email_id,text,received_at,facts_json) VALUES(?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      String(thread.id),
      randomUUID(),
      replyText,
      new Date().toISOString(),
      JSON.stringify({
        availability: "available",
        date: reportDate,
        pickupStart: "09:00",
        pickupEnd: "10:00",
        foodType: "produce",
        requirements: "",
        supportingText:
          "We have produce available tomorrow from 9 AM to 10 AM.",
        uncertainty: [],
      }),
    );
    const publicInventoryBefore = db
      .prepare(
        "SELECT category,status,quantity,source,updated_at FROM pantry_inventory WHERE pantry_id=? ORDER BY category",
      )
      .all(pantryId);
    await page.reload();
    await expect(
      panel.getByRole("heading", {
        name: "Reply · private · sender unverified",
      }),
    ).toBeVisible();
    await expect(panel.locator(".outreach-reply-text")).toHaveText(replyText);
    const facts = panel.locator(".outreach-facts");
    const expectedDateLabel = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${reportDate}T12:00:00Z`));
    await expect(
      facts
        .locator("dt")
        .filter({ hasText: /^Date$/ })
        .locator("xpath=following-sibling::dd[1]"),
    ).toHaveText(expectedDateLabel);
    await expect(
      facts.getByText("Pickup time · America/Chicago", { exact: true }),
    ).toBeVisible();
    await expect(
      facts
        .locator("dt")
        .filter({ hasText: /^Pickup time · America\/Chicago$/ })
        .locator("xpath=following-sibling::dd[1]"),
    ).toHaveText("09:00 – 10:00");
    await panel
      .getByRole("checkbox", { name: /I reviewed this private reply/ })
      .check();
    await panel
      .getByRole("button", { name: "Confirm private review", exact: true })
      .click();
    await expect(panel.getByText(/Privately reviewed/)).toBeVisible();
    const privateReport = privateAvailability(
      db,
      userId,
      pantryId,
      reportDate,
      new Date(),
    );
    expect(privateReport.availability.status).toBe("available");
    expect(privateReport.availability.source).toContain("Private");
    expect(
      db
        .prepare(
          "SELECT category,status,quantity,source,updated_at FROM pantry_inventory WHERE pantry_id=? ORDER BY category",
        )
        .all(pantryId),
    ).toEqual(publicInventoryBefore);
    expect(
      db
        .prepare(
          "SELECT reviewed_at,expires_at FROM outreach_replies WHERE thread_id=?",
        )
        .get(String(thread.id))!.reviewed_at,
    ).toBeTruthy();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(
        `${testInfo.project.name}-private-outreach.png`,
      ),
      fullPage: true,
    });
  } finally {
    if (recipientId)
      db.prepare("DELETE FROM outreach_recipients WHERE id=?").run(recipientId);
    db.prepare("DELETE FROM pantries WHERE id=?").run(pantryId);
    db.prepare("DELETE FROM users WHERE id=?").run(userId);
    rmSync(isolatedPreview, { recursive: true, force: true });
  }
});
