import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demoDefaults } from "../src/data/demo";
import type { PlannerInput } from "../src/lib/types";
// Exercise the public request contract independently of the server's GTFS JSON import.
const productionDefaults: PlannerInput = {
  originId: "btd-north-terminal",
  date: "2026-10-22",
  earliestDeparture: "08:00",
  latestReturn: "14:00",
  mode: "bus",
  maxWalkMiles: 1,
  visitMinutes: 30,
  appointmentStatus: "unknown",
  arrivalBufferMinutes: 5,
};

async function example(page: Page) {
  await page.goto("/pantry-planner");
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await expect(
    page.getByText("You’re exploring a fictional example"),
  ).toBeVisible();
  await page.getByText("Visit time & appointment", { exact: true }).click();
  await page
    .getByLabel("Time at the pantry", { exact: true })
    .selectOption("30");
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  await expect(page.locator(".option-card")).toHaveCount(6);
}

test("real listings stay conservative; the fictional example is an explicit choice", async ({
  page,
}, testInfo) => {
  await page.goto("/pantry-planner");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Good food.",
  );
  await expect(page.getByLabel("Where are you starting?")).toBeEnabled();
  await expect(page.locator(".option-card")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /official food directory/ }),
  ).toHaveAttribute("href", "https://www.bvfb.org/find-food");
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-landing.png`),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  const directoryResponse = await page.request.get("/api/pantries?pageSize=100");
  expect(directoryResponse.ok()).toBe(true);
  await expect(page.locator(".option-card")).toHaveCount((await directoryResponse.json()).total);
  await expect(page.locator(".option-card.fits")).toHaveCount(0);
  await expect(page.locator(".option-card")).not.toContainText([
    "Sample Community Pantry",
  ]);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-real-results.png`),
    fullPage: true,
  });
  await page
    .locator(".option-card.confirm")
    .first()
    .getByRole("button", { name: "View trip details" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".timeline")).toHaveCount(0);
  await expect(
    dialog.getByRole("link", { name: "Call provider", exact: true }),
  ).toHaveAttribute("href", /^tel:/);
  await expect(
    dialog.getByRole("link", { name: "View official source" }).first(),
  ).toHaveAttribute("href", /^https:\/\//);
  await expect(dialog).toContainText("Last checked: 2026-10-15");
  await expect(dialog).not.toContainText("FICTIONAL EXAMPLE");
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-real-details.png`),
    fullPage: true,
  });
});

test("three outcomes, details, download, print, saving, and reload work", async ({
  page,
}, testInfo) => {
  await example(page);
  await expect(page.locator(".option-card.fits")).not.toHaveCount(0);
  await expect(page.locator(".option-card.confirm")).not.toHaveCount(0);
  await expect(page.locator(".option-card.no")).not.toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-results.png`),
    fullPage: true,
  });
  const opener = page
    .locator(".option-card.fits")
    .first()
    .getByRole("button", { name: "View trip details" });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("FICTIONAL EXAMPLE · DO NOT USE FOR TRAVEL", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.locator(".timeline .bus")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Save trip", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  // Compare against the configured screen width: mobile Chromium can expand
  // innerWidth to accommodate overflowing dialog actions and hide the defect.
  const savedDialogBounds = (await dialog.boundingBox())!;
  expect(savedDialogBounds.x).toBeGreaterThanOrEqual(0);
  expect(savedDialogBounds.x + savedDialogBounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download card" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^reach-.*\.txt$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  const card = await readFile(path!, "utf8");
  expect(card).toContain("FICTIONAL EXAMPLE — DO NOT USE FOR TRAVEL");
  expect(card).toContain("ITINERARY");
  expect(card).toContain("SOURCES");
  expect(card).toContain("not an appointment reservation");
  await page.emulateMedia({ media: "print" });
  await expect(
    dialog.getByRole("heading", {
      name: "Sample Community Pantry",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-print.png`),
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: /^Saved trips/ }).click();
  await expect(page.locator(".saved-card")).toHaveCount(1);
  await expect(page.locator(".saved-card")).toContainText(
    "Sample Community Pantry",
  );
  await expect(page.locator(".saved-card")).toContainText("FICTIONAL EXAMPLE");
  await page.getByRole("button", { name: "Open trip", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear all saved plans" }).click();
  await expect(page.locator(".saved-card")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /^Saved trips/ }).click();
  await expect(page.locator(".saved-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "A little peace of mind, saved." }),
  ).toBeVisible();
});

test("later departures recompute the trip and invalid time windows show errors", async ({
  page,
}) => {
  await example(page);
  const before = await page.locator(".option-card.fits").first().innerText();
  await page.getByRole("button", { name: "Try a later departure" }).click();
  await expect(
    page.getByText(/Showing options after skipping 1 earlier departure/),
  ).toBeVisible();
  await expect(page.locator(".option-card.fits").first()).not.toHaveText(
    before,
  );
  await page.getByLabel("Leave after", { exact: true }).fill("13:00");
  await page.getByLabel("Home by", { exact: true }).fill("12:00");
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Return time must be after departure" }),
  ).toBeVisible();
});

test("official source links and limitations are visible", async ({
  page,
}, testInfo) => {
  await page.goto("/pantry-planner");
  await page
    .getByRole("button", { name: "Our information", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Good information.",
  );
  const links = page.getByRole("link", { name: /Open official website/ });
  expect(await links.count()).toBeGreaterThan(0);
  for (const link of await links.all())
    expect(await link.getAttribute("href")).toMatch(/^https:\/\//);
  await expect(
    page.getByRole("heading", { name: "Walking & accessibility" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-sources.png`),
    fullPage: true,
  });
});

test("API separates live coverage, demo results, and invalid requests", async ({
  request,
}) => {
  const live = await request.post("/api/plan", {
    data: { demo: false, input: productionDefaults },
  });
  expect(live.status()).toBe(200);
  const liveBody = await live.json();
  expect(liveBody.demo).toBe(false);
  const directory = await request.get("/api/pantries?pageSize=100");
  expect(directory.ok()).toBe(true);
  expect(liveBody.results).toHaveLength((await directory.json()).total);
  expect(
    liveBody.results.every(
      (r: { status: string; segments: unknown[] }) =>
        r.status !== "fits" && !r.segments.length,
    ),
  ).toBe(true);
  const fictionalOriginInLive = await request.post("/api/plan", {
    data: { demo: false, input: demoDefaults },
  });
  expect(fictionalOriginInLive.status()).toBe(400);
  const holiday = await request.post("/api/plan", {
    data: { demo: false, input: { ...productionDefaults, date: "2026-11-26" } },
  });
  const holidayBody = await holiday.json();
  expect(
    holidayBody.results.every((r: { status: string }) => r.status === "no"),
  ).toBe(true);
  const demo = await request.post("/api/plan", {
    data: { demo: true, input: demoDefaults },
  });
  expect(demo.status()).toBe(200);
  const body = await demo.json();
  expect(body.demo).toBe(true);
  expect(body.timezone).toBe("America/Chicago");
  expect(
    new Set(body.results.map((result: { status: string }) => result.status)),
  ).toEqual(new Set(["fits", "confirm", "no"]));
  const invalid = await request.post("/api/plan", {
    data: { demo: true, input: { ...demoDefaults, latestReturn: "07:00" } },
  });
  expect(invalid.status()).toBe(400);
  const malformed = await request.post("/api/plan", {
    data: "not-json",
    headers: { "Content-Type": "application/json" },
  });
  expect(malformed.status()).toBe(400);
});
