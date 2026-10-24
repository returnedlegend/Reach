import { expect, test, type Page } from "@playwright/test";

async function openPicker(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Food\b/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Advanced: enter coordinates", { exact: true }).click();
  return page.getByRole("region", { name: "Choose a starting location" });
}

test("location follow opts in, uses high accuracy watch, updates, and clears on stop", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      watchCalls: PositionOptions[];
      clearCalls: number[];
      success?: PositionCallback;
    };
    state.watchCalls = [];
    state.clearCalls = [];
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(
          success: PositionCallback,
          _error: PositionErrorCallback,
          options: PositionOptions,
        ) {
          state.watchCalls.push(options);
          state.success = success;
          return 42;
        },
        clearWatch(id: number) {
          state.clearCalls.push(id);
        },
      },
    });
  });
  const picker = await openPicker(page);
  expect(
    await page.evaluate(
      () => (window as typeof window & { watchCalls: unknown[] }).watchCalls,
    ),
  ).toEqual([]);
  await picker.getByRole("button", { name: "Follow my location" }).click();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { watchCalls: PositionOptions[] })
          .watchCalls,
    ),
  ).toEqual([{ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }]);
  await page.evaluate(() =>
    (window as typeof window & { success: PositionCallback }).success({
      timestamp: Date.now(),
      coords: {
        latitude: 30.65,
        longitude: -96.35,
        accuracy: 18,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition),
  );
  await expect(picker).toContainText("estimated accuracy ±18 m");
  await expect(picker).toContainText("not a guaranteed boundary");
  await page.evaluate(() =>
    (window as typeof window & { success: PositionCallback }).success({
      timestamp: Date.now(),
      coords: {
        latitude: 30.651,
        longitude: -96.351,
        accuracy: 9,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition),
  );
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.651",
  );
  await picker.getByRole("button", { name: "Stop following" }).click();
  expect(
    await page.evaluate(
      () => (window as typeof window & { clearCalls: number[] }).clearCalls,
    ),
  ).toEqual([42]);
  await page.evaluate(() =>
    (window as typeof window & { success: PositionCallback }).success({
      timestamp: Date.now(),
      coords: {
        latitude: 30.7,
        longitude: -96.4,
        accuracy: 2,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition),
  );
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.651",
  );
});

test("follow stops on a manual selection and stale watch callbacks cannot overwrite it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(success: PositionCallback) {
          (window as typeof window & { success?: PositionCallback }).success =
            success;
          return 7;
        },
        clearWatch() {},
      },
    });
  });
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: "Follow my location" }).click();
  await picker.getByLabel("Latitude", { exact: true }).fill("30.6609876");
  await picker.getByLabel("Longitude", { exact: true }).fill("-96.3505678");
  await picker.getByRole("button", { name: "Use these coordinates" }).click();
  await page.evaluate(() =>
    (window as typeof window & { success: PositionCallback }).success({
      timestamp: Date.now(),
      coords: {
        latitude: 30.7,
        longitude: -96.4,
        accuracy: 2,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition),
  );
  await expect(picker).toContainText(
    "Selected: Manually entered starting point",
  );
  await expect(picker.getByLabel("Latitude", { exact: true })).toHaveValue(
    "30.6609876",
  );
  await expect(picker.getByLabel("Longitude", { exact: true })).toHaveValue(
    "-96.3505678",
  );
});

test("follow reports permission, timeout, unavailable and stale position failures", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      error?: PositionErrorCallback;
      success?: PositionCallback;
    };
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(success: PositionCallback, error: PositionErrorCallback) {
          state.success = success;
          state.error = error;
          return 1;
        },
        clearWatch() {},
      },
    });
  });
  const picker = await openPicker(page);
  for (const failure of [
    { code: 1, expected: "permission was denied" },
    { code: 3, expected: "timed out" },
    { code: 2, expected: "location is unavailable" },
  ]) {
    await picker.getByRole("button", { name: "Follow my location" }).click();
    await page.evaluate(
      (code) =>
        (window as typeof window & { error: PositionErrorCallback }).error({
          code,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: "browser error",
        }),
      failure.code,
    );
    await expect(picker.getByRole("status")).toContainText(failure.expected);
  }
  await picker.getByRole("button", { name: "Follow my location" }).click();
  await page.evaluate(() =>
    (window as typeof window & { success: PositionCallback }).success({
      timestamp: Date.now() - 120_001,
      coords: {
        latitude: 30.65,
        longitude: -96.35,
        accuracy: 12,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition),
  );
  await expect(picker.getByRole("status")).toContainText("old location");
});

test("follow stops when its picker unmounts and explains insecure contexts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      clearCalls: number[];
      success?: PositionCallback;
    };
    state.clearCalls = [];
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition(success: PositionCallback) {
          state.success = success;
          return 9;
        },
        clearWatch(id: number) {
          state.clearCalls.push(id);
        },
      },
    });
  });
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: "Follow my location" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as typeof window & { clearCalls: number[] }).clearCalls,
    ),
  ).toEqual([9]);
  await page.evaluate(() =>
    (window as typeof window & { success: PositionCallback }).success({
      timestamp: Date.now(),
      coords: {
        latitude: 30.7,
        longitude: -96.4,
        accuracy: 2,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    } as GeolocationPosition),
  );

  await page.addInitScript(() =>
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    }),
  );
  await page.reload();
  const insecurePicker = await openPicker(page);
  await insecurePicker
    .getByRole("button", { name: "Follow my location" })
    .click();
  await expect(insecurePicker.getByRole("status")).toContainText(
    "requires a secure connection",
  );
});
