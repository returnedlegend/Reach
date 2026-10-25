import { expect, it } from "vitest";
import { pickupWindowError } from "../src/lib/sharing-policy";
const now = Date.parse("2026-10-25T18:00:00Z");
const hour = 3600000;
it("accepts one-day pickups whose start passed while filling the form", () => {
  expect(
    pickupWindowError(now - 60000, now - 60000 + 24 * hour, now),
  ).toBeNull();
  expect(pickupWindowError(now, now + 24 * hour, now)).toBeNull();
  expect(pickupWindowError(now + hour, now + 25 * hour, now)).toBeNull();
});
it("distinguishes duration, expired, reversed, invalid and distant dates", () => {
  expect(pickupWindowError(now, now + 168 * hour, now)).toBeNull();
  expect(pickupWindowError(now, now + 168 * hour + 1, now)).toContain(
    "at most 7 days",
  );
  expect(pickupWindowError(now - 24 * hour, now, now)).toContain(
    "already ended",
  );
  expect(pickupWindowError(now + hour, now, now)).toContain("after it starts");
  expect(pickupWindowError(NaN, now, now)).toContain("valid");
  expect(
    pickupWindowError(now + 31 * 24 * hour, now + 32 * 24 * hour, now),
  ).toContain("next 30 days");
});
it("compares actual instants with explicit timezone offsets", () => {
  expect(
    pickupWindowError(
      Date.parse("2026-10-25T12:59:00-05:00"),
      Date.parse("2026-10-26T12:59:00-05:00"),
      now,
    ),
  ).toBeNull();
});
