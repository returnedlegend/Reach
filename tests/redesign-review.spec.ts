import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const publicRoutes = [
  "/",
  "/account",
  "/volunteer",
  "/food-hotspots",
  "/pantry-planner",
  "/manage",
  "/privacy",
  "/terms",
  "/pantries/bridge-ministries",
] as const;

// Only cartography is controlled for the public-route audit. Pantry content,
// account availability and other service responses come from the local app.
async function controlledCartography(page: Page) {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "review-background",
                type: "background",
                paint: { "background-color": "#e9eee8" },
              },
            ],
          },
        })
      : route.abort("blockedbyclient"),
  );
}

async function noHorizontalOverflow(page: Page) {
  const configuredWidth = page.viewportSize()?.width;
  expect(configuredWidth).toBeDefined();
  expect(
    await page.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    ),
    "Document content must fit the configured physical viewport; innerWidth can inflate on mobile.",
  ).toBeLessThanOrEqual(configuredWidth! + 1);
}

async function settledPublicContent(page: Page) {
  // SSR includes loading headings on several routes. Verify the useful page,
  // rather than accidentally approving its temporary skeleton.
  await expect(page.locator("main h1")).not.toContainText(/Loading/i);
  for (const message of [
    "Loading your account…",
    "Loading pickups…",
    "Loading community food…",
  ]) {
    await expect(page.getByText(message, { exact: true })).toBeHidden();
  }
}

async function generousTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(43.5);
  expect(bounds?.width).toBeGreaterThanOrEqual(43.5);
}

test.beforeEach(async ({ page }) => controlledCartography(page));

for (const route of publicRoutes) {
  test(`public route ${route} fits its viewport and has accessible content`, async ({
    page,
  }, info) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settledPublicContent(page);
    await expect(
      page.locator("nextjs-portal").filter({ hasText: "Build Error" }),
    ).toHaveCount(0);
    await noHorizontalOverflow(page);

    if (info.project.name === "mobile") {
      const report = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        report.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((node) => node.target),
        })),
      ).toEqual([]);
    }
    await page.screenshot({
      path: info.outputPath("route.png"),
      fullPage: true,
    });
  });
}

test("all public routes remain usable on a 320px phone", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "One dedicated small-phone pass.");
  test.setTimeout(120_000); // Nine complete navigations, hydration and captures.
  await page.setViewportSize({ width: 320, height: 740 });
  for (const route of publicRoutes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settledPublicContent(page);
    await noHorizontalOverflow(page);
    await page.screenshot({
      path: info.outputPath(`${route.replaceAll("/", "-") || "home"}-320.png`),
      fullPage: true,
    });
  }
});

