# Independent daisyUI redesign verification

Independent acceptance gate passed October 22, 2026: **417 passed, seven intentional
skips, zero failures across 424 checks** in one clean run against the frozen
production build. All 32 new redesign-review cases passed. Counts include four
Chromium profiles and repeated API checks, not 424 distinct journeys or devices.

## Final evidence

| Check                                             | Result                                                                                                                                                                               | Evidence                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Data, TypeScript, unit tests and production build | Passed: 24 pantry records, 313 unit tests, successful build; final post-test TypeScript also passed                                                                                  | [Complete check log](evidence/daisy-check.txt)                                                                         |
| Complete unfiltered browser matrix                | 417 passed, seven skipped, zero failed                                                                                                                                               | [Complete browser log](evidence/daisy-browser.txt)                                                                     |
| Responsive public routes                          | Nine real routes at 320, 375, 390, 768, 1024 and 1440 px in both themes; 108 full-page captures; no horizontal overflow or page errors                                               | [Independent tests](../tests/daisy-verification.spec.ts), [PNG capture manifest](evidence/daisy-screenshots.json); original session artifacts under `/tmp/reach-daisy-qa/final-matrix/` |
| Automated accessibility                           | 48 new WCAG A/AA-tagged axe scans, including WCAG 2.2 AA; zero detected violations                                                                                                   | Public routes, dark dialogs and selected planner-result/filter-count states in the browser log                         |
| Enabled input and checkbox boundaries             | 3.41:1 in light, 4.66:1 in dark against actual adjacent surfaces                                                                                                                     | [32 rendered measurements](evidence/daisy-control-contrast.json)                                                       |
| Visible selected states                           | Nine groups in both themes: readable selected/unselected text, at least 3:1 fill distinction and a selected-only 2 px underline; checked during ordinary motion after changing views | [72 state measurements](evidence/daisy-selected-states.json)                                                           |
| Theme behavior                                    | System preference and changes, explicit preference across routes/reloads, denied storage, and initialization with hydration scripts blocked all passed                               | New theme cases in the browser log                                                                                     |
| Keyboard and portable trips                       | More menu, Escape/focus restoration, dialog focus, save/reload, real text downloads, print invocation and print styles passed                                                        | New dark-flow case and retained workflow cases                                                                         |
| Post-browser SQLite integrity                     | 24 active pantries, zero foreign-key violations, `integrity_check=ok`                                                                                                                | [Database integrity result](evidence/daisy-database.json)                                                                        |

The four default browser profiles are 390×844, Android Chromium emulation
412×915, tablet 820×1180 and desktop 1280×900. The new capture sweep assigns each
requested width once across these profiles; the 108 screenshots are not repeated
four times. It scans 36 public-route states, four dark dialogs and eight selected
planner-result states. Additional retained accessibility checks also ran.

The seven skips are four preview-email lifecycle cases on the deliberately
email-disabled target and three duplicate 320 px sweeps on non-mobile profiles.
The dedicated mobile 320 px sweep ran successfully. No configured lint script
exists; data validation, TypeScript, unit tests and the production build ran.

## Existing functionality and scope

The pre-redesign application already implemented guided discovery, 24 source-backed
pickup listings, MapLibre maps, exact manual origins, opt-in one-shot/follow GPS,
explicit address search, in-app walking/driving routes, a separate conservative
static BTD timetable planner, SQLite accounts and pantry management, local
community/hotspot moderation and reservations, volunteer pickup workflows,
browser-local saved places/trips, text downloads and printing. The full regression
matrix retained these behaviors, including exact endpoints, current GPS metadata,
route mode changes, stale-response rejection, unavailable-provider recovery,
location-saving consent, authentication and ownership guards.

Live food stock, live occupancy/traffic, realtime transit arrivals, complete
district coverage, guaranteed safe entrances and native offline maps are not
established capabilities. Existing source dates, unknown inventory and schedule
limitations remain explicit. Older architecture documents describe earlier
project states; current source and TX10 implementation records establish the
pre-redesign functionality.

## Independent review findings and corrections

Review found and prompted corrections for invisible same-color pantry phone text,
low-contrast warnings/error messages, prose links distinguished only by color,
mobile navigation appearing at desktop widths, and MapLibre zoom controls shrinking
to 29 px after stylesheet layering. The final telephone action independently
requires 4.5:1 contrast; retained GPS tests require 44 px zoom buttons with visible
24 px icons. Vendor styles now occupy a lower cascade layer.

