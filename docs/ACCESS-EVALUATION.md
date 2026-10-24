# Food access evaluator checks

The evaluator uses deterministic constraints and injected route results. Its fixtures are invented and live in `tests/fixtures/access-scenarios.ts`; they are not pantry listings, availability reports, route surveys, or evidence about real service access. The evaluator makes zero AI calls. The route lookup is a boundary for externally supplied travel estimates, not an assertion that a route provider is live or complete.

The focused test suite covers schedule arrival and closing cutoffs, arrival buffers and visit duration, missing hours and unknown eligibility, stale availability, unavailable food, step-free and pedestrian access uncertainty, conflicting schedule sources, appointment states, complete-trip fare/walking/transfer limits, a missing return journey, explicit next-day service, and a provider warning on the 2026 Chicago clock-change date. Availability is assessed at expected arrival and service time, so a report that expires during travel becomes unknown. Unknowns must remain `confirm`; known hard failures must not be presented as `fits`.

Run these checks with Node 24 from the repository root:

```sh
npx vitest run tests/access-engine.test.ts
npx tsx scripts/evaluate-access.ts
```

The evaluation script compares the evaluator's first choice with a nearest-place baseline on three labeled synthetic cases. It reports usable options, measured local evaluation latency, AI call count, and known hard-constraint violations. The nearest baseline intentionally ranks by straight-line distance alone, so it can select a closed or infeasible option. Latency measures local JavaScript evaluation with in-memory route fixtures; it excludes geocoding, routing, network, database, and user wait time. A zero violation result checks only the constraints represented in these scenarios and is not a guarantee of real-world access, food availability, route safety, or pantry eligibility.

The added return-trip regressions reject a known return fare over budget even when the outward fare is unknown, and reject a visit that ends after the required return deadline. Separate wall-clock tests use the actual 2026 Chicago DST transitions (March 8 and November 1), including repeated/nonexistent local times and next-day normalization. The latest machine-readable fixture evaluation is [access-evaluation.json](evidence/access-evaluation.json).

Real configured walking requests are separate evidence: [public stop-to-stop adapter response](evidence/access-live-routing.json) and [actual planner handler with a pantry visit and return](evidence/access-live-planner.json). These retrieved route geometry and estimates; they do not verify safe entrances, pedestrian pickup, pantry stock, eligibility, or actual transit operation. The pantry result correctly remains in confirmation status. No AI inference or real email was part of these requests.
