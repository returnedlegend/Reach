# Reach transformation verification

Independent QA started October 18, 2026 UTC (October 17 in America/Chicago). Results below distinguish working application behavior, controlled provider fixtures, and features not yet verified. No public deployment is part of this review.

## Baseline before implementation

`npm run check` completed successfully against the original source: data validation, TypeScript, **152 unit tests in nine files**, and production build. Evidence: `/tmp/reach-transform-baseline-check.log`. The production server on port 3000 was restarted after the build so browser tests exercise the checked build.

Full unfiltered baseline browser verification completed in one clean run: **74 passed** across Chromium phone (390×844) and desktop (1280×900), against the restarted production server. Evidence: `/tmp/reach-transform-baseline-browser.log`. This established the pre-transformation regression baseline.

## Existing feature inventory

| Area                            | Existing implementation                                                                                                                | Evidence and limits                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guided assistance               | Food, shelter, transport questions; location and travel choices; return/back/edit controls                                             | Guided browser journeys; shelter does not claim live beds or fabricate destinations                                                                           |
| Location                        | Explicit GPS request, manual coordinates, submitted address search, explicit reverse lookup                                            | Browser fixtures cover permission failures, stale GPS responses, coordinate precision, validation and keyboard controls; real GPS accuracy is not established |
| Food information                | Eight sourced pantry listings with contact links, schedules, requirements, source dates and uncertainty                                | Data validation, pantry unit tests and listing/card browser checks; no inventory or admission guarantee                                                       |
| Maps                            | Bundled MapLibre, OSM-derived configured maps, native pantry/origin controls, draggable origin, attribution                            | Real browser renderer with controlled cartography in ordinary tests; see OSM-VERIFICATION.md for prior live-provider evidence                                 |
| Directions                      | Explicit calculation, walking/driving provider routes, scheduled transit, mode/destination recomputation, external directions fallback | Browser response fixtures and unit tests; no new live-provider verification yet                                                                               |
| Transit                         | Published GTFS subset, calendar/holiday handling, transfer constraints, missed-bus recomputation                                       | Unit tests and browser timing checks; no live vehicle arrival feed                                                                                            |
| Pantry planner                  | Separate real and fictional example modes, fit/confirm/no outcomes, return deadlines, detail dialog                                    | Legacy workflow browser tests and scheduling unit tests                                                                                                       |
| Saved trips                     | Browser-local save/reload/removal/clear-all, text download and print                                                                   | Browser workflow checks; baseline has no server synchronization                                                                                               |
| Informational pages             | Sources, limitations, privacy/location and terms                                                                                       | Content and link checks, automated accessibility scans                                                                                                        |
| Accounts and server persistence | Absent at baseline                                                                                                                     | No registration, authentication, sessions or application database                                                                                             |
| Community                       | Absent at baseline                                                                                                                     | No requests/offers, matching, messaging, moderation or community reporting                                                                                    |
| Device coverage                 | Existing suite: Chromium phone 390×844 and desktop 1280×900                                                                            | No claim of physical Android/iOS hardware testing; tablet and Android emulation to be added                                                                   |

## Verification boundaries

Existing automated suites use controlled provider responses for deterministic routing/geocoding/map checks. Their success does not prove live service uptime, safe pedestrian access, current food availability, shelter beds or transit operations. Real MapLibre DOM/WebGL behavior is exercised. Authentication and database checks use the actual local application and SQLite backend; all account and food content is synthetic QA data. Automated accessibility results do not replace assistive-technology or field accessibility review.

## Transformation review

The transformed application has been independently exercised against its production build. The final crowded-marker regression matrix passed and is recorded below.

### Verified transformed functionality

- Explore, Map, Community and Saved navigation share the current selected origin. Named local directory suggestions work from typing without submitting external geocoder requests. Coordinates remain an advanced fallback. Map click/drag selection is pending until explicit confirmation and can be cancelled.
- GPS fixtures exercise the real browser map renderer: exact coordinates and the reported accuracy survive navigation, the origin is centered, and the rendered blue accuracy circle is visible in a reviewed screenshot. The GPS callback is controlled test input; this does not establish hardware GPS accuracy. Source review confirms zoom 16 on an origin change; maps use controlled backgrounds during these tests.
- Bookmarked resources and trip snapshots survive reload. Independent browser tests verify precise coordinates are absent from browser storage before explicit consent, appear only after consenting to include the origin, and can be removed. Existing separate pantry-planner save/download/print coverage remains.
- Community tests use the real Next HTTP routes, password hashing, cookie sessions and SQLite database. No community API is mocked. Accounts, posts, moderation decisions and pickup requests are synthetic QA fixtures in isolated `/tmp` databases, not real food availability.
- Independent HTTP checks exercise role and ownership guards, same-origin mutation checks, unsafe-food rejection, private draft and pending visibility, public-data redaction, duplicate requests, concurrent acceptance (exactly one succeeds), accepted-recipient pickup access, completion and logout. Additional final-run checks exercise organizer approval, hotspot rejection/edit/resubmission, reporting, moderator removal and report resolution.
- Complete browser journeys use three separate sessions: create account, fill and persist an offer draft, reload, submit, moderator approval, recipient signup/request, donor acceptance, private pickup access, recipient collection and logout. Each journey includes automated accessibility and horizontal-overflow checks.