Manual color inspection also found empty field boundaries at only 1.28:1/1.71:1
and enabled account/navigation choices with indistinguishable selected states.
Actual daisyUI active classes, stronger control borders and visible selection
underlines now pass the measured checks above. Ordinary-motion testing exposed
low contrast while selected foreground/background pairs interpolated; these
colors now change together while short shadow/transform transitions remain.

Earlier development/HMR results and interrupted matrices are excluded from the
final counts. A fixture initialization omission was corrected by requesting and
verifying all 24 directory records before tests read SQLite directly. A legacy
header check now opens the actual More menu while retaining destination URLs,
44 px targets, viewport bounds and Escape/focus assertions. No coordinate, route,
privacy or authorization assertion was weakened. Twelve focused production
accessibility, boundary and ordinary-motion state cases passed before the final
unfiltered matrix.

The redesign improves practical hierarchy: maps appear before secondary controls,
provider details are disclosed beneath friendly direction headings, desktop results
and maps share the viewport, and compact mobile navigation keeps secondary
destinations available through a keyboard-accessible menu. Visible selection
indicators and readable form boundaries improve operation beyond palette changes.

## Screenshots and evidence boundaries

Representative public screens:
[mobile home, light](evidence/daisy-mobile-home-light.png),
[mobile home, dark](evidence/daisy-mobile-home-dark.png),
[mobile account](evidence/daisy-mobile-account-dark.png),
[mobile pantry](evidence/daisy-mobile-pantry-dark.png),
[desktop home, light](evidence/daisy-desktop-home-light.png), and
[desktop home, dark](evidence/daisy-desktop-home-dark.png).

Selected production map/direction views:
[mobile light](evidence/daisy-map-mobile-light.png),
[mobile dark](evidence/daisy-map-mobile-dark.png),
[desktop light](evidence/daisy-map-desktop-light.png), and
[desktop dark](evidence/daisy-map-desktop-dark.png).
Their [fixture manifest](evidence/daisy-map-fixtures.json) records exact synthetic
origins, pantry endpoints, route requests and absence of page errors.

Ordinary browser tests and these selected-map captures use the real MapLibre
renderer with neutral cartography and explicitly controlled route/GPS fixtures.
They establish interface and state behavior, not real cartography, provider uptime,
hardware GPS accuracy, safe access, inventory or live public transit. Real account
and community regression cases use actual local HTTP handlers and SQLite with
synthetic identities/content. Additional state-review fixtures are read-only and
never create real accounts, send email or modify public pantry data.

Theme initialization was verified before hydration. No high-speed first-paint
recording, physical iOS/Android testing, manual screen-reader review or throttled
mobile-network performance study was performed. Automated scans and targeted
measurements do not constitute blanket WCAG conformance certification.

## Reproduction and remaining limitation

The session used loopback-only HTTPS on port 3072, proxying the frozen
production build on port 3071. It uses a fresh isolated database at
`/tmp/reach-daisy-qa/production.sqlite`, generated private moderator credentials,
community test gates, disabled email and disabled server geocoding/routing.
Browser TLS bypass is limited to this local test certificate; application
certificate verification was not changed. No public deployment or real email
delivery was performed.
The temporary Next server and HTTPS proxy were stopped after verification;
private session fixtures remain under `/tmp/reach-daisy-qa/`.

With the built Next server and local proxy running again in separate terminals,
the prepared session environment reproduces the command below. The proxy script
is `/tmp/reach-daisy-qa/https-proxy.mjs`; Next was started with
`next start --hostname 127.0.0.1 --port 3071`.

```sh
# Private generated session fixture environment; never commit its contents.
source /tmp/reach-daisy-qa/production-env.sh
# Initialize/verify the public directory before offline SQLite fixture tests.
curl --cacert /tmp/reach-daisy-qa/tls-cert.pem --fail \
  'https://localhost:3072/api/pantries?pageSize=100' >/dev/null
npx playwright test --workers=2 --output=/tmp/reach-daisy-qa/reproduced-matrix
```

Build before starting the target; do not rebuild underneath a running production
server. Regenerate synthetic fixtures when repeating the entire matrix.

The existing initial camera behavior can center an origin at zoom 16 when a map
mounts with an already calculated route, leaving a more distant destination
outside the first frame. Zoom controls remain available. This preexisting camera
behavior was documented without changing navigation logic during the redesign.
No unresolved implementation blocker was found within the tested local scope.
