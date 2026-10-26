import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { accountHash } from "../src/lib/account-store";
import {
  closeCommunityDatabases,
  openCommunityDatabase,
} from "../src/lib/community";
import { closeSharingDatabases } from "../src/lib/sharing";
import sharp from "sharp";

/**
 * Run with REACH_TEST_SHARING=true and both DB variables pointing at the same
 * fresh file below /tmp. The webServer must inherit those variables so browser
 * requests and this fixture use the same isolated SQLite database.
 */
test("account-free sharing stays private until an authenticated moderator approves it", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.REACH_TEST_SHARING !== "true",
    "Requires an explicitly enabled community server and isolated sharing database.",
  );
  test.skip(
    !["mobile", "desktop"].includes(testInfo.project.name),
    "Run the sharing journey at mobile and desktop widths.",
  );
  test.setTimeout(90_000);

  const databasePath = process.env.REACH_SHARING_TEST_DB || "";
  const communityPath = process.env.REACH_COMMUNITY_DB || "";
  const dbPath = resolve(databasePath);
  expect(databasePath).toBeTruthy();
  expect(dbPath.startsWith(`${resolve(tmpdir())}${sep}`)).toBe(true);
  expect(resolve(communityPath)).toBe(dbPath);
  expect(process.env.REACH_RELEASE_PROFILE).toBe("extended");

  const db = openCommunityDatabase(dbPath);
  const moderatorId = randomUUID();
  const rawSession = randomBytes(32).toString("hex");
  const now = new Date();
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,pantry_role) VALUES(?,?, '', '', 'moderator',1,?,'user')",
  ).run(
    moderatorId,
    `sharing_mod_${moderatorId.replaceAll("-", "").slice(0, 16)}`,
    now.toISOString(),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(rawSession),
    moderatorId,
    new Date(+now + 3600000).toISOString(),
  );

  const origin = new URL(baseURL!).origin;
  const moderatorContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize()!,
    isMobile: Boolean(testInfo.project.use.isMobile),
    hasTouch: Boolean(testInfo.project.use.hasTouch),
    timezoneId: "America/Chicago",
  });
  const moderatorPage = await moderatorContext.newPage();
  await moderatorContext.addCookies([
    {
      name: "reach_community_session",
      value: rawSession,
      url: origin,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const suffix = randomUUID().slice(0, 8);
  const title = `Synthetic sharing fixture ${suffix}`;
  const privateEmail = `private-${suffix}@example.test`;
  const publicEmail = `public-${suffix}@example.test`;
  const photoBuffer = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#6b8f71" },
  })
    .png()
    .toBuffer();

  try {
    // A fresh browser has no account or session and can still submit.
    await page.goto("/share");
    await expect(
      page.getByText("You can submit without an account."),
    ).toBeVisible();
    const offerChoice = page.locator(".sharing-choice button").nth(1);
    await expect(offerChoice).toContainText("Share Extra Food");
    await offerChoice.click();
    await expect(offerChoice).toHaveAttribute("aria-pressed", "true");
    const form = page.locator("form.sharing-card");
    await form.getByLabel("Title").fill(title);
    await form
      .getByLabel("Description")
      .fill("Synthetic browser fixture; no food is available.");
    const dates = await page.evaluate(() => {
      const local = (offset: number) => {
        const date = new Date(Date.now() + offset);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      };
      return {
        start: local(3600000),
        end: local(7200000),
        useBy: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      };
    });
    await form.getByLabel("Pickup starts").fill(dates.start);
    await form.getByLabel("Pickup ends").fill(dates.end);
    await form.getByLabel("Approximate pickup area").selectOption("bryan");
    await form.getByLabel("Number of portions or items").fill("2");
    await form
      .locator('select[name="foodCategory"]')
      .selectOption("canned-groceries");
    await form.getByLabel("Use by date").fill(dates.useBy);
    await form
      .getByLabel("Storage instructions")
      .fill("Keep in a cool, dry place.");
    await form
      .getByLabel("Allergens or cross-contact information")
      .fill("Contains wheat.");
    await form
      .getByLabel(
        "I confirm this is sealed, in-date, commercially packaged shelf-stable food with intact labels and packaging, and is not homemade, perishable, or recalled.",
      )
      .check();
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(form.locator('fieldset[data-step="1"]')).toBeVisible();
    await form.getByLabel("Your name").fill("Synthetic Submitter");
    await form.getByLabel("Your email (private)").fill(privateEmail);
    await form.getByLabel("Contact shown publicly").fill(publicEmail);
    await form.getByLabel("Optional photo").setInputFiles({
      name: "synthetic-sharing-fixture.png",
      mimeType: "image/png",
      buffer: photoBuffer,
    });
    await form.getByRole("button", { name: "Back", exact: true }).click();
    await expect(form.locator('fieldset[data-step="0"]')).toBeVisible();
    await expect(form.getByLabel("Title")).toHaveValue(title);
    await expect(form.getByLabel("Description")).toHaveValue(
      "Synthetic browser fixture; no food is available.",
    );
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(form.getByLabel("Your email (private)")).toHaveValue(
      privateEmail,
    );
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(form.locator('fieldset[data-step="2"]')).toBeVisible();
    for (const label of [
      "I am an adult and have permission to share this food or host this pickup.",
      "I agree that the public contact above can be shown with this approved listing.",
      "I agree to the community food sharing rules and understand Reach reviews submissions before anything is made public.",
    ])
      await form.getByLabel(label).check();
    const submittedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/sharing/submissions" &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Send for review" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Sent for review",
      }),
    ).toBeVisible();
    const submitted = await (await submittedResponse).json();
    const submissionId = submitted.submission.id as string;
    const account = await page.request.get("/api/account/me");
    expect(account.ok()).toBe(true);
    expect((await account.json()).user).toBeNull();

    const discoveryBefore = await page.request.get("/api/community/discovery");
    expect(discoveryBefore.ok()).toBe(true);
    const before = await discoveryBefore.json();
    expect(
      before.offers.some((offer: { title: string }) => offer.title === title),
    ).toBe(false);
    expect(JSON.stringify(before)).not.toContain(privateEmail);
    expect((await page.request.get("/api/sharing/admin")).status()).toBe(401);

    await moderatorPage.goto(
      `/admin?request=${encodeURIComponent(submissionId)}`,
    );
    const card = moderatorPage
      .locator(".sharing-review")
      .filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/sharing-review-focused/);
    await expect(card).toContainText(privateEmail);
    await expect(card).toContainText(publicEmail);
    const moderatorPhoto = card.locator("img.sharing-photo");
    await expect(moderatorPhoto).toBeVisible();
    await expect(moderatorPhoto).toHaveAttribute(
      "src",
      /\/api\/sharing\/admin\/.+\/photo$/,
    );
    const photoResponse = await moderatorPage.request.get(
      (await moderatorPhoto.getAttribute("src"))!,
    );
    expect(photoResponse.ok()).toBe(true);
    expect(photoResponse.headers()["content-type"]).toMatch(/^image\//);
    const anonymousPhoto = await page.request.get(
      (await moderatorPhoto.getAttribute("src"))!,
    );
    expect(anonymousPhoto.status()).toBe(401);
    moderatorPage.on("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Approve and publish" }).click();
    await expect(card.getByText("approved", { exact: true })).toBeVisible();

    const discoveryAfter = await page.request.get("/api/community/discovery");
    expect(discoveryAfter.ok()).toBe(true);
    const after = await discoveryAfter.json();
    const published = after.offers.find(
      (offer: { title: string }) => offer.title === title,
    );
    expect(published).toBeTruthy();
    expect(JSON.stringify(published)).toContain(publicEmail);
    expect(JSON.stringify(published)).not.toContain(privateEmail);
    await page.goto("/food-hotspots?type=offer");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: publicEmail, exact: true }),
    ).toHaveAttribute("href", `mailto:${publicEmail}`);
    await expect(page.getByText(privateEmail, { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`sharing-${testInfo.project.name}.png`),
      fullPage: true,
    });
    expect((await page.request.get("/api/sharing/admin")).status()).toBe(401);
  } finally {
    await moderatorContext.close();
    db.prepare(
      "DELETE FROM records WHERE id IN (SELECT record_id FROM sharing_submissions WHERE contact_email=?)",
    ).run(privateEmail);
    db.prepare("DELETE FROM sharing_submissions WHERE contact_email=?").run(
      privateEmail,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(moderatorId);
    db.prepare("DELETE FROM users WHERE id=?").run(moderatorId);
    closeSharingDatabases();
    closeCommunityDatabases();
  }
});

