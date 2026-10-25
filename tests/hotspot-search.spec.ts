import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { openPantryDatabase } from "../src/lib/pantry-store";

test("approved community hotspot appears in pantry search and can be the AI suggestion", async ({
  page,
}) => {
  const database = process.env.REACH_HOTSPOT_TEST_DB;
  test.skip(
    !database?.startsWith("/tmp/"),
    "Requires isolated /tmp hotspot database shared with server.",
  );
  const db = openPantryDatabase(database);
  const id = randomUUID(),
    owner = randomUUID(),
    pending = randomUUID();
  const now = new Date();
  const data = {
    title: `Synthetic community pickup ${id.slice(0, 8)}`,
    description: "Browser fixture only",
    organizerName: "Fixture organizer",
    address: "Fixture venue, Bryan, TX",
    lat: 30.67,
    lng: -96.37,
    startsAt: new Date(+now - 60000).toISOString(),
    endsAt: new Date(+now + 3600000).toISOString(),
    foodCategory: "Groceries",
    eligibility: "Confirm requirements",
    accessibility: "Unknown",
    contact: "Fixture contact",
    pickupInstructions: "Confirm first",
  };
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?,?,?,'organizer',1,?)",
  ).run(
    owner,
    `fixture_${id.replaceAll("-", "").slice(0, 20)}`,
    "not-a-login-hash",
    "fixture",
    now.toISOString(),
  );
  const insert = db.prepare(
    "INSERT INTO records VALUES(?,'hotspot',?,?, ?,?,?,?,?,NULL)",
  );
  insert.run(
    id,
    owner,
    "approved",
    JSON.stringify(data),
    data.startsAt,
    data.endsAt,
    now.toISOString(),
    now.toISOString(),
  );
  insert.run(
    pending,
    owner,
    "pending",
    JSON.stringify({ ...data, title: "Private pending fixture" }),
    data.startsAt,
    data.endsAt,
    now.toISOString(),
    now.toISOString(),
  );
  try {
    await page.route("**/api/food-search", (route) =>
      route.fulfill({
        json: {
          assistance: "ai",
          intent: { service: "food" },
          rankedAt: new Date().toISOString(),
          ranking: [
            {
              id: `community-hotspot:${id}`,
              reasons: [
                "Organizer-reported distribution; confirm before visiting.",
              ],
            },
          ],
        },
      }),
    );
    await page.goto("/");
    await page
      .getByLabel("What do you need?", { exact: true })
      .fill("food in Bryan");
    await page
      .getByRole("button", { name: "Find best resources", exact: true })
      .click();
    const card = page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article")
      .first();
    await expect(card).toContainText(data.title);
    await expect(card).toContainText(
      "Community food hotspot · confirm details",
    );
    await expect(card).toContainText("AI's first suggestion to check");
    await expect(card).toContainText(
      "organizer reports a pickup window in progress",
    );
    await expect(
      page.getByText("Private pending fixture", { exact: false }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "More pantry details" }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("link", { name: "Community listing details" }),
    ).toHaveAttribute("href", `/food-hotspots#community-item-${id}`);
    const directions = card.getByRole("link", {
      name: /Google Maps directions/,
    });
    const url = new URL((await directions.getAttribute("href"))!);
    expect(url.searchParams.get("destination")).toBe("30.67,-96.37");
    await card
      .getByRole("button", { name: "View on map", exact: true })
      .click();
    await expect(page.locator(".reach-map-view")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    db.prepare("DELETE FROM records WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM users WHERE id=?").run(owner);
  }
});
