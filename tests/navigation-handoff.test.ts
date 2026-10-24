import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectedLocation } from "../src/components/location-picker";
import {
  offerNavigationOrigin,
  takeNavigationOrigin,
} from "../src/lib/navigation-handoff";

const origin: SelectedLocation = {
  coordinates: { lat: 30.6501234, lng: -96.3505678 },
  label: "Synthetic test origin",
  source: "manual",
  timestamp: 1_800_000_000_000,
};

afterEach(() => vi.useRealTimers());

describe("one-use navigation origin handoff", () => {
  it("expires after one minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));
    offerNavigationOrigin("bridge-ministries", origin);
    vi.advanceTimersByTime(59_999);
    expect(takeNavigationOrigin("bridge-ministries")).toEqual(origin);

    offerNavigationOrigin("bridge-ministries", origin);
    vi.advanceTimersByTime(60_000);
    expect(takeNavigationOrigin("bridge-ministries")).toBeNull();
  });

  it("consumes a wrong-ID handoff and permits only one successful take", () => {
    offerNavigationOrigin("bridge-ministries", origin);
    expect(takeNavigationOrigin("parkway-baptist")).toBeNull();
    expect(takeNavigationOrigin("bridge-ministries")).toBeNull();

    offerNavigationOrigin("bridge-ministries", origin);
    expect(takeNavigationOrigin("bridge-ministries")).toEqual(origin);
    expect(takeNavigationOrigin("bridge-ministries")).toBeNull();
  });
});