test("account forms fit small screens and keep native labels and validation", async ({
  page,
}) => {
  // Synthetic availability fixture, isolated to this test. No real account,
  // credentials, authentication POST, mail preview or delivery is involved.
  await page.route("**/api/account/status", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        emailConfigured: true,
        deliveryMode: "disabled",
      },
    }),
  );
  await page.route("**/api/account/me", (route) =>
    route.fulfill({ json: { user: null } }),
  );
  const writes: string[] = [];
  await page.route("**/api/account/signup", (route) => {
    writes.push(route.request().method());
    return route.fulfill({
      status: 500,
      json: { error: "Review fixture: no account created." },
    });
  });
  await page.goto("/account");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const email = page.getByLabel("Email address", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  await expect(page.getByLabel("Display name", { exact: true })).toBeVisible();
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await expect(password).toHaveAttribute("minlength", "12");
  await generousTarget(email);
  await generousTarget(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .last()
    .click();
  expect(writes).toEqual([]);
  await noHorizontalOverflow(page);
  await page
    .getByRole("button", { name: "Forgot password", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recover your account" }),
  ).toBeVisible();
  await expect(password).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test("bottom navigation works with keyboard and preserves selected state", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", {
    name: "Main navigation",
    exact: true,
  });
  for (const name of ["Map", "Saved", "Explore"]) {
    const button = nav.getByRole("button", { name, exact: true });
    await generousTarget(button);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("secondary page menu opens with keyboard and Escape restores focus", async ({
  page,
}) => {
  await page.goto("/account");
  const menu = page.locator("summary[aria-label='More navigation']");
  const destinations = page.getByRole("navigation", {
    name: "More pages",
    exact: true,
  });
  await generousTarget(menu);
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(destinations).toBeVisible();
  const planner = destinations.getByRole("link", {
    name: "Detailed trip planner",
  });
  await generousTarget(planner);
  await planner.focus();
  await page.keyboard.press("Escape");
  await expect(destinations).not.toBeVisible();
  await expect(menu).toBeFocused();
  const current = page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Account", exact: true })
    .filter({ visible: true });
  await expect(current).toHaveAttribute("aria-current", "page");
  await generousTarget(current);
});

test("map resource sheet supports keyboard and real touch swipes", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Map", exact: true })
    .click();
  const sheet = page.getByRole("region", {
    name: "Map resource list",
    exact: true,
  });
  const handle = sheet.getByRole("button", {
    name: /Hide resources|Show resources/,
  });
  const content = page.locator("#map-resource-sheet-content");
  await generousTarget(handle);
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await handle.focus();
  await page.keyboard.press("Enter");
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  await expect(content).toBeHidden();
  await expect(handle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  await expect(content).toBeVisible();

  if (page.viewportSize()!.width <= 650) {
    const actions = sheet.locator(".reach-actions").first();
    expect(
      await actions.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(/\s+/).length,
      ),
    ).toBe(2);
    const directions = actions.getByRole("button", {
      name: /^Get directions to /,
    });
    await generousTarget(directions);
    expect(
      await directions.evaluate((element) => {
        const text = [...element.childNodes].find(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            node.textContent?.includes("Get directions"),
        )!;
        const start = text.textContent!.indexOf("Get directions");
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + "Get directions".length);
        const rects = [...range.getClientRects()];
        const bounds = element.getBoundingClientRect();
        return (
          rects.length === 1 &&
          rects[0].left >= bounds.left &&
          rects[0].right <= bounds.right &&
          element.scrollWidth <= element.clientWidth
        );
      }),
    ).toBe(true);
  }

  if (info.project.name !== "desktop") {
    // CDP sends actual trusted touch input. Synthetic pointer events alone
    // would not exercise pointer capture, touch-action or click suppression.
    const session = await page.context().newCDPSession(page);
    const swipe = async (distance: number) => {
      await handle.evaluate((element) =>
        element.scrollIntoView({ block: "center" }),
      );
      const bounds = (await handle.boundingBox())!;
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y + distance * fraction }],
        });
      }
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    };
    await swipe(70);
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    await expect(content).toBeHidden();
    await swipe(-70);
    await expect(handle).toHaveAttribute("aria-expanded", "true");
    await expect(content).toBeVisible();
    await session.detach();
  }
  await noHorizontalOverflow(page);
});

test("food journey keeps its location and selected transport through results", async ({
  page,
}) => {
  await page.route("**/api/journey", (route) =>
    route.fulfill({
      json: {
        status: "unavailable",
        message: "Controlled review: directions are unavailable.",
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Food", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const picker = page.getByRole("region", {
    name: "Choose a starting location",
  });
  await picker.getByLabel("Address", { exact: true }).fill("Bridge");
  const local = picker
    .getByRole("group", { name: "Local places" })
    .getByRole("button", { name: /The Bridge Ministries/ });
  await local.focus();
  await page.keyboard.press("Enter");
  await expect(picker).toContainText("Local place selected");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Where would you like to go?", { exact: true })
    .selectOption("bridge-ministries");
  await page
    .getByLabel("How will you travel?", { exact: true })
    .selectOption("driving");
  await page
    .getByRole("button", { name: "Show my options", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your options", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Food assistance options" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("How will you travel?", { exact: true }),
  ).toHaveValue("driving");
  await noHorizontalOverflow(page);
});

test("reduced motion removes decorative animation and animated scrolling", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["/", "/account", "/volunteer"]) {
    await page.goto(route);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    ).toBe("auto");
    const activeAnimations = await page.locator("body").evaluate((body) =>
      [...body.querySelectorAll("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.animationName !== "none" &&
            style.animationDuration
              .split(",")
              .some((duration) => parseFloat(duration) > 0.001)
          );
        })
        .map((element) => element.tagName + "." + element.className),
    );
    expect(activeAnimations).toEqual([]);
  }
});
