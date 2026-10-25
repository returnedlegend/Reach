# TX10 expansion and in-app directions verification

Independent review dated October 22, 2026. No organization was called or
messaged, no external email was sent, and no public deployment was performed.
The active directory contains **24 pickup sites: eight retained and 16 added**.
This is researched partial coverage, not a complete district directory.

| Requirement | Result | Actual evidence |
| --- | --- | --- |
| Actual TX10 boundary, 119th Congress | Passed | Independently extracted Census `GEOID=4810`, `CDSESSN=119` with OGR; feature equals the checked-in GeoJSON exactly. Detailed closed polygon has 16,821 vertices. Archive and GeoJSON SHA-256 match [metadata](../data/geo/tx10-119.metadata.json). No county approximation is used. |
| Added pickup addresses, coordinates and provenance | Passed | Fresh BVFB directory review, official regional pickup pages, four independently repeated Census address geocodes, and exact production-API reconciliation of every admitted point, published schedule and source URL. Geocoder results match stored coordinates rounded to seven decimals; these are street interpolations, not entrance surveys. [Production source audit](evidence/tx10-data-audit.json). |
| Outside-district and unresolved candidates | Passed | Independent polygon classification excludes Progressive Missionary Baptist, Robertson County Cares and Call for Help. Washington Mobile's camera-center-only pin was rejected and unset. All four remain research-only, absent from the active database. |
| Honest hours, eligibility, inventory and access | Passed within source-review scope | Reviewed pickup hours remain distinct from office/registration hours. Madison's fourth-Thursday/date conflict has no invented generic window; Giddings dated events are not promoted to a recurrence. Bedias/fairground/address conflicts and unreviewed entrances remain explicit. No live food stock, crowd data, safe walking access or transit service is asserted. |
| Primary Get directions stays in Reach | Passed in final production matrix | Embedded CTA closes its pantry dialog and opens Trip directions. Standalone CTA preserves an exact origin through short-lived memory; URL contains only pantry ID and mode, with no precise origin in local/session storage. All four profiles passed. |
| Walking/driving geometry and provider instructions | Passed, with separate live and fixture evidence | Real Valhalla pedestrian/auto requests returned HTTP 200. Integrated live map/navigation smoke also succeeded. Deterministic browser tests separately verify both modes, exact endpoints, provider steps and shape legends. See evidence boundaries below. |
| Current origin, GPS metadata and End route | Passed in final production matrix | GPS source and 45 m accuracy survive pantry detail; a fix received while the dialog is open becomes the route origin. Stationary fixes preserve the route. End clears shape, stops the watch, rejects late callbacks and cancels a pending 1.1-second reroute. All four profiles passed. |
| Opt-in GPS, denied permission and manual recovery | Passed in final production matrix | No location request before a user action; denial preserves precise manual entry. Explicit Stop, manual replacement, unmount, old fixes and permission failures clear watches; late callbacks cannot replace the chosen point. |
| Mobile map/sheets, boundary overlay and accessibility | Passed in final production matrix | Sheet browsing and collapse preserve routes. 320 px inner/visual/page widths agree; End route target is at least 44 px. Trip directions has zero detected WCAG A/AA violations. Coverage API geometry equals the original polygon; overlay/coverage zoom preserve the chosen origin. |
| Provider failures and stale navigation | Passed in final production matrix | Failed recomputation removes old geometry/instructions, provides an honest unavailable state and permits retry. Map failures retain cards/manual coordinates. No route line is synthesized for missing provider/transit data. |
| Complete final production regression matrix | Passed | **385 passed, seven intentional skips, zero failures**, in one clean 5.6-minute run. Four Chromium profiles, 98 cases per profile; not 392 distinct journeys. [Complete browser log](evidence/tx10-browser.txt). |

## Source and live evidence

Fresh source artifacts are under `/tmp/reach-tx10-qa/`: BVFB HTML/text;
AMEN La Grange contact/food-pickup page; Schulenburg home/contact pages; and
Census Geocoder responses for Bastrop, Giddings, La Grange and Schulenburg.
Independent ray casting puts all 16 admitted additions inside the official
polygon. The retained Bryan/College Station points are also inside. District
inclusion does not establish a pantry's service eligibility.