test("manual public coordinates submit a hotspot and the review link focuses its request", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.REACH_TEST_SHARING !== "true",
    "Requires an explicitly enabled community server and isolated sharing database.",
  );
  test.skip(
    !["mobile", "desktop"].includes(testInfo.project.name),
    "Run the sharing journey at mobile and desktop widths.",
  );
  test.setTimeout(90_000);

  const databasePath = process.env.REACH_SHARING_TEST_DB || "";
  const dbPath = resolve(databasePath);
  expect(databasePath).toBeTruthy();
  expect(dbPath.startsWith(`${resolve(tmpdir())}${sep}`)).toBe(true);
  expect(resolve(process.env.REACH_COMMUNITY_DB || "")).toBe(dbPath);
  const db = openCommunityDatabase(dbPath);
  const moderatorId = randomUUID();
  const rawSession = randomBytes(32).toString("hex");
  const now = new Date();
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,pantry_role) VALUES(?,?, '', '', 'moderator',1,?,'user')",
  ).run(
    moderatorId,
    `sharing_mod_${moderatorId.replaceAll("-", "").slice(0, 16)}`,
    now.toISOString(),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(rawSession),
    moderatorId,
    new Date(+now + 3600000).toISOString(),
  );
  const origin = new URL(baseURL!).origin;
  const moderatorContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize()!,
    isMobile: Boolean(testInfo.project.use.isMobile),
    hasTouch: Boolean(testInfo.project.use.hasTouch),
    timezoneId: "America/Chicago",
  });
  const moderatorPage = await moderatorContext.newPage();
  await moderatorContext.addCookies([
    {
      name: "reach_community_session",
      value: rawSession,
      url: origin,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const suffix = randomUUID().slice(0, 8);
  const title = `Synthetic hotspot fixture ${suffix}`;
  const contactEmail = `hotspot-${suffix}@example.test`;
  try {
    await page.route("**/api/geocode", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          status: "unavailable",
          message:
            "Address search is unavailable. Enter the pickup address and coordinates manually.",
        }),
      }),
    );
    await page.goto("/share");
    const form = page.locator("form.sharing-card");
    await form.getByLabel("Title").fill(title);
    await form
      .getByLabel("Description")
      .fill("Synthetic public pickup fixture; no food is available.");
    const dates = await page.evaluate(() => {
      const local = (offset: number) => {
        const date = new Date(Date.now() + offset);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      };
      return { start: local(3600000), end: local(7200000) };
    });
    await form.getByLabel("Pickup starts").fill(dates.start);
    await form.getByLabel("Pickup ends").fill(dates.end);
    await form
      .getByLabel("Organizer or host name")
      .fill("Synthetic Community Host");
    await form
      .getByLabel("Food type", { exact: true })
      .fill("Canned groceries");
    await form
      .getByLabel("Public pickup address")
      .fill(`Synthetic Public Park ${suffix}`);
    await form
      .getByRole("button", { name: "Search address", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Enter the pickup address and coordinates manually",
    );
    await form
      .getByLabel("Public pickup address")
      .fill(`Synthetic Public Park ${suffix}`);
    const manual = form.locator("details");
    await manual.locator("summary").click();
    await manual.getByLabel("Latitude").fill("30.674");
    await manual.getByLabel("Longitude").fill("-96.376");
    await form
      .getByLabel("Eligibility or who can come")
      .fill("Open to all neighbors.");
    await form
      .getByLabel("Accessibility information")
      .fill("Step-free public entrance.");
    await form
      .getByLabel("Pickup instructions")
      .fill("Meet at the public park entrance.");
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(form.locator('fieldset[data-step="1"]')).toBeVisible();
    await form.getByLabel("Your name").fill("Synthetic Hotspot Submitter");
    await form.getByLabel("Your email (private)").fill(contactEmail);
    await form
      .getByLabel("Contact shown publicly")
      .fill(`public-${contactEmail}`);
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(form.locator('fieldset[data-step="2"]')).toBeVisible();
    for (const label of [
      "I am an adult and have permission to share this food or host this pickup.",
      "I agree that the public contact above can be shown with this approved listing.",
      "I agree to the community food sharing rules and understand Reach reviews submissions before anything is made public.",
    ])
      await form.getByLabel(label).check();
    const submittedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/sharing/submissions" &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Send for review" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Sent for review",
      }),
    ).toBeVisible();
    const submitted = await (await submittedResponse).json();
    const submissionId = submitted.submission.id as string;
    await moderatorPage.goto(
      `/admin?request=${encodeURIComponent(submissionId)}`,
    );
    const card = moderatorPage.locator(`#submission-${submissionId}`);
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/sharing-review-focused/);
    await expect(card).toContainText(title);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`hotspot-sharing-${testInfo.project.name}.png`),
      fullPage: true,
    });
  } finally {
    await moderatorContext.close();
    db.prepare(
      "DELETE FROM records WHERE id IN (SELECT record_id FROM sharing_submissions WHERE contact_email=?)",
    ).run(contactEmail);
    db.prepare("DELETE FROM sharing_submissions WHERE contact_email=?").run(
      contactEmail,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(moderatorId);
    db.prepare("DELETE FROM users WHERE id=?").run(moderatorId);
    closeSharingDatabases();
    closeCommunityDatabases();
  }
});
