import { test, expect } from "@playwright/test";

test("three mathematical options remain usable when AI fails, and expanded sites can be found", async ({
  page,
}) => {
  await page.route("**/api/food-search", (route) =>
    route.fulfill({ status: 503, json: { error: "Fixture AI outage" } }),
  );
  await page.goto("/");
  expect(
    await page
      .getByRole("region", { name: "Places to try", exact: true })
      .getByRole("article")
      .count(),
  ).toBeGreaterThanOrEqual(3);
  const query = page.getByLabel("What do you need?", { exact: true });
  await query.fill("food in Bryan");
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
  await page.getByText("Compare your top 3 options", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your top 3 options" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture AI outage", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/BTD|Brazos Transit District/)).toHaveCount(0);
  await query.fill("food in Smithville");
  await page
    .getByRole("button", { name: "Find best resources", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Smithville Food Pantry", exact: true }),
  ).toBeVisible();
  await page.getByText("Compare your top 1 option", { exact: true }).click();
  await expect(
    page.getByText(/Fewer than three matching listings/),
  ).toBeVisible();
  await expect(
    page.getByText("301 Lee Street, Smithville, TX 78957", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("real local API returns mathematical rankings without a model or credentials", async ({
  request,
}) => {
  const response = await request.post("/api/food-search", {
    headers: {
      origin: new URL(process.env.REACH_TEST_URL || "http://localhost:3000")
        .origin,
    },
    data: {
      message: "food in Bryan",
      useAI: false,
      origin: { lat: 30.65, lng: -96.35 },
      mode: "walking",
    },
  });
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.assistance).toBe("directory");
  expect(data.ranking).toHaveLength(3);
  expect(
    data.ranking.every(
      (item: { selectedBy: string }) => item.selectedBy === "mathematical",
    ),
  ).toBe(true);
  expect(
    data.ranking.some(
      (item: { comparison: { parameters: { distancePoints: number } } }) =>
        item.comparison.parameters.distancePoints > 0,
    ),
  ).toBe(true);
});

test("approved hotspot and extra-food cards remain visible outside the top three", async ({
  page,
}, testInfo) => {
  const path = process.env.REACH_DISCOVERY_TEST_DB;
  test.skip(
    !path || !path.startsWith("/tmp/"),
    "Requires an isolated /tmp database shared with the test server.",
  );
  const { openPantryDatabase } = await import("../src/lib/pantry-store");
  const db = openPantryDatabase(path);
  const id = "browser-" + testInfo.project.name;
  const now = new Date();
  const start = new Date(+now + 6 * 86400000).toISOString();
  const end = new Date(+now + 6 * 86400000 + 3600000).toISOString();
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?, '', '', 'organizer',1,?)",
  ).run(id, id, now.toISOString());
  const hotspot = {
    title: "Fixture visible hotspot " + id,
    description: "Synthetic browser fixture only",
    startsAt: start,
    endsAt: end,
    organizerName: "Fixture",
    address: "Fixture location, Bryan, TX",
    lat: 30.89,
    lng: -96.59,
    foodCategory: "Groceries",
    eligibility: "Unknown",
    accessibility: "Unknown",
    contact: "Fixture",
    pickupInstructions: "Fixture",
  };
  const offer = {
    title: "Fixture visible extra food " + id,
    description: "Synthetic browser fixture only",
    startsAt: start,
    endsAt: end,
    pickupAreaId: "bryan",
    quantity: 1,
    allergens: "Unknown",
    storage: "Dry",
    useBy: new Date(+now + 8 * 86400000).toISOString().slice(0, 10),
    foodCategory: "dry-groceries",
    labelsIntact: true,
    noExcludedProducts: true,
    sealed: true,
    shelfStable: true,
    notHomemade: true,
    packagingUndamaged: true,
    notRecalled: true,
    privatePickupInstructions: "Private fixture",
    pickupIsPublicPlace: true,
    sharePickupInstructions: false,
  };
  const insert = db.prepare(
    "INSERT INTO records VALUES(?,?,?,'approved',?,?,?,?,?,NULL)",
  );
  for (const [kind, data] of [
    ["hotspot", hotspot],
    ["offer", offer],
  ] as const)
    insert.run(
      id + "-" + kind,
      kind,
      id,
      JSON.stringify(data),
      start,
      end,
      now.toISOString(),
      now.toISOString(),
    );
  try {
    await page.route("**/api/food-search", (route) =>
      route.fulfill({ status: 503, json: { error: "Fixture outage" } }),
    );
    await page.goto("/");
    await expect(
      page.getByText("Community food hotspot · confirm details").first(),
    ).toBeVisible();
    await expect(
      page.getByText("Household food share · moderator approved").first(),
    ).toBeVisible();
    // Other already approved offers may rank ahead of this fixture. All remain discoverable.
    await page.getByRole("button", { name: /Show .* more places/ }).click();
    await expect(
      page.getByRole("heading", { name: offer.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Private fixture", { exact: true }),
    ).toHaveCount(0);
  } finally {
    db.prepare("DELETE FROM records WHERE owner_id=?").run(id);
    db.prepare("DELETE FROM users WHERE id=?").run(id);
  }
});
