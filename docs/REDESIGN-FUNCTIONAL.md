# Redesign functional verification

Independent functional review of the mobile-first UI redesign, October 20, 2026 in America/Chicago (October 21 UTC). This review uses the existing application behavior and browser suites as its regression contract. Implementation ownership remains with the redesign agents; this review does not change application code or weaken existing assertions.

The final unfiltered suite against the completed production build scheduled **324 cases in 15 files: 317 passed, 0 failed and 7 intentionally skipped in 10.9 minutes**. The process exited successfully and Playwright's completion record reports `passed` with no failed tests. This clean run includes the original 260 cases plus 64 new redesign checks. Evidence: [complete sanitized production browser log](evidence/redesign-browser.txt), [focused planner save/download/print verification](evidence/redesign-planner.txt). Full final-run artifacts remain at `/tmp/reach-redesign-functional-production`.

| Chromium profile | Viewport | Passed | Intentionally skipped | Failed |
| --- | --- | ---: | ---: | ---: |
| Phone | 390×844 | 80 | 1 | 0 |
| Android emulation | 412×915 | 79 | 2 | 0 |
| Tablet | 820×1180 | 79 | 2 | 0 |
| Desktop | 1280×900 | 79 | 2 | 0 |

Four skips are the development-only preview-email signup/recovery case repeated per profile: production deliberately disables that preview transport, and this review sends no email. The other three skips avoid repeating the dedicated 320px nine-route check outside the phone project; that check passed on the phone. All enabled community and offline-account lifecycle cases ran and passed against the isolated database. Chromium emulation is not physical Android/iOS or Safari testing.

## Regression contract

The existing Playwright configuration enumerates **260 cases in 14 files**, covering four Chromium viewport profiles: phone 390×844, Android emulation 412×915, tablet 820×1180, and desktop 1280×900. This is 65 cases repeated per profile, not 260 independent journeys or physical-device testing.

| Capability | Existing independent coverage |
| --- | --- |
| Explicit location permission, denied/unavailable/stale GPS, race protection | `v2-verification.spec.ts` |
| Exact manual coordinates and external direction URLs | `v2-verification.spec.ts`, `v3-verification.spec.ts`, `pantry-journey.spec.ts` |
| Local suggestions, submitted geocoding, map selection confirmation/cancellation | `transformation.spec.ts`, `osm-verification.spec.ts` |
| Real MapLibre rendering, keyboard pins, origin drag, map outage/retry | `osm-verification.spec.ts`, `transformation.spec.ts` |
| Route opt-in, current coordinates, destination/mode changes, stale responses, route outage/retry | `v2-verification.spec.ts`, `v3-verification.spec.ts`, `osm-verification.spec.ts` |
| Conservative food/shelter information, sources, planner real/example separation | `v3-verification.spec.ts`, `workflow.spec.ts` |
| Saved-resource/trip persistence and precise-origin consent | `transformation.spec.ts` |
| Planner save, reload, removal, actual text download and print layout | `workflow.spec.ts` |
| Pantry busy-time evidence, unknown data, management gates and dialogs | `pantry-ui.spec.ts`, `pantry-journey.spec.ts`, `account-verification.spec.ts` |
| Community disabled/recovery UI and shared selected origin | `hotspot-access.spec.ts`, `transformation.spec.ts` |
| Account configuration, explicit token confirmation and fragment removal | `account-verification.spec.ts` |
| Fixture account preferences, volunteer actions, consent and private instructions | `email-ui.spec.ts` |

Map, geocoder and routing tests use explicit controlled provider responses. A successful run establishes UI contracts and the real browser map runtime; it does not establish live provider uptime, route suitability, GPS hardware accuracy, current food availability, beds or transit operation.

## Identity and email boundaries

No real accounts are created and no email is sent by this review. Account preference and administrative UI tests use browser-intercepted fixture responses. The authorized production fixture uses a fresh disposable database at `/tmp/reach-redesign-production/community.sqlite`, a local synthetic moderator, and synthetic test identities. Email delivery is explicitly disabled. The separate preview-email suite remains gated because the production application intentionally disables its development preview transport.

The test-only Node TLS proxy at `https://localhost:3443` forwards to the loopback production server on port 3055. Local verification clients ignore its self-signed test certificate; application certificate verification is unchanged. The explicit canonical HTTPS origin exercises secure account cookies and actual same-origin HTTP guards. Temporary credentials and private keys are kept in mode-600 files outside the repository and are omitted from evidence.

After the successful run, the account status endpoint still reported disabled email delivery and the isolated database contained zero mail deliveries. The verification production server and TLS proxy were stopped; the existing development server on port 3000 remained available with HTTP 200.

## Execution record

Initial development-target inspection found HTTP 500 while `guided-reach.tsx` imported the not-yet-created `guided-reach.module.css`. This was reported to the implementation owner as an in-progress dependency, before running browser tests. It is not a completed-build defect.

An initial development-target regression selection scheduled 114 phone/desktop cases. It was deliberately interrupted to release resources before the production build: **9 passed, 2 interrupted, 103 did not run**. This is partial evidence, not a full-suite pass. The completed cases covered account configuration/accessibility, explicit token confirmation, public pantry access and management gates, hotspot navigation/recovery, submitted address lookup, geocoder failure/manual fallback, invalid map API input, and tile-outage recovery UI. Evidence: `/tmp/reach-redesign-functional-targeted.log` and `/tmp/reach-redesign-functional-targeted`.

Review identified an existing date-dependent browser assertion: its synthetic pantry has a conflicting Monday window, but expected Monday's unknown current status on every real date. The test now fixes the browser clock to Monday October 19 at 10 AM Chicago time. Its unknown-status and missing-data assertions are unchanged; application scheduling behavior is unchanged.

