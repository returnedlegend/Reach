import { describe, expect, it } from "vitest";
import type { Resource } from "../src/data/resources";
import { filterDirectory, nextPublishedWindow } from "../src/lib/discovery";

const resource = (overrides: Partial<Resource> = {}): Resource => ({
  id: "pantry",
  name: "Community Food Pantry",
  address: "123 Main Street, Bryan, TX 77801",
  coordinates: null,
  city: "Bryan",
  postalCode: "77801",
  hours: "Hours not verified.",
  eligibility: "Not verified.",
  notes: "",
  sources: [],
  ...overrides,
});

describe("directory filtering", () => {
  it("matches name, street address, city, and postal code without searching unsupported facts", () => {
    const pantry = resource();
    expect(filterDirectory([pantry], "community food")).toEqual([pantry]);
    expect(filterDirectory([pantry], "Main Street")).toEqual([pantry]);
    expect(filterDirectory([pantry], "Bryan")).toEqual([pantry]);
    expect(filterDirectory([pantry], "77801")).toEqual([pantry]);
    expect(filterDirectory([pantry], "not verified")).toEqual([]);
  });

  it("returns all resources for an empty query and supports accent-insensitive text", () => {
    const pantry = resource({ name: "Café Community Pantry" });
    expect(filterDirectory([pantry], "  ")).toEqual([pantry]);
    expect(filterDirectory([pantry], "cafe")).toEqual([pantry]);
  });
});

describe("next published distribution window", () => {
  const weeklyWindow = {
    id: "thursday",
    rule: { kind: "weekly" as const, weekdays: [4] },
    opens: "09:00",
    closes: "11:00",
    registrationOpens: "08:00",
    registrationCutoff: "08:45",
    policyKnown: true,
    sourceIds: ["published-source"],
  };

  it("leaves unknown hours unknown", () => {
    expect(
      nextPublishedWindow(resource(), new Date("2026-10-22T12:00:00Z")),
    ).toBeNull();
    expect(
      nextPublishedWindow(
        resource({ windows: [{ ...weeklyWindow, policyKnown: false }] }),
        new Date("2026-10-22T12:00:00Z"),
      ),
    ).toBeNull();
  });

  it("returns the next open date after a structured closure and keeps registration separate", () => {
    const result = nextPublishedWindow(
      resource({ windows: [weeklyWindow], closures: ["2026-10-22"] }),
      new Date("2026-10-22T12:00:00Z"),
    );
    expect(result).toEqual({
      startsAt: "2026-10-29T14:00:00.000Z",
      label: "Thu, Oct 29, 9:00 AM",
    });
    expect(result?.startsAt).not.toContain("08:00");
  });

  it("orders by Chicago day and minute and returns a DST-correct instant", () => {
    const result = nextPublishedWindow(
      resource({ windows: [weeklyWindow] }),
      new Date("2026-10-22T12:00:00Z"),
    );
    expect(result?.startsAt).toBe("2026-10-22T14:00:00.000Z");
    // On the winter side of the Chicago clock change, 9 AM is UTC-6.
    const winter = nextPublishedWindow(
      resource({
        windows: [
          { ...weeklyWindow, rule: { kind: "dates", dates: ["2026-11-05"] } },
        ],
      }),
      new Date("2026-11-04T18:00:00Z"),
    );
    expect(winter?.startsAt).toBe("2026-11-05T15:00:00.000Z");
  });

  it("selects the earliest same-day window even when records are unsorted", () => {
    const afternoon = { ...weeklyWindow, id: "afternoon", opens: "15:00" };
    const morning = {
      ...weeklyWindow,
      id: "morning",
      opens: "09:00",
      appointmentRequired: true,
    };
    const result = nextPublishedWindow(
      resource({ windows: [afternoon, morning] }),
      new Date("2026-10-22T12:00:00Z"),
    );
    expect(result?.startsAt).toBe("2026-10-22T14:00:00.000Z");
    expect(result?.label).toBe("Thu, Oct 22, 9:00 AM · appointment required");
  });

  it("does not use conflicting schedules or search beyond 35 days", () => {
    expect(
      nextPublishedWindow(
        resource({ windows: [{ ...weeklyWindow, conflictingSources: true }] }),
        new Date("2026-10-22T12:00:00Z"),
      ),
    ).toBeNull();
    expect(
      nextPublishedWindow(
        resource({
          windows: [
            {
              ...weeklyWindow,
              rule: { kind: "dates", dates: ["2026-12-01"] },
            },
          ],
        }),
        new Date("2026-10-22T12:00:00Z"),
      ),
    ).toBeNull();
  });
});