[Real service evidence](evidence/tx10-live-services.json) records successful
walking/driving adapter requests: walking 0.6881 miles, 786.619 seconds,
19 shape points and five instructions; driving 0.8236 miles, 203.833 seconds,
40 points and eight instructions. Independent review decoded the researcher's
raw polyline6 responses and checked all maneuver indices/nonempty instructions.
The saved API evidence also includes the successful real Bastrop address search.

The owner's successful [final-production browser smoke](evidence/tx10-final-live-services.json)
used real tiles and real routes in the same session after the GPS metadata fix.
Both route POSTs and the Bastrop address search returned HTTP 200. Walking to
Faith Mission returned 0.3125 miles, 6.035433 minutes, ten points and five
instructions; driving returned 0.3094 miles, 1.028133 minutes, nine points and
three instructions. The recorded map was ready, the directory contained all
24 sites, and there were no page errors. UI instructions were checked against
the actual API responses. See [live directions](evidence/tx10-live-directions-mobile.png) and
[live route map](evidence/tx10-live-directions-map.png). This cloud browser
needed test-only `ignoreHTTPSErrors` for its proxy certificate; application TLS
verification remained enabled. This is not a direct-browser certificate-readiness
claim or an ongoing provider-availability/safe-access guarantee.
An earlier browser harness attempt failed on a relative API-request URL after
route assertions; the corrected complete final-production rerun is the evidence
linked here.

Ordinary automated browser tests intercept service responses and use the real
MapLibre renderer with a neutral fixture background. Their route shapes, GPS
fixes and map pixels are synthetic; they establish UI/state behavior, not actual
cartography, route safety, stock, accessibility or live transit. No offline map
download or field/physical-device review was performed.

## Executed checks and reproduction

The final `npm run check` passed data validation for 24 production records,
TypeScript, **313 unit tests in 27 files**, and the production build. Evidence:
[complete check log](evidence/tx10-check.txt). The final focused production rerun passed
**4/4** mobile/desktop cases after the GPS metadata and cluster test corrections:
`/tmp/reach-tx10-qa/final-focused.log`.

The complete unfiltered run passed **385 checks**, skipped **seven** and failed
**zero**. Four skips are preview-email lifecycles on the deliberately
email-disabled server; three skip the duplicate 320 px batch on non-mobile
profiles. The dedicated mobile 320 px checks ran. The matrix includes all 36
executions of this reviewer's nine integration cases, 12 directory/discovery
executions, four district-cluster executions, retained planner/download/print
workflows, real synthetic account management, and real local community
moderation/reservation/privacy workflows. Post-test TypeScript passed; the
active directory remained 24 records and SQLite foreign-key validation returned
zero violations.

The full production target is loopback-only HTTPS on port 3060, proxied to the
frozen build on port 3059. Its fresh isolated database is
`/tmp/reach-tx10-qa/production-matrix.sqlite`. Email is disabled, the community
pilot is explicitly enabled, and offline verified account/moderator fixtures
are synthetic. Controlled full-suite routing/geocoding is disabled at the server;
real-provider smoke evidence above is a separate bounded run.

```sh
# Source the private temporary fixture environment; it contains generated test credentials.
source /tmp/reach-tx10-qa/production-env.sh
npx playwright test --workers=2 --output=/tmp/reach-tx10-qa/final-matrix
```

Do not rebuild beneath the running production target. Chromium profiles are
390×844, Android-sized 412×915, tablet 820×1180 and desktop 1280×900, with a
separate 320 px check. These are emulations, not physical-device certification.
The temporary QA server and HTTPS proxy were stopped after final verification;
private databases, credentials and test artifacts were retained without changes.

Earlier diagnostic runs exposed and prompted fixes for stationary GPS clearing
a route and GPS metadata loss through pantry details. The first full production
attempt was intentionally interrupted for the latter fix after 56 completed
passes; it also found an obsolete pointer test targeting a now-hidden cluster
member. That test now activates the real visible representative and requires
both named offers plus the bus in its chooser, retaining privacy/ownership
checks. Interruption artifacts and earlier development/HMR runs are not counted
as the final production matrix.

A subsequent attempt exposed outdated real-planner count and supporting-copy/
status-container assertions, plus an ineffective fixture geocoder variable.
Those assertions now follow the actual in-app flow while retaining endpoint,
schedule and privacy checks. The fixture now explicitly sets
`OSM_NOMINATIM_SINGLE_INSTANCE=false` and an empty `OSM_GEOCODER_URL`;
HTTP verification confirms the disabled configuration response. All four
affected mobile cases passed focused reruns before the final matrix restarted.