The corrected test then exposed a separate mobile interaction defect. When the browser revealed the 9 AM busy-time bar, the new fixed bottom navigation covered its pointer-down position with the Account icon. Pointer-up reached the bar, so the final click targeted their common ancestor and did not select the hour. Keyboard focus correctly revealed the 12-minute observation. This was reported to the shared-shell owner with captured native event targets; the existing click and observation assertions remain unchanged. Focused failing evidence: `/tmp/reach-redesign-functional-clock.log` and `/tmp/reach-redesign-functional-clock`.

The shell owner added mobile scroll padding and control scroll margins to keep revealed controls above the fixed navigation. The exact same Monday-clock test then **passed** on the phone profile, including the pointer click, 12-minute observation and Tuesday missing-data assertions. Evidence: `/tmp/reach-redesign-functional-clock-fixed.log` (1 passed in 16.5 seconds).

An initial production attempt was stopped before the final narrow-map-card visual correction. It recorded 11 passed, 2 failed, 2 interrupted and 309 unrun of 324 scheduled cases. Both completed failures were verification setup/contract issues: the offline-account fixture queried the lazily initialized pantry table before the first pantry request, and the account heading assertion still expected the previous design copy. The fresh-target procedure now initializes `/api/pantries` before launching the suite, and the heading assertion exactly expects the approved “Your Reach account” copy. No configuration, accessibility, authentication or persistence assertions were removed. Initial evidence is retained separately at `/tmp/reach-redesign-functional-production-initial.log` and `/tmp/reach-redesign-functional-production-initial`.

A second attempt recorded 13 passed, 2 interrupted and 309 unrun before the integration owner identified that shared-header CSS hid the planner's retained Saved trips, Our information and How Reach works navigation. The run and production server were stopped for the correction and rebuild. This partial run did pass the actual offline account lifecycle against the fresh isolated database. Evidence: `/tmp/reach-redesign-functional-production-before-planner.log` and `/tmp/reach-redesign-functional-production-before-planner`.

After restoring planner navigation, focused planner and accessibility verification passed 11 of 12 phone/desktop cases. The remaining phone case exposed interference between the new page-control scroll margins and the native trip dialog's sticky action footer: the Download card pointer action did not reach the intended button. Injecting a dialog-specific zero scroll margin restored a real text download with its fictional-use warning and visible print heading. The shell owner applied the scoped margin correction and a two-column phone footer. Failing focused evidence: `/tmp/reach-redesign-functional-planner.log` and `/tmp/reach-redesign-functional-planner`.

A new physical-viewport assertion then caught clipping that the prior `scrollWidth <= innerWidth` check missed. Text-range inspection established the underlying cause: legacy mobile `order` properties placed the restored planner tabs in the new grid's narrow 44px help column. Their text overflow expanded mobile Chromium's layout viewport from the configured 390px to 421px on landing and 434px after saving; fixed navigation and the native dialog followed that larger containing block. Explicit grid placement and reset ordering restored all measured widths to 390px, the dialog to x=9–381px, and bottom navigation to y=777–844px. An injected correction verified the real download before requesting the final production rebuild. The physical dialog bounds assertion remains in `workflow.spec.ts` for all profiles. No overflow-hiding or viewport-clamping workaround was used.

The final production build then passed the exact planner save/download/print/reload/removal journey on both phone and desktop: **2 passed in 13.5 seconds**, including the new physical-viewport assertion. Evidence: `/tmp/reach-redesign-functional-modal-final.log` and `/tmp/reach-redesign-functional-modal-final`.

The next unfiltered attempt passed 41 cases before stopping for production compatibility fixes to the browser tests: nine new public-route tests expected Next's development portal element to exist before asserting that it did not contain a build error. Production correctly omits that element. The assertion now requires zero portals containing a build error, preserving its intended contract in both environments. Two legacy map-filter journeys now explicitly open the redesigned native “Filter resources” disclosure before choosing filters; their precision, GPS, marker and filter-result assertions are unchanged. That stopped attempt recorded 9 failed, 2 interrupted, 1 intentionally skipped and 271 unrun; these development-portal failures are not application failures. Evidence remains separate at `/tmp/reach-redesign-functional-production-review-contract.log` and `/tmp/reach-redesign-functional-production-review-contract`.

## Final test-contract changes

- `pantry-ui.spec.ts` fixes the synthetic Monday schedule's browser clock to Monday; unknown-status and missing-data assertions remain intact.
- `account-verification.spec.ts` and `email-ui.spec.ts` exactly assert the approved account and volunteer heading copy. Authentication, configuration, consent and accessibility assertions remain intact.
- `transformation.spec.ts` opens the new native map-filter disclosure in both existing filter journeys. Coordinate precision, GPS, map selection, ownership and filter-result assertions remain intact.
- `redesign-review.spec.ts` accepts an absent development portal while rejecting any portal containing a build error. Its overflow checks compare against the configured physical viewport.
- `workflow.spec.ts` additionally requires the saved trip dialog to fit the configured physical viewport on every profile. Existing actual download-content, print, persistence, focus restoration and removal checks remain intact.

The final production run used the completed build without rebuilding beneath the running server. Reproduction requires an isolated `/tmp` database, synthetic moderator credentials, explicitly enabled community and offline-account gates, canonical local HTTPS origin, test-only TLS proxy, and disabled email provider. Initialize `/api/pantries` before direct-database fixtures, then run the unfiltered Playwright configuration with two workers. Do not set the development preview-email gates on this production target. Temporary launch scripts and protected configuration are retained under `/tmp/reach-redesign-production` for this workspace's review.
