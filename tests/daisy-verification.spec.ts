import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const routes = [
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
const widths: Record<string, number[]> = {
  mobile: [320, 375, 390],
  android: [1024],
  tablet: [768],
  desktop: [1440],
};

// Real local page/API content and MapLibre renderer; only remote cartography
// is replaced. Neutral map pixels do not establish real-provider availability.
test.beforeEach(async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({
          json: {
            version: 8,
            sources: {},
            layers: [
              {
                id: "qa-background",
                type: "background",
                paint: { "background-color": "#dce6df" },
              },
            ],
          },
        })
      : route.abort("blockedbyclient"),
  );
});

async function settled(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main h1")).not.toContainText(/Loading/i);
  for (const message of [
    "Loading your account…",
    "Loading pickups…",
    "Loading community food…",
  ])
    await expect(page.getByText(message, { exact: true })).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
}

async function fits(page: Page) {
  expect(
    await page.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    ),
  ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  for (const dialog of await page.getByRole("dialog").all()) {
    if (!(await dialog.isVisible())) continue;
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
  }
}

async function accessible(page: Page) {
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect
    .soft(
      report.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      `WCAG findings on ${page.url()}`,
    )
    .toEqual([]);
}

async function target(control: Locator) {
  const box = (await control.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(43.5);
  expect(box.height).toBeGreaterThanOrEqual(43.5);
}

/** Measure rendered sRGB colors, including transparent ancestor backgrounds. */
async function renderedContrast(control: Locator, part: "text" | "border") {
  return control.evaluate((node, part) => {
    type Rgba = [number, number, number, number];
    const style = getComputedStyle(node);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (css: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).map(
        (v) => v / 255,
      ) as Rgba;
    };
    const over = (front: Rgba, back: Rgba): Rgba => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (!alpha) return [0, 0, 0, 0];
      return [0, 1, 2]
        .map(
          (i) =>
            (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha,
        )
        .concat(alpha) as Rgba;
    };
    const backgroundAt = (start: Element | null): Rgba => {
      let color: Rgba = [0, 0, 0, 0];
      for (let current = start; current; current = current.parentElement) {
        color = over(color, rgba(getComputedStyle(current).backgroundColor));
        if (color[3] === 1) return color;
      }
      throw new Error("No opaque background found for contrast measurement.");
    };
    const luminance = (color: Rgba) =>
      color
        .slice(0, 3)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const inside = backgroundAt(node),
      adjacent = backgroundAt(node.parentElement);
    const background = part === "text" ? inside : adjacent;
    const foregroundCss = part === "text" ? style.color : style.borderTopColor;
    const foreground = over(rgba(foregroundCss), background);
    const frontLuminance = luminance(foreground),
      backLuminance = luminance(background);
    return {
      foregroundCss,
      componentBackgroundCss: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      componentBackgroundRgb: inside
        .slice(0, 3)
        .map((v) => Math.round(v * 255)),
      adjacentBackgroundRgb: adjacent
        .slice(0, 3)
        .map((v) => Math.round(v * 255)),
      componentLuminance: luminance(inside),
      textDecorationLine: style.textDecorationLine,
      textDecorationThickness: style.textDecorationThickness,
      ratio:
        (Math.max(frontLuminance, backLuminance) + 0.05) /
        (Math.min(frontLuminance, backLuminance) + 0.05),
    };
  }, part);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`daisy public pages: ${colorScheme} theme, six-width evidence and WCAG 2.2 AA`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(
      (theme) => {
        localStorage.setItem("reach-theme", theme);
      },
      colorScheme === "dark" ? "reach-dark" : "reach",
    );
    for (const width of widths[info.project.name] ?? [390]) {
      await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
      for (const route of routes) {
        const response = await page.goto(route);
        expect(response?.status()).toBe(200);
        await settled(page);
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          colorScheme === "dark" ? "reach-dark" : "reach",
        );
        await fits(page);
        if (route === "/pantries/bridge-ministries") {
          // Axe skipped the original same-color phone text as invisible.
          // Check this essential contact action independently of its heuristic.
          const contrast = await renderedContrast(
            page.locator('a[href^="tel:"]'),
            "text",
          );
          expect
            .soft(
              contrast.ratio,
              "Pantry phone action must retain readable text",
            )
            .toBeGreaterThanOrEqual(4.5);
        }
        const supportingDock = page.locator(".site-mobile-navigation");
        if (await supportingDock.count()) {
          if (width >= 1024) await expect(supportingDock).toBeHidden();
          else if (width <= 390) await expect(supportingDock).toBeVisible();
        }
        if (width === 390 || width === 1440) await accessible(page);
        await page.screenshot({
          path: info.outputPath(
            `${colorScheme}-${width}-${route.replaceAll("/", "-") || "home"}.png`,
          ),
          fullPage: true,
        });
      }
    }
    expect(errors).toEqual([]);
  });
}

