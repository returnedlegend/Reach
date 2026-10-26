import { accountHash } from "../src/lib/account-store";
import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { openPantryDatabase } from "../src/lib/pantry-store";

test("AI can suggest an approved household offer without exposing or routing to its private pickup", async ({
  page,
}) => {
  const path = process.env.REACH_HOTSPOT_TEST_DB;
  test.skip(
    !path?.startsWith("/tmp/"),
    "Requires isolated shared test database.",
  );
  const db = openPantryDatabase(path),
    id = randomUUID(),
    owner = randomUUID(),
    pending = randomUUID(),
    now = new Date();
  let viewer: string | undefined;
  const secret = "PRIVATE PICKUP SENTINEL: arranged after acceptance";
  const data = {
    title: `Synthetic sealed groceries ${id.slice(0, 8)}`,
    description: "Synthetic browser fixture only",
    pickupAreaId: "bryan",
    startsAt: new Date(+now - 60000).toISOString(),
    endsAt: new Date(+now + 3600000).toISOString(),
    quantity: 2,
    allergens: "Wheat",
    storage: "Keep dry",
    useBy: new Date(+now + 86400000).toISOString().slice(0, 10),
    foodCategory: "dry-groceries",
    labelsIntact: true,
    noExcludedProducts: true,
    sealed: true,
    shelfStable: true,
    notHomemade: true,
    packagingUndamaged: true,
    notRecalled: true,
    privatePickupInstructions: secret,
    pickupIsPublicPlace: true,
    sharePickupInstructions: true,
  };
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?,?,?,'resident',1,?)",
  ).run(
    owner,
    `test_${id.replaceAll("-", "").slice(0, 20)}`,
    "not-a-login-hash",
    "fixture",
    now.toISOString(),
  );
  const insert = db.prepare(
    "INSERT INTO records VALUES(?,'offer',?,?, ?,?,?,?,?,NULL)",
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
    JSON.stringify({ ...data, title: "Hidden pending household fixture" }),
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
              id: `community-offer:${id}`,
              reasons: [
                "Donor reports sealed groceries; arrange pickup first.",
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
      "Household food share · moderator approved",
    );
    await expect(card).toContainText("Safety and availability aren’t verified");
    await expect(card).toContainText("AI's first suggestion to check");
    await expect(card.getByRole("link", { name: /Google Maps/ })).toHaveCount(
      0,
    );
    await expect(card.getByRole("button", { name: "View on map" })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Hidden pending household fixture", { exact: false }),
    ).toHaveCount(0);
    expect(await page.content()).not.toContain(secret);
    await card
      .getByText("Pickup times & what to bring", { exact: true })
      .click();
    await expect(card).toContainText("Allergens: Wheat");
    await expect(card).toContainText("Storage: Keep dry");
    await card
      .getByText("Pickup times & what to bring", { exact: true })
      .click();
    await page.screenshot({
      path: `/tmp/reach-household-${test.info().project.name}.png`,
      fullPage: true,
    });
    await card.getByRole("link", { name: "Request food", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Post type", exact: true }),
    ).toHaveValue("offer");
    await expect(page.locator(`#community-item-${id}`)).toBeVisible();
    expect(await page.content()).not.toContain(secret);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    // Existing-user fixture: public signup is intentionally closed.
    viewer = randomUUID();
    const token = randomBytes(32).toString("hex");
    db.prepare(
      "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?,?,?,'resident',1,?)",
    ).run(
      viewer,
      `viewer_${viewer.replaceAll("-", "").slice(0, 20)}`,
      "not-a-login-hash",
      "fixture",
      now.toISOString(),
    );
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      accountHash(token),
      viewer,
      new Date(Date.now() + 3600000).toISOString(),
    );
    await page
      .context()
      .addCookies([
        {
          name: "reach_community_session",
          value: token,
          url: new URL(page.url()).origin,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
    await page.reload();
    const listing = page.locator(`#community-item-${id}`);
    await listing.getByText("Report or block", { exact: true }).click();
    await listing.getByRole("button", { name: /Block/ }).click();
    await expect(listing).toHaveCount(0);
    await page.getByRole("button", { name: "Explore", exact: true }).click();
    await page
      .getByRole("checkbox", { name: /Compare with AI/ })
      .uncheck();
    await page
      .getByLabel("What do you need?", { exact: true })
      .fill(data.title);
    await page
      .getByRole("button", { name: "Find best resources", exact: true })
      .click();
    await expect(
      page.getByRole("article", { name: data.title, exact: true }),
    ).toHaveCount(0);
  } finally {
    if (viewer) {
      db.prepare("DELETE FROM blocks WHERE user_id=? OR blocked_id=?").run(
        viewer,
        viewer,
      );
      db.prepare("DELETE FROM audit WHERE actor_id=?").run(viewer);
      db.prepare("DELETE FROM users WHERE id=?").run(viewer);
    }
    db.prepare("DELETE FROM records WHERE owner_id=?").run(owner);
    db.prepare("DELETE FROM users WHERE id=?").run(owner);
  }
});