### Defects independently identified

1. Real Next HTTP rejected valid browser signup requests because `Request.url` contained the bind hostname while the `Origin` header contained the browser hostname. Backend ownership fixed the same-origin comparison using a validated direct Host or explicit canonical origin; forwarding headers are not implicitly trusted. The independent actual-HTTP workflow then passed.
2. Initial reporting lacked moderator removal of approved posts. The backend added moderator removal that cancels active reservations, and report resolution with retained review evidence. Independent final-run HTTP assertions cover these actions.
3. A desktop contrast failure in the community invitation was reported to the UI owner; the corrected muted color passed the subsequent automated landing scan.
4. Visual review noticed blank MapLibre zoom controls under the new theme. Theme padding was collapsing the icon width. The corrected buttons are 44×44 pixels, with visible icons; independent browser geometry assertions and screenshots cover the fix.

### Final production matrix

The final checked production build is served on internal port 3055 with the development community flag enabled and a fresh isolated SQLite database. The unfiltered suite covers phone 390×844, Android Chromium emulation 412×915, tablet 820×1180 and desktop 1280×900. There are 176 cases (44 per profile), including API cases repeated by each profile. This is not 176 distinct journeys or physical-device testing. **Final result: 176 PASS, 0 FAIL, 0 BLOCKED, 0 skipped, in one clean 4.0-minute run.** Evidence: [complete browser log](evidence/transformation-browser.txt); original screenshots and traces: `/tmp/reach-transform-complete-results`. Each of the four profiles passed 44 cases.

The final `npm run check` passed data validation, TypeScript, **184 unit tests in 13 files**, and a clean production build. Evidence: [complete check log](evidence/transformation-check.txt).

### Reproduce the complete community-enabled matrix

Use a disposable database and synthetic accounts. Set `REACH_COMMUNITY_ADMIN_PASSWORD` to a temporary password of at least 12 characters in the shell; do not commit it. The bootstrap creates a real local moderator, not a seeded production account. Run the build before starting the server; never rebuild underneath the production test target.

```sh
npm run check
export REACH_COMMUNITY_DB="/tmp/reach-verification-unique/community.sqlite"
export REACH_COMMUNITY_ENABLED=true
: "${REACH_COMMUNITY_ADMIN_PASSWORD:?Set a temporary QA moderator password}"
npx tsx scripts/community-admin.ts create-moderator qa_moderator
npm run start -- --port 3053
```

In another terminal, set the same temporary password in `REACH_COMMUNITY_ADMIN_PASSWORD`, then run:

```sh
REACH_TEST_URL=http://localhost:3053 \
REACH_TEST_COMMUNITY=true \
REACH_TEST_MODERATOR_USERNAME=qa_moderator \
REACH_TEST_MODERATOR_PASSWORD="$REACH_COMMUNITY_ADMIN_PASSWORD" \
npx playwright test --workers=2 --output=/tmp/reach-verification-results
```

Use a fresh database for an entire repeated matrix so earlier synthetic accounts and the real abuse limits do not interfere. All four configured profiles run by default. `npm run test:e2e` without `REACH_TEST_COMMUNITY=true` intentionally skips the two community test cases per profile; that command alone is not evidence of community verification. Community requests use real HTTP and database transactions. Map/geocoder/route fixtures are separate and identified in the test source. This process enables only a local development pilot, not a public food-sharing service.

### Numbered audit scope (26 feature groups)

This counts 26 user-facing capability groups, not individual assertions. **26 PASS, 0 FAIL, 0 BLOCKED, 0 NOT IMPLEMENTED within this local scope.** Status applies only to the verification methods shown. Separate release requirements with blocked or unimplemented status appear below and are not included in these passes.

