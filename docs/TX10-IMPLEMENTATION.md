# TX-10 directory and directions implementation

Completed October 22, 2026. The final production build passed 313 unit tests,
385 browser checks (seven intentional skips), data validation and TypeScript.
See [independent verification](TX10-VERIFICATION.md) for the evidence and limits.

## In-app flow

- The main action opens the Map sheet, where people can search by site name,
  city, address, or ZIP and choose a starting location. GPS is opt-in; users can
  set a location manually. A city or ZIP search does not imply that the
  directory covers the whole area.
- Choosing **Get directions** opens Trip directions in Reach. It keeps the
  chosen site, mode, and origin in app state; precise coordinates are not added
  to the URL. Walking and driving request provider geometry and written steps.
  Transit continues to use the separate published BTD timetable and does not
  claim live arrivals.
- Optional **Follow my location** uses the newest GPS fix as the route origin
  and recomputes directions as that origin changes. **End route** clears the
  route and stops following.
- **Compare nearby travel times** checks actual routes to up to five nearby
  confirmed sites in the selected walking or driving mode. Unavailable routes
  stay unknown. This is not a district-wide fastest-site ranking and does not
  show same-day inventory.
- The map can display the official TX-10 boundary and zoom to its extent. The
  boundary describes the 119th Congress district; it does not determine
  eligibility for a food program.
- Close map markers cluster at low zoom. **Map view** switches back to the map;
  **Show directions/Hide directions** controls the directions panel without
  clearing the active origin and destination.

## Data and evidence boundaries

The current directory has 24 entries: the original eight Brazos County records
and 16 additions (12 Brazos and four regional). Twenty-one are classified as
confirmed distribution sites; three remain flagged for confirmation: the Bedias
address, the Grimes fairground gate, and Madison dates/gate. The additions were
checked against the 119th Congress TX-10 polygon and have source-backed
published pickup schedules. Published schedules do not establish current
inventory, eligibility, holiday operation, accessible entrances, or a safe
walking path. Review [TX-10 data provenance](TX10-DATA.md), [boundary
provenance](TX10-BOUNDARY.md), and [regional research](TX10-REGIONAL-RESEARCH.md)
before interpreting coverage.

Routes are estimates from the selected provider and OSM-based road data. They
do not establish that a path is safe, accessible, open, or appropriate for a
specific traveler. Route service is disabled by default. The opt-in FOSSGIS
Valhalla community demo is limited to one instance, one request per second by
provider terms (Reach enforces a 1.1-second shared-host interval), and a Reach
100-mile trip cap. FOSSGIS does not guarantee availability. See [provider
policy and tested configuration](OPENSTREETMAP.md) and [the live routing
research](TX10-ROUTING-RESEARCH.md).

## Live observations

On October 22, the integrated `/api/journey` handler returned HTTP 200 for both
walking and driving requests against the community Valhalla endpoint. The
supplied public street pair produced walking at 0.6881 mi / 13.1103 min / 5
steps / 19 shape points and driving at 0.8236 mi / 3.3972 min / 8 steps / 40
shape points. The detailed browser API responses are in
`/tmp/reach-tx10-app-live.json`; direct provider evidence and shape checks are
in `/tmp/reach-tx10-routing-results.json`.

A subsequent same-browser walkthrough loaded real map tiles and returned both
walking and driving directions to Faith Mission. Walking returned 0.3126 mi,
6.03685 min, five steps and 10 shape points; its first maneuver was “Walk north
on the walkway.” Driving's first maneuver was “Drive north on North Baylor
Street.” There were no page errors. Screenshots are
`/tmp/reach-tx10-live-route-mobile.png` and
`/tmp/reach-tx10-live-route-map.png`.

The live Nominatim endpoint also returned HTTP 200 and one candidate for the
submitted public address 1201 Pine Street, Bastrop. The capture is
`/tmp/reach-tx10-geocode-live.json`. This verifies a geocoder response, not an
entrance or exact serving point; retain informed operator opt-in and confirm
the location before a real trip.

The cloud browser did not trust the environment proxy CA, so the browser check
used test-only `ignoreHTTPSErrors`; an earlier direct browser request failed
with `CERT_AUTHORITY_INVALID`. Application TLS verification was not disabled.

The final production build was exercised again with real services. The public
origin 30.169001, -96.398001 to Faith Mission returned walking 0.3125 miles,
6.0354 minutes, five instructions and ten shape points; driving returned
0.3094 miles, 1.0281 minutes, three instructions and nine shape points. The
browser displayed those provider instructions and actual map tiles, with no
page errors. Explicit address lookup returned HTTP 200 and one candidate;
the production directory contained 24 records. See [final live responses](evidence/tx10-final-live-services.json),
[mobile directions](evidence/tx10-live-directions-mobile.png), and
[route map](evidence/tx10-live-directions-map.png). These public points are
verification examples, not a person's saved location.

Final `npm run check` passed: 24 production data records, TypeScript,
313 unit tests in 27 files, and the production build. The clean production
browser matrix passed 385 checks, skipped seven intentionally, and had no
failures across phone, Android-sized, tablet and desktop profiles. The skips
are production-disabled preview email (four profiles) and duplicate narrow-phone
batches (three profiles); the dedicated 320px phone batch ran. See
[build/check log](evidence/tx10-check.txt), [browser log](evidence/tx10-browser.txt)
and the independent report for scope and prior diagnostic fixes. No separate
lint command exists in this project.

Live requests demonstrate success at the observed time. Browser emulation and
provider smokes do not establish physical GPS accuracy, entrance access, food
inventory, service uptime or an SLA. Public deployment was not performed.
