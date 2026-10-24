import { describe, expect, it } from "vitest";
import { rankResources } from "../src/lib/resource-summary";
import { syntheticCandidate } from "./fixtures/access-scenarios";
describe("known pickup incompatibility in anonymous discovery", () => {
  it("excludes prohibited pickup for walking/transit but preserves unknowns and driving", () => {
    const resources = [
      {
        ...syntheticCandidate("prohibited").resource,
        pedestrianPickup: "not-allowed" as const,
      },
      {
        ...syntheticCandidate("unknown").resource,
        pedestrianPickup: "unknown" as const,
      },
    ];
    for (const mode of ["walking", "transit"] as const)
      expect(
        rankResources(resources, { mode }).map((r) => r.resource.id),
      ).toEqual(["unknown"]);
    expect(rankResources(resources, { mode: "driving" })).toHaveLength(2);
  });
});