| #   | Feature group                                                         | Verification method                                                                       | Status |
| --- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| 1   | Guided food journey and eight sourced pantry listings                 | Browser journey and data validation                                                       | PASS   |
| 2   | Shelter limitations and 211 fallback                                  | Browser; no fabricated beds/destinations                                                  | PASS   |
| 3   | Published transport stops and provider information                    | Browser and GTFS unit checks                                                              | PASS   |
| 4   | Opt-in GPS, denied/stale/unavailable responses and accuracy circle    | Controlled GPS callback, real map renderer, screenshot                                    | PASS   |
| 5   | Advanced manual location and exact coordinate preservation            | Browser input, shared state and actual direction URLs                                     | PASS   |
| 6   | Local suggestions and explicitly submitted address search             | Keyboard browser checks and request counting                                              | PASS   |
| 7   | Explicit reverse lookup preserving the original point                 | Controlled provider response; exact input assertion                                       | PASS   |
| 8   | Pending map click/drag, confirmation and cancellation                 | Real map pointer interaction                                                              | PASS   |
| 9   | Map attribution, worker rendering, outage and retry                   | Real MapLibre with controlled style/tiles                                                 | PASS   |
| 10  | Pantry/bus/hotspot/offer icons and crowded-marker selection           | Real markers, pointer/keyboard selection; touch overlap review                            | PASS   |
| 11  | Resource ranking and distance/accessibility/hours filters             | Browser plus deterministic summary/ranking unit checks                                    | PASS   |
| 12  | Verified facts, source disclosures and availability uncertainty       | Browser and unit/data checks                                                              | PASS   |
| 13  | Walking/driving directions, mode changes, stale routes and retry      | Controlled route responses; real external-link coordinates                                | PASS   |
| 14  | Scheduled transit, missed-bus and holiday behavior                    | Browser clock and GTFS/journey unit checks                                                | PASS   |
| 15  | Pantry round-trip feasibility and real/demo separation                | Browser and planner unit checks                                                           | PASS   |
| 16  | Existing pantry-planner save/reload/download/print/removal            | Browser workflow, real downloads and print invocation                                     | PASS   |
| 17  | New resource bookmarks and trip snapshots with precise-origin consent | Browser storage inspection, reload and removal                                            | PASS   |
| 18  | Shared tabs, responsive layouts and automated accessibility           | Four Chromium profiles, 320px regression and axe scans                                    | PASS   |
| 19  | Adult account signup, login, cookies and logout                       | Real browser and HTTP sessions                                                            | PASS   |
| 20  | SQLite persistence and hashed credential storage                      | Actual database, reload, read-only integrity/permission inspection                        | PASS   |
| 21  | Organizer applications and role authorization                         | Actual HTTP approval and role enforcement                                                 | PASS   |
| 22  | Hotspot draft/edit/rejection/resubmission/moderation and directions   | Actual HTTP plus browser map/link checks, edited exact origin                             | PASS   |
| 23  | Food-offer safety fields and optional photo handling                  | Browser forms, rejected invalid upload, successful sanitized image, private/public access | PASS   |
| 24  | Requests, duplicate/concurrent reservations, consent and collection   | Real SQLite transactions and three-browser journey                                        | PASS   |
| 25  | Reporting, moderator removal/resolution and blocking                  | Real HTTP; blocking cancels accepted request and revokes pickup access                    | PASS   |
| 26  | Community disabled by default                                         | Separate production server: read and signup endpoints return HTTP 503                     | PASS   |

### Additional findings from release verification

- A newly added hotspot-directions component was not receiving the shared origin from the application shell. The independent browser check observed a destination-only link despite a selected starting point. Passing the canonical selected coordinates fixed this wiring; regression assertions now also edit the starting point and check that the hotspot URL updates exactly.
- At a city overview, a community offer marker could intercept a nearby bus-stop tap. Multiple offers at the same approximate area also overlap at every zoom. This was treated as a real touch-usability defect, not covered up by passing keyboard/card tests. The map owner added visible overlap counts and an accessible chooser with the original named resource choices, unchanged coordinates, Escape and focus restoration. Independent mobile touch verification passes for the overlapping bus stop and both identical-area offers. Escape restores focus; original coordinates remain unchanged.
- The first enhanced release run was stopped after two test-navigation timeouts: rapid successive zoom clicks interrupted the map animations. The corrected tests settle real animations before pointer targeting and independently exercise native keyboard selection. A subsequent attempt exposed the real hotspot-origin wiring defect above. Earlier failed/interrupted attempts remain separate from the final clean-run result.

A targeted crowded-marker attempt initially retapped immediately after keyboard Escape, inside the mobile double-tap gesture interval; the map correctly began a zoom gesture and dismissed the chooser. The browser test now settles the gesture interval before the next tap. This test-timing correction is separate from the actual overlapping-marker defect fixed in the application.

### Security and persistence evidence