test("daisy dark navigation and dialogs work with keyboard, save, download and print", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/account");
  await settled(page);
  const menu = page.locator("summary[aria-label='More navigation']");
  await target(menu);
  await menu.focus();
  await page.keyboard.press("Enter");
  const destinations = page.getByRole("navigation", {
    name: "More pages",
    exact: true,
  });
  await expect(destinations).toBeVisible();
  const planner = destinations.getByRole("link", {
    name: "Detailed trip planner",
  });
  await target(planner);
  await planner.focus();
  await page.keyboard.press("Escape");
  await expect(destinations).toBeHidden();
  await expect(menu).toBeFocused();
  await page.keyboard.press("Enter");
  await planner.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pantry-planner$/);
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await expect(
    page.getByText("You’re exploring a fictional example", { exact: true }),
  ).toBeVisible();
  await page.getByText("Visit time & appointment", { exact: true }).click();
  await page
    .getByLabel("Time at the pantry", { exact: true })
    .selectOption("30");
  await page
    .getByRole("button", { name: "Find my options", exact: true })
    .click();
  await expect(page.locator(".option-card")).toHaveCount(6);
  const opener = page
    .locator(".option-card.fits")
    .first()
    .getByRole("button", { name: "View trip details" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await fits(page);
  await accessible(page);
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Save trip", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Saved on this device" }),
  ).toBeVisible();
  const pendingDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download card" }).click();
  const download = await pendingDownload;
  expect(await readFile((await download.path())!, "utf8")).toContain(
    "FICTIONAL EXAMPLE — DO NOT USE FOR TRAVEL",
  );
  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.qaPrintRequested = "true";
    };
  });
  await dialog
    .getByRole("button", { name: "Print trip card", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-qa-print-requested",
    "true",
  );
  await page.emulateMedia({ media: "print" });
  await expect(
    dialog.getByRole("heading", {
      name: "Sample Community Pantry",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("dark-dialog-print.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: /^Saved trips/ }).click();
  await expect(page.locator(".saved-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear all saved plans" }).click();
  await expect(page.locator(".saved-card")).toHaveCount(0);
});

test("daisy theme defaults dark and explicit choices persist across routes and reloads", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("reach-theme")),
  ).toBeNull();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  const light = page.getByRole("button", {
    name: "Switch to light mode",
    exact: true,
  });
  await target(light);
  await light.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
  await expect(
    page.getByRole("button", { name: "Switch to dark mode", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("reach-theme"))).toBe(
    "reach",
  );
  await page.goto("/account");
  await settled(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
  await page
    .getByRole("button", { name: "Switch to dark mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  expect(await page.evaluate(() => localStorage.getItem("reach-theme"))).toBe(
    "reach-dark",
  );
});

test("daisy initial theme is applied without hydration scripts", async ({
  page,
}) => {
  // Blocking downloaded application JS makes this a bootstrap check rather
  // than accidentally accepting a theme corrected after React hydration.
  await page.route("**/_next/static/**/*.js", (route) =>
    route.abort("blockedbyclient"),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/privacy");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  await page.evaluate(() => localStorage.setItem("reach-theme", "reach"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toContain("light");
});

test("daisy theme remains usable when browser storage is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"] as const)
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() {
          throw new DOMException("Synthetic storage denial", "SecurityError");
        },
      });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/privacy");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "reach-dark",
  );
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "reach");
});

