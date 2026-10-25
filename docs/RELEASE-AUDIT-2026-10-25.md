# Reach feature and usability audit — October 25, 2026

## Verdict

## Defects corrected

## Route-by-route review

Every page route was visited in a mobile browser, including redirects and missing-page handling. The recorded pass means it rendered without observed page exceptions/horizontal overflow; it is not a claim that a remote dependency succeeded. 18 initial and 18 production route visits each reported zero axe WCAG A/AA violations in the sampled state. This does not replace assistive-technology/user testing.

## Component coverage

This covers the component inventory, grouped by reachable workflow. Shared CSS/UI primitives are covered through rendered pages, not standalone assertions for every CSS rule.

| Components | Evidence / disposition |
|---|---|
| `guided-reach`, `simple-food-finder`, `ui` | Home/search/empty results, basic and advanced views, top-three display, device saves and error handling exercised; advanced transit success not claimed. |
| `ai-loading-indicator`, `loading-state` | Inline spinner, skeletons, duplicate prevention, stop/retry, reduced-motion checks. |
| `location-picker`, `pickup-location-fields` | Manual coordinates, explicit address submit, permission denial, timeout/stale-position handling, follow start/stop and corrections. GPS events/geocoder success mocked; no device GPS accuracy claim. |
| `journey-map`, `osm-map-canvas` | Real MapLibre rendering, cluster/pin keyboard selection, origin drag confirmation, route geometry/legend clearing, tile failure/retry, reverse lookup and coordinate consistency. Test cartography/routes use fixtures; separate real OpenFreeMap rendering observed. |
| `pantry-detail`, `busy-times` | Real pantry UI, schedule/unknown fields and contact details inspected. Source freshness remains separate from live stock. Crowd algorithms/API protections covered by unit tests; no real crowd dataset inferred. |
| `share-food-form`, `admin-submissions`, `admin-credentials` | Actual anonymous submission → private review → authorized photo retrieval → approval → public listing, plus real local password lifecycle with synthetic users. Both mobile and desktop. |
| `community-panel` | Anonymous browsing, posted food, approved-only visibility, public/private contact separation. Older account coordination subflows are not public-release claims. |
| `site-navigation`, `theme-toggle` | Main/mobile navigation, More menu keyboard/Escape handling, persistent dark/light selection, blocked storage and OS theme changes. |
| `reach-app` | Legacy planner/demo saved card, download and print; no assertion of usable real BTD itineraries. |
| `access-planner`, `navigation-guidance`, `navigation-preferences`, `reach-assistant` | Retained advanced code and deterministic/service contracts covered by unit suites. Unconfigured live AI/routing success is blocked. These are not a substitute for the simpler primary journey; not every advanced dialog state was manually tested. |
| `account-panel`, `google-sign-in`, `notification-preferences`, `outreach-panel`, `volunteer-panel`, `pantry-management` | Retained legacy code; current public entry points disabled. No claim that these removed account-based experiences work for anonymous visitors. |
| `release-unavailable` | Now used consistently at retired route entry points; clear return to Find food. |

## External-service findings

## Usability assessment

The anonymous discovery and sharing paths are substantially more coherent than the legacy mix. Large touch controls, dark mode, meaningful empty/error states and map/list alternatives are strengths. The largest fixed problem was the expanded technical comparison before results. Detailed formulas are still available for transparency, but people should not need them to choose a next action.

Remaining release-quality concerns: actual address search and walking directions must work reliably on the deployment; AI must be tested with the real model against representative requests and slow networks; moderator alerts need delivery monitoring; maintained data needs a named review owner and recurring review schedule. The lengthy optional advanced planner still requires more cognitive effort than the main food search. Test with people who use food assistance, including screen-reader users, before calling the app universally accessible. Automated axe passes alone cannot establish that.

## Operator actions

## Verification totals

Final commands and counts are recorded below after the final rerun. Raw sanitized route and service observations are in `docs/evidence/release-audit-2026-10-25/`. Earlier failures from changed wording and test-data pollution are not hidden: they were corrected and rerun; blocked live checks remain blocked.

Final results:

Visual evidence: [mobile home](evidence/release-audit-2026-10-25/home-mobile.png), [mobile map](evidence/release-audit-2026-10-25/map-mobile.png). API/route observation JSON records the audit environment, not the user's laptop. Test accounts, images, records and TLS certificates stayed in isolated temporary storage and are not shipped.