Independent checks use real HTTP authorization boundaries and actual SQLite transactions. They verify role/owner restrictions, rejected foreign-Origin mutations, HttpOnly/SameSite cookie attributes, private draft and pickup access, public-data redaction, duplicate requests, exactly one winner under concurrent acceptance, and revocation after collection, removal or blocking. Invalid image bytes produce an honest UI error while preserving the draft; a valid image is converted to JPEG with metadata removed, inaccessible anonymously while private, then accessible after approval. These checks establish the exercised boundaries, not a comprehensive penetration-test certification.

A [read-only inspection of the final QA database](evidence/transformation-database.json) found mode `0600`, stored password hashes/salts and hashed session tokens, and `PRAGMA integrity_check = ok`. The default-disabled build independently returned HTTP 503 and `Cache-Control: no-store` for account, discovery, activity, moderation and signup endpoints ([recorded responses](evidence/transformation-disabled.json)). After the entire suite, the production process was stopped and restarted against the same database. The existing session still authenticated and returned the same saved offer IDs ([restart evidence](evidence/transformation-persistence.json)). Accounts and databases are disposable local fixtures; no production account or public inventory was created.

### Reviewed visual evidence

The four viewport captures show the final production landing page: [phone](evidence/transformation-phone.png), [Android emulation](evidence/transformation-android.png), [tablet](evidence/transformation-tablet.png), and [desktop](evidence/transformation-desktop.png).

Additional behavior captures:

- [Food results and selected destination](evidence/transformation-food-results.png): actual directory UI, controlled map background, no invented route geometry.
- [GPS accuracy circle and visible zoom controls](evidence/transformation-gps-accuracy.png): actual MapLibre rendering with controlled 35 m GPS accuracy input.
- [Crowded-marker chooser](evidence/transformation-crowded-map.png): actual touch-opened choice among overlapping official bus stops and synthetic QA offers. The chooser scrolls to additional controls; Escape and exact resource selection are independently asserted.
- [Completed community collection](evidence/transformation-community-collected.png): real account/database workflow with synthetic QA food. Private pickup notes remain collapsed and are absent from the screenshot.

No new live-provider or physical-device claim is made. Prior live cartography/provider evidence and its TLS limitations are documented separately in [OSM verification](OSM-VERIFICATION.md). Public deployment, operational moderation staffing, real food availability and field accessibility remain outside this local development verification.

### Scope statuses and release limits

The 26 numbered groups describe the implemented local-development scope and their specified verification methods. They do not include the following separate release requirements:

| Status          | Separate requirement                          | Evidence or remaining work                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKED         | New direct-browser live-provider verification | This matrix deliberately uses controlled providers. The earlier live-map review documents cloud Chromium TLS limitations; no new direct live-provider result is claimed.                                                                             |
| BLOCKED         | Physical Android/iOS and field verification   | No physical hardware, real GPS accuracy, safe pedestrian access, food availability or field accessibility evaluation was available in this environment.                                                                                              |
| NOT IMPLEMENTED | Production account lifecycle                  | Verified email/contact ownership, password recovery and account lifecycle controls are absent; development username/password sessions are the tested implementation.                                                                                 |
| BLOCKED         | Public community operation                    | Durable hosted backups/restore drills, staffed moderation, stronger abuse prevention and legal/food-safety operational review remain prerequisites, documented in [community setup](COMMUNITY.md) and [food-sharing safety](FOOD-SHARING-SAFETY.md). |

These limits are not counted as passed features. No public deployment approval follows from the local test results.


## October 18 follow-up — direct food hotspot access

The home-screen Food hotspots button now opens hotspot-filtered discovery inside the existing guided shell. It preserves the selected coordinates and wizard progress. `/food-hotspots` is a direct entry into the same shell. Signing in from Create Food Hotspot resumes that action; a resident must still request organizer approval and cannot publish directly. `npm run dev` now uses the existing loopback development-pilot launcher. Production `npm start` remains disabled unless explicitly configured.

The independent reviewer identified and rechecked a proposed navigation regression that would have discarded the shared origin; the final implementation keeps the existing shell mounted. No account roles were granted. Main-agent functional verification used the actual local development command, an isolated SQLite database and synthetic signup/request records. The unavailable-service tests use explicit 503 fixtures. An initial test used an exact label selector that included the select options; correcting it to the accessible combobox role resolved the test failure without changing application behavior.

Final follow-up results: **184 unit tests, TypeScript, data validation and production build passed; 16 focused browser cases passed, zero failures/skips**, across phone, Android emulation, tablet and desktop. Cases cover precise-origin/progress preservation, the disabled state, direct entry, signup returning to organizer approval, and existing accessibility checks. This is a targeted follow-up, not a rerun of the earlier 176-case matrix. See [follow-up check log](evidence/hotspot-access-check.txt) and [browser log](evidence/hotspot-access-browser.txt).
