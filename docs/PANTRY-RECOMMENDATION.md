# How Reach recommends a pantry

Reach optimizes a trip against the recorded data and a person's declared limits. It cannot optimize unobserved food stock, hidden eligibility rules, an unlisted pantry, or a route it did not retrieve. The UI therefore says **Best checked pantry**, identifies incomplete comparisons, and sometimes makes no recommendation.

The implementation is deterministic. AI can interpret supported preferences or emphasize supplied evidence; it does not select the winner, change a hard limit, invent a route, or establish stock. The algorithm version in the response is `feasibility-weighted-v1`.

## Inputs and hard constraints

The existing access form supplies an actual selected origin, America/Chicago service date/departure, walking-time/distance limits, fare budget, transfer cap, travel mode, visit/buffer duration, waiting choice, appointment acknowledgement, optional arrival deadline, and optional return destination/deadline. Service/urgency preferences affect the applicable records and ranking weights. Eligibility acknowledgement is declared information, not an organization-issued eligibility determination. Household size and dietary needs do not establish available quantities or suitable food.

The engine rejects known failures before scoring: incompatible service dates/closures, forbidden pedestrian pickup, unbooked required appointments, impossible intake/distribution/visit timing, excessive actual routed walking, known fare exceeding budget, too many transfers, missed deadlines, or fresh unavailable-food reports that cover the expected service time. Missing facts produce confirmation requirements. An unknown fare cannot establish that the budget fits.

A new zero-travel timing test eliminates a window that is impossible even before travel. It does not create a travel-time estimate. Such exclusions do not consume an external routing request or a candidate slot. The route callback receives a candidate ID, so an origin matching some other pantry's coordinates cannot accidentally authorize a route to an unchecked site.

## Search order and bounds

`prioritizePantryCandidates` orders verified coordinates, recorded service windows and stronger site detail before straight-line proximity. The distance is used only to decide which provider requests to attempt first; it is never displayed as a routed distance or used as proof of a feasible walk.

The candidate limit is `REACH_ACCESS_CANDIDATES`, an integer from 1 to 24, default 8. Unlike the old nearest-three shortlist, it counts destinations that actually reach a route request after the engine's static exclusions. A separate adapter limit remains **12 external route calls and 25 seconds**. A transit option or round trip can require several calls. Shared connectors and identical route requests are memoized within the request. Provider policy/rate limits remain in force; raising the candidate setting does not lift them.

No missing route is silently replaced by a line-of-sight estimate. Unsupported services, ambiguous clock-change journeys, unreachable/unavailable providers, missing hours, and missing return journeys remain explicit. A selected-destination request checks that destination rather than claiming a catalog-wide optimization.

## Score and explainable tradeoffs

Within the surviving feasibility tier, the engine uses:

```text
score = intake-buffer bonus
      - travel penalty - extra walking penalty - fare penalty
      - transfer penalty - uncertainty penalty
      - waiting penalty - time-to-service penalty
```

Default base weights are 1 point per travel minute, 2 extra points per walking minute, 4 points per fare dollar, 8 per transfer, 12 per modeled uncertainty, and a 0.1-point intake-slack bonus capped at 120 minutes. Default additional waiting/time-to-service weights are zero; declared urgency increases time-to-service weight by 2 for soon or 0.5 for today. Declared transit-nearby preference adds walking burden only to actual transit options. Operator overrides are finite, nonnegative, validated settings. They do not override hard constraints.

An unknown leg's fare uses a **penalty proxy** of the declared fare budget plus one; it is not a price estimate. `totalFare` remains null and the result stays conditional. The score breakdown exposes the actual comparison penalties, known travel/walking/transfer totals, modeled waiting and intake slack. These are planning points, not probabilities of success or predictions of food availability. Extra walking penalty intentionally counts burden beyond its contribution to total travel time.

A `fits` tier precedes `confirm`. Within a tier, higher score wins and the stable ID resolves exact ties. A recommendation requires a confirmed-site location, valid coordinates, a retrieved outbound itinerary, timed service/visit, and a retrieved return when requested. A site with unknown hours or an unverified location can remain browsable without becoming the recommended pantry.

The module also computes a Pareto frontier: options that are not worse in every configured cost dimension. Up to three alternatives prioritize these different tradeoffs before filling remaining places with the next scalar-ranked options. This avoids hiding a lower-score but meaningfully different walking/cost choice behind several clearly worse variants. It is still a bounded set, not a proof of the best possible real-world outcome.

## User-facing evidence

`AccessResponse.recommendation` includes the selected ID or null, conditional status, reasons, alternatives/frontier IDs, and comparison scope/counts. A complete comparison applies only to verified records in that search under the supplied data. Unverified sites and unlisted services are outside that claim. Route/service information can remain unresolved even when some routes were retrieved; those counters overlap and should not be added as a partition of the directory.

The real API observation in [live-recommendation.json](evidence/live-recommendation.json) used the official BTD Bryan Terminal example coordinates and requested a Monday October 26 walking round trip. It retrieved real Valhalla/FOSSGIS routes and conditionally selected Brazos Church Pantry: approximately 0.2701 miles and six minutes each way. Seventeen sites were excluded before routing, three had itineraries, two had unresolved route/service facts, and three locations were unverified. The comparison explicitly remained incomplete. Food, eligibility and pedestrian pickup were not confirmed. This is a dated provider observation, not a current stock or safety guarantee.

## Verification and next improvements

The new pure tests cover proximity versus actual trips, unknown hours/location/fare, missing returns, score arithmetic, Pareto tradeoffs, limits and deterministic ties. Handler tests use a real isolated database with synthetic provider responses to verify candidate budgeting, pre-route exclusions, ID-based route permission and selected-destination behavior. Browser fixtures check the recommendation panel and no-recommendation state on mobile/desktop. Real-provider evidence is separate from those fixtures.

Before tuning weights, collect permissioned field cases and compare the result with a human planner using the same constraints. Priorities are verified pedestrian access, structured per-site eligibility, current distribution exceptions and appropriate provider coverage. Evaluate reasons for failed visits and route/source gaps; do not invent an accuracy percentage from passing tests. An exhaustive comparison would need routes and service facts for every relevant site, enough provider capacity, and wider transit coverage. The current bounded optimizer explicitly reports when that evidence is incomplete.

## First-release follow-up

The [implemented release candidate](FIRST-RELEASE.md) adds a second boundary check on adapter chronology: outbound departure must follow the requested start, and a return must depart after the modeled visit ends, with non-reversed arrival/departure and deadline checks. A new regression initially reproduced a return during the visit; the corrected path rejects it. Route-budget exhaustion now produces a human-readable message as well as incomplete-comparison metadata. Source review reminders and pedestrian-pickup restrictions remain separate from routed geometry and stock.