test("daisy enabled form controls retain 3:1 non-text contrast in both themes", async ({
  page,
}, info) => {
  const measurements: Array<Record<string, unknown>> = [];
  try {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const check = async (name: string, control: Locator) => {
        await expect(control).toBeVisible();
        await expect(control).toBeEnabled();
        const measurement = await renderedContrast(control, "border");
        measurements.push({
          name,
          colorScheme,
          url: page.url(),
          ...measurement,
        });
        expect
          .soft(
            parseFloat(measurement.borderWidth),
            `${name} needs a visible border`,
          )
          .toBeGreaterThan(0);
        expect
          .soft(
            measurement.ratio,
            `${name} ${colorScheme}: ${JSON.stringify(measurement)}`,
          )
          .toBeGreaterThanOrEqual(3);
      };
      await page.goto("/account");
      await check(
        "Account email",
        page.getByLabel("Email address", { exact: true }),
      );
      await page.goto("/");
      await check("Hero address", page.getByLabel("Address", { exact: true }));
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const boundary = page.getByRole("checkbox", {
        name: "Show TX-10 boundary",
        exact: true,
      });
      await expect(boundary).not.toBeChecked();
      await expect(boundary).toHaveClass(/checkbox/);
      await check("Unchecked map boundary checkbox", boundary);
      await page.goto("/pantry-planner");
      await check(
        "Planner starting stop",
        page.getByLabel("Where are you starting?", { exact: true }),
      );
    }
  } finally {
    await mkdir(info.outputDir, { recursive: true });
    await writeFile(
      info.outputPath("control-contrast.json"),
      JSON.stringify(measurements, null, 2),
    );
  }
});

