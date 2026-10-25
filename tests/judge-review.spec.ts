import { test, expect } from "@playwright/test";

for (const ids of [
  ["retired-listing"],
  ["brazos-church-pantry", "brazos-church-pantry"],
]) {
  test(`keeps three directory choices when AI returns stale or duplicate IDs: ${ids.join(",")}`, async ({
    page,
  }) => {
    await page.route("**/api/food-search", (route) =>
      route.fulfill({
        json: {
          assistance: "ai",
          intent: { service: "food" },
          rankedAt: new Date().toISOString(),
          ranking: ids.map((id) => ({
            id,
            reasons: ["Fixture recommendation"],
            selectedBy: "ai",
          })),
          summary: [
            {
              id: "retired-listing",
              name: "Retired fixture",
              text: "Outdated fixture summary",
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
    await expect(
      page.getByRole("button", { name: "Find best resources", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText("Compare your top 3 options", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Places to try", exact: true })
        .getByRole("article"),
    ).toHaveCount(3);
    await expect(page.getByText("Outdated fixture summary")).toHaveCount(0);
  });
}
test("does not imply a distance-based recommendation without a starting point", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Directory suggestion", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Distance-and-pickup match", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Add your starting point to compare distance/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("directory-only search refreshes a newly approved hotspot", async ({
  page,
}, testInfo) => {
  const path = process.env.REACH_DISCOVERY_TEST_DB;
  test.skip(!path?.startsWith("/tmp/"), "Requires an isolated database");
  const { openCommunityDatabase } = await import("../src/lib/community");
  const { randomUUID } = await import("node:crypto");
  const db = openCommunityDatabase(path);
  const id = randomUUID();
  const title = `Judge refresh pickup ${testInfo.project.name} ${id}`;
  const start = new Date(Date.now() + 3600000).toISOString(),
    end = new Date(Date.now() + 7200000).toISOString();
  await page.goto("/");
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?, '', '', 'organizer',1,?)",
  ).run(id, id, new Date().toISOString());
  try {
    db.prepare(
      "INSERT INTO records VALUES(?,?,?,'approved',?,?,?,?,?,NULL)",
    ).run(
      id,
      "hotspot",
      id,
      JSON.stringify({
        title,
        description: "Synthetic test only",
        startsAt: start,
        endsAt: end,
        organizerName: "Fixture",
        address: "Fixture, Bryan, TX",
        lat: 30.65,
        lng: -96.35,
        foodCategory: "Groceries",
        eligibility: "Unknown",
        accessibility: "Unknown",
        contact: "Fixture",
        pickupInstructions: "Fixture",
      }),
      start,
      end,
      start,
      start,
    );
    await page.getByRole("checkbox", { name: /Use AI/ }).uncheck();
    await page.getByLabel("What do you need?", { exact: true }).fill(title);
    await page
      .getByRole("button", { name: "Find best resources", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  } finally {
    db.prepare("DELETE FROM records WHERE owner_id=?").run(id);
    db.prepare("DELETE FROM users WHERE id=?").run(id);
  }
});
