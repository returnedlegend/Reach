import { describe, expect, it } from "vitest";
import { serviceFreshness } from "../src/lib/service-freshness";
describe("source review dates", () => {
  it("uses the oldest evidence so refreshing one source does not renew all facts", () => {
    const value = serviceFreshness(
      {
        sources: [
          { title: "Old", checkedOn: "2026-09-01" },
          { title: "New", checkedOn: "2026-10-24" },
        ],
      },
      new Date("2026-10-24T12:00Z"),
    );
    expect(value.status).toBe("review-due");
    expect(value.nextReview).toBe("2026-10-01");
  });
  it("does not treat missing, impossible or future check dates as verified", () => {
    for (const checkedOn of [undefined, "2026-02-30", "2026-12-01"])
      expect(
        serviceFreshness(
          { sources: [{ title: "Source", checkedOn }] },
          new Date("2026-10-24T12:00Z"),
        ).status,
      ).toBe("unknown");
  });
  it("marks a record due on its review date without claiming live stock", () => {
    expect(
      serviceFreshness(
        { sources: [{ title: "Source", checkedOn: "2026-10-01" }] },
        new Date("2026-10-30T12:00Z"),
      ).status,
    ).toBe("recent-source-check");
    expect(
      serviceFreshness(
        { sources: [{ title: "Source", checkedOn: "2026-10-01" }] },
        new Date("2026-10-31T12:00Z"),
      ).status,
    ).toBe("review-due");
  });
});