test("daisy selected controls stay visibly distinct after changing each view", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const measurements: Array<Record<string, unknown>> = [];
  // Availability and management permissions are explicit read-only UI fixtures.
  // No signup, email, authenticated mutation or database change is performed.
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
  try {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "no-preference" });
      const check = async (
        name: string,
        active: Locator,
        inactive: Locator,
      ) => {
        await expect(active).toBeVisible();
        await expect(inactive).toBeVisible();
        const selected = await renderedContrast(active, "text");
        const other = await renderedContrast(inactive, "text");
        const stateContrast =
          (Math.max(selected.componentLuminance, other.componentLuminance) +
            0.05) /
          (Math.min(selected.componentLuminance, other.componentLuminance) +
            0.05);
        measurements.push({
          name,
          colorScheme,
          active: await active.innerText(),
          selected,
          other,
          stateContrast,
        });
        expect
          .soft(selected.ratio, `${name}: selected text contrast`)
          .toBeGreaterThanOrEqual(4.5);
        expect
          .soft(other.ratio, `${name}: unselected text contrast after switch`)
          .toBeGreaterThanOrEqual(4.5);
        expect
          .soft(stateContrast, `${name}: selected/unselected fill contrast`)
          .toBeGreaterThanOrEqual(3);
        expect
          .soft(
            selected.textDecorationLine,
            `${name}: non-color selection indicator`,
          )
          .toContain("underline");
        expect
          .soft(
            parseFloat(selected.textDecorationThickness),
            `${name}: visible underline`,
          )
          .toBeGreaterThanOrEqual(2);
        expect
          .soft(
            other.textDecorationLine,
            `${name}: indicator follows selection`,
          )
          .not.toContain("underline");
      };
      await page.goto("/account");
      const account = page.locator(".account-tabs");
      const create = account.getByRole("button", {
        name: "Create account",
        exact: true,
      });
      await expect(create).toBeEnabled();
      await create.click();
      await expect(create).toHaveAttribute("aria-pressed", "true");
      await check(
        "Account mode",
        create,
        account.getByRole("button", { name: "Sign in", exact: true }),
      );

      await page.goto("/food-hotspots");
      const community = page.getByRole("navigation", {
        name: "Community views",
        exact: true,
      });
      const signIn = community.getByRole("button", {
        name: "Sign in",
        exact: true,
      });
      await signIn.click();
      await expect(signIn).toHaveAttribute("aria-current", "page");
      await check(
        "Community view",
        signIn,
        community.getByRole("button", { name: "Find food", exact: true }),
      );

      await page.goto("/pantry-planner");
      const modes = page.locator(".mode-options");
      const walk = modes.getByRole("button", {
        name: "Walk only",
        exact: true,
      });
      await walk.click();
      await expect(walk).toHaveAttribute("aria-pressed", "true");
      await check(
        "Planner travel mode",
        walk,
        modes.getByRole("button", { name: "Bus + walk", exact: true }),
      );
      const plannerNav = page.getByRole("navigation", {
        name: "Trip planner navigation",
        exact: true,
      });
      await plannerNav.getByRole("button", { name: /^Saved trips/ }).click();
      await check(
        "Planner navigation",
        page.locator(".nav-item.active"),
        plannerNav.getByRole("button", { name: "Plan a visit", exact: true }),
      );
      await plannerNav
        .getByRole("button", { name: "Plan a visit", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Try an example", exact: true })
        .click();
      await expect(
        page.getByText("You’re exploring a fictional example", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Find my options", exact: true })
        .click();
      await expect(page.locator(".option-card")).toHaveCount(6);
      const filters = page.getByRole("group", {
        name: "Filter options",
        exact: true,
      });
      const fits = filters.getByRole("button", { name: /^Fits/ });
      await fits.click();
      await expect(fits).toHaveAttribute("aria-pressed", "true");
      await check(
        "Planner result filter",
        fits,
        filters.getByRole("button", { name: /^All options/ }),
      );
      await accessible(page); // Includes selected filter-count text in both themes.

      await page.goto("/pantries/bridge-ministries");
      const weekdays = page.locator(".busy-days");
      const nextDay = weekdays.locator("button[aria-pressed='false']").first();
      await nextDay.click();
      await check(
        "Busy-time weekday",
        weekdays.locator("button[aria-pressed='true']"),
        weekdays.locator("button[aria-pressed='false']").first(),
      );

      await page.goto("/");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const picker = page.getByRole("region", {
        name: "Choose a starting location",
        exact: true,
      });
      await picker
        .getByText("Advanced: enter coordinates", { exact: true })
        .click();
      await picker.getByLabel("Latitude", { exact: true }).fill("30.6501234");
      await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
      await picker
        .getByRole("button", { name: "Use these coordinates", exact: true })
        .click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page
        .getByLabel("Where would you like to go?", { exact: true })
        .selectOption("bridge-ministries");
      await page
        .getByRole("button", { name: "Show my options", exact: true })
        .click();
      await page
        .locator(".reach-directions")
        .getByRole("button", { name: "Get directions", exact: true })
        .click();
      const browse = page.getByRole("button", {
        name: "Browse places",
        exact: true,
      });
      await browse.click();
      await expect(browse).toHaveAttribute("aria-pressed", "true");
      await check(
        "Map resources/directions",
        browse,
        page.getByRole("button", { name: "Directions", exact: true }),
      );

      const detailResponse = await page.request.get(
        "/api/pantries/bridge-ministries",
      );
      expect(detailResponse.ok()).toBe(true);
      const detail = await detailResponse.json();
      await page.route("**/api/account/me", (route) =>
        route.fulfill({
          json: {
            user: {
              id: "state-review-administrator",
              email: "state-review@example.test",
              name: "State review fixture",
              emailVerified: true,
              role: "administrator",
            },
          },
        }),
      );
      const writes: string[] = [];
      await page.route("**/api/pantries/**", (route) => {
        const request = route.request(),
          path = new URL(request.url()).pathname;
        if (request.method() !== "GET") {
          writes.push(path);
          return route.fulfill({
            status: 500,
            json: { error: "Read-only state review fixture." },
          });
        }
        if (path.endsWith("/management"))
          return route.fulfill({
            json: { pantries: [detail.pantry], total: 1, page: 1 },
          });
        if (path.endsWith("/bridge-ministries"))
          return route.fulfill({
            json: { ...detail, permissions: { canEdit: true, isAdmin: true } },
          });
        return route.fulfill({
          json: {
            corrections: [],
            audit: [],
            assignments: [],
            total: 0,
            page: 1,
          },
        });
      });
      await page.goto("/manage");
      const management = page.getByRole("navigation", {
        name: "Management sections",
        exact: true,
      });
      const audit = management.getByRole("button", {
        name: "Audit log",
        exact: true,
      });
      await audit.click();
      await expect(audit).toHaveAttribute("aria-pressed", "true");
      await check(
        "Management section",
        audit,
        management.getByRole("button", {
          name: "Pantry directory",
          exact: true,
        }),
      );
      await management
        .getByRole("button", { name: "Pantry directory", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: `Manage ${detail.pantry.name}`,
          exact: true,
        })
        .click();
      const editing = page.getByRole("navigation", {
        name: "Pantry editing sections",
        exact: true,
      });
      const hours = editing.getByRole("button", {
        name: "Hours & closures",
        exact: true,
      });
      await hours.click();
      await expect(hours).toHaveAttribute("aria-pressed", "true");
      await check(
        "Pantry editing section",
        hours,
        editing.getByRole("button", { name: "Information", exact: true }),
      );
      expect(writes).toEqual([]);
      await page.unroute("**/api/pantries/**");
      await page.unroute("**/api/account/me");
      await page.route("**/api/account/me", (route) =>
        route.fulfill({ json: { user: null } }),
      );
    }
  } finally {
    await mkdir(info.outputDir, { recursive: true });
    await writeFile(
      info.outputPath("selected-states.json"),
      JSON.stringify(measurements, null, 2),
    );
  }
});
