# Food-first verification

Checked October 24, 2026, America/Chicago (some evidence timestamps are October 25 UTC). This covers the scoped food-first follow-up, not every historical browser spec or a deployed production service.

## Final checks

| Check                          | Observed result    | Scope                                                                                                                                                                   |
| ------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard `npm run check`       | PASS               | Data validation: 24 maintained records and six separate fictional fixtures; TypeScript; 638 tests in 73 files; optimized production build                               |
| Production core browser matrix | PASS, 92 cases     | 74 mobile/desktop cases plus 18 Android-sized/tablet cases, actual standalone build over local HTTPS, disposable SQLite, runtime Google variables empty                 |
| Optional AI browser states     | PASS, 8 cases      | Separate extended local production profile; provider responses intercepted; success, outage, opt-out/late response, and manual travel choice winning over pending AI    |
| Scoped accessibility           | PASS               | Home axe scans at mobile/tablet/desktop: zero violations; map/keyboard and failure cases also covered. Not a screen-reader or WCAG certification                        |
| Startup                        | PASS               | Supported standalone server, static/public assets, loopback default, CLI overrides and project-relative database resolution; healthy actual browser requests            |
| Production dependency audit    | PASS snapshot      | `npm audit --omit=dev`: zero known vulnerabilities at this check; not a general security certification                                                                  |
| Credentials                    | PASS scoped scan   | No credential-pattern matches in changed text or 35 production client JS assets; `.env.local` ignored and mode 600; no secrets committed                                |
| Independent critical review    | PASS after repairs | Fractions, return/future clarification, city scope, displayed unknowns, itinerary handoff, expiry and fresh-response clock behavior separately reproduced and rechecked |

The 100 browser cases are **92 core + eight optional AI cases**, not 100 live-provider checks. Earlier failed runs were corrected and rerun: an aside landmark error; old wizard test entry selectors; a mobile smooth-scroll/tap/download interaction; ambiguous text locators; and a misconfigured full-unit invocation that forced `core` onto optional-feature fixtures. Assertions and release gates were preserved. The independent reviewer additionally held several real trip-constraint defects until fixed.

Core commands, with the already running local HTTPS production preview:

```sh
npm run check
REACH_TEST_URL=https://localhost:3443 REACH_TEST_LOCAL_TLS=true \
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- \
  tests/simple-food.spec.ts tests/simple-food-trip.spec.ts \
  tests/release-journey.spec.ts tests/release-core.spec.ts \
  tests/pantry-recommendation.spec.ts tests/theme-default.spec.ts \
  tests/location-follow.spec.ts tests/osm-verification.spec.ts \
  --project=mobile --project=desktop
```

The two simple-food specs also ran with `--project=android --project=tablet`. The AI spec ran separately with `REACH_TEST_AI_CONFIGURED=true` against an explicitly configured extended preview. These are Chromium viewport emulations, not physical devices or Firefox/WebKit checks. The locally generated certificate exception was used only for the test origin; external requests in these routine browser cases were intercepted. No external TLS validation was disabled for live checks.

No Lint script exists. Changed-file Prettier, `git diff --check`, startup-script syntax/help and CI YAML parsing were also checked. The CI workflow now includes browser smoke tests plus the retained unit/build/container checks. A local pass does not establish a remote Actions result; inspect the pull request checks.

## Actual external observations

## Performance and visual review

The unthrottled local standalone build was measured using cold browser contexts and a warm local server, with external requests blocked. Three single observations gave roughly 264–288 ms LCP, 0–0.0695 CLS, 205,845 encoded bytes of initial JS, no initial API requests, no horizontal overflow and no browser runtime errors. These are **local diagnostics**, not field Core Web Vitals, INP measurements, low-end-device results, statistical comparisons or uptime guarantees. [Conditions and numbers](evidence/food-first-visual-performance.json). The earlier development-bundle measurements in the [data audit](CORE-DATA-PERFORMANCE.md) are not comparable production baselines.

Visual evidence:

- Before: [previous release mobile home](evidence/release-home-mobile.png).
- After: [mobile home](evidence/food-first-home-mobile.png), [tablet home](evidence/food-first-home-tablet.png), [desktop home](evidence/food-first-home-desktop.png), [one-action Bryan results](evidence/food-first-results-mobile.png).
- [Actual map assets rendered](evidence/food-first-live-map-desktop.png) and [direct TLS-provider failure recovery](evidence/food-first-map-tls-fallback-desktop.png). The actual map screenshot includes the final attribution-color correction: provider credits have an opaque high-contrast background and focused keyboard links.

The primary screen reduces mandatory input and puts real options/calls/directions first. Advanced tools remain optional. Data and provider limits have not been hidden to improve the apparent completion score. See [the release assessment](FOOD-FIRST-RELEASE.md), [independent backend](CORE-BACKEND-AUDIT.md), [map](CORE-MAP-AUDIT.md), and [data/performance](CORE-DATA-PERFORMANCE.md) audits.

## Remaining release limits

Production hosting/HTTPS/ownership, an approved routing endpoint, authenticated DNS access, verified email sender and authorized test recipient, reliable AI capacity, real-device/screen-reader/service-user validation, and unresolved pantry/transit facts remain external or operational prerequisites. Community/volunteer operations, full Spanish UI and offline PWA support are outside this anonymous release scope. No public deployment or external outreach occurred. Competition eligibility and AI-contribution disclosure require the entrant's own review.
