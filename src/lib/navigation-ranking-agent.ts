import { ACCESS_WEIGHTS } from "./access-engine";
import type { NavigationNeeds } from "./navigation-types";
import type { AccessInput } from "./access-types";

/** Preferences change only scores among options that survive hard constraints.
 * Transit preference uses real walking connectors, never stop proximity. */
export function navigationWeights(
  needs: NavigationNeeds,
  mode: AccessInput["mode"],
  base = ACCESS_WEIGHTS,
) {
  return {
    ...base,
    timeToServiceMinute:
      base.timeToServiceMinute +
      (needs.urgency === "soon" ? 2 : needs.urgency === "today" ? 0.5 : 0),
    walkingMinute:
      base.walkingMinute +
      (needs.preferTransitNearby && mode === "transit" ? 2 : 0),
  };
}
