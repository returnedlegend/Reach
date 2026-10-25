# TX-10 coverage audit

Reviewed October 25, 2026. This is a coverage checklist, not a claim that the directory contains every pantry.

## Geographic scope

The checked-in polygon is **119th Congress TX-10, 2025–2027**. Its metadata identifies Census GEOID 4810, TIGER/Line 2024 CD119, and a matching Texas Department of Transportation reference map. This is the relevant current congressional-session vintage for this review. It must not silently be reused for a later Congress or a different redistricting plan.

- [Census source archive](https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_48_cd119.zip)
- [TxDOT 119th Congress district 10 map](https://www.txdot.gov/content/dam/docs/division/tpp/maps/congressional/cong-district-10-119th.pdf)
- Local evidence: `data/geo/tx10-119.metadata.json`, `data/geo/tx10-119.geojson`.

A city, ZIP code, county, food-bank service area, or an organization's administrative address is insufficient evidence of district membership. Check each actual pickup point against the polygon. Keep unknown points unresolved. Pantry eligibility geography and congressional geography are separate facts.

## Source reconciliation needed for completeness

| Source | Review status | Remaining work |
| --- | --- | --- |
| [Brazos Valley Food Bank Find Food](https://www.bvfb.org/find-food) | Official page returned HTTP 200 in this audit. Existing research covers multiple county lists and distribution types. | Reconcile every current pickup entry against maintained IDs, including fresh-food distributions with distinct addresses, seasonal events and mobile sites. |
| [Central Texas Food Bank Get Food Now](https://www.centraltexasfoodbank.org/food-assistance/get-food-now) | Official page returned HTTP 200 in this audit. | Enumerate the partner locator and mobile schedules, then filter actual pickup coordinates. Page availability alone does not mean every partner was extracted. |
| [Houston Food Bank Find Help](https://www.houstonfoodbank.org/find-help/) | Direct request returned HTTP 403 in this audit. | Review through a permitted public interface or an authorized public export. Do not treat an access failure as evidence that no pantry exists. |
| [Feeding Texas Get Help](https://www.feedingtexas.org/get-help/) | Direct request returned HTTP 403 in this audit. | Cross-check regional food-bank jurisdiction and additional official directories when accessible. |
| Individual organizations | Existing records cite provider pages; expansion is ongoing. | Check pickup addresses, appointment rules, distribution hours and closure notices for each new lead. Keep offices/warehouses separate. |

No single reviewed source establishes a complete universe of all independent, church, school-restricted, mobile and recurring food distributions within the district. A count of entries therefore cannot establish a coverage percentage.

## Known unresolved items from the repository

- Washington Mobile Pantry: food-bank evidence names St. Peter's Episcopal Church, 2310 Airline Drive, Brenham. Prior Maps link exposed camera center only; pin/district inclusion remains unresolved until reliable destination evidence is obtained.
- Elgin Community Cupboard: 303 Avenue C is ambiguous between north/south Census matches. It is present with null coordinates; do not claim every displayed site has a verified in-district pin.
- WARM: published 40070 Highway 290 Business, Waller address did not match prior Census queries. Food-service existence and exact pin are separate checks.
- Bedias: directory says 3202 Main Street; linked map says 3203. Preserve the conflict.
- Grimes/Madison fairgrounds: venue coordinates do not verify the event serving gate or pedestrian entrance.
- Madison recurrence: published November/December event dates conflict with generic fourth-Thursday wording. Do not derive confident recurring windows from that conflict.
- Hearne/Franklin research candidates were excluded by the existing 119th-district point checks. Do not add them solely because their food bank also serves TX-10.

## Completion checklist

- [ ] Inventory all accessible regional partner and mobile-distribution entries, retaining source snapshots and retrieval dates.
- [ ] Deduplicate organizations, distinct pickup sites and separate programs without merging different addresses.
- [ ] Resolve pickup coordinates, then classify inside/outside/unknown against the selected boundary vintage.
- [ ] Preserve published service area, appointment/referral rules and registration windows separately from distribution hours.
- [ ] Resolve conflicts or explicitly flag them; never infer stock, walk-in access, ID exemptions or accessible entrances.
- [ ] Record excluded/closed/duplicate/unresolved leads and why, so the audit is reproducible.
- [ ] Reconcile production import, UI search and AI candidate selection with the reviewed records.
- [ ] Establish a maintenance process for changed schedules and closures.

Until these checks are complete, describe coverage as selected researched TX-10-area sites and approved community listings. No organizations were contacted during this review.

## Independent review of this expansion

Independently compared all 12 proposed production additions in
`data/research/new-tx10-candidates.json` against the captured official BVFB directory
and Sealy homepage/contact documents. Names, pickup addresses, stated schedules,
service-area restrictions and pickup formats match those source texts. The seven
fresh-food sites explicitly remain supplemental produce/bakery distributions;
they are not presented as shelf-stable grocery pantries. Sealy's appointment
requirement and every-other-week limit are preserved; unpublished qualification
rules remain unknown.

A separate execution of `pointInCoverage` against the checked-in 119th Congress
GeoJSON returned true for all 12 populated new coordinates. This verifies polygon
classification of those points, not surveyed entrances. Census address interpolation
and entrance uncertainty remain disclosed. All 12 captured Census responses were independently checked: each contains one
address match and its coordinates exactly match the new record. Source spelling
variants remain visible (BVFB's Ursulaine Street matches Census URSULINE AVE;
State Highway 6 matches a frontage-road address). This review inspected captured
responses rather than repeating each remote Census request.

Three additional official-source candidates remain outside production pending
coordinate resolution: Iola Food Pantry, Bread Partners Chappell Hill Museum stop,
and Macedonia Baptist Church in Plantersville. This exclusion means “every pantry”
remains an unmet completeness claim. Further regional-directory reconciliation is
still required.

Review source access distinction: direct urllib access to Sealy returned 406; the
implementation agent's curl captures were inspected independently. BVFB and Central
Texas directory requests succeeded directly in this review. No authentication or
access restriction was bypassed.

## Integration checks

`npm run check` passed after the expansion: 41 production-site data validation,
TypeScript, 659 unit tests across 79 files, and production build. An additional
15-record admission/search check confirmed all 12 admitted sites are found by name
and the three unresolved candidates are absent from production. Database import
regressions pass at the new count, including idempotency and retained source facts.
These checks do not establish live stock, usable pedestrian entrances, or exhaustive
regional coverage.

## Follow-up coordinate review

A fresh Census query on October 25 resolved Washington Mobile Pantry's published
2310 Airline Drive, Brenham address to a unique 2310 AIRLINE DR, BRENHAM, TX 77833
match: latitude 30.145748981516, longitude -96.395642421438. Independent polygon
classification returns inside the 119th Congress TX-10 geometry. This is address
interpolation, not a surveyed church entrance. The BVFB directory currently states
first Friday 10:30 a.m.–noon and lists November 6 and December 4 distributions.

Additional source conflicts were found: Iola's BVFB listing gives 23471 FM 244 but
its Directions link targets 23365 FM 39. Macedonia Plantersville's Directions link
incorrectly opens a search for Christ Church in College Station. Neither linked
point should be substituted for the stated pickup address. Census variants for
Iola, Macedonia and Chappell Hill Museum still returned no match in this pass.

## Independent review of the 53-site expansion

The follow-up adds 12 sites: Lexington Mobile Pantry, Waldeck Mobile Pantry,
Ridgeway Baptist (Paige), Primera Baptist (Bastrop), Elgin Seventh Day Adventist,
ACC Elgin Mobile Pantry, Greater Mt. Arie (Weimar), Consider Love (Weimar), House
of Help (Hempstead), Pflugerville First United Methodist, St. Andrews Presbyterian
(Austin), and the newly resolved Washington Mobile Pantry (Brenham).

For the 11 Central Texas directory records, the review traced the official
[Find Food Now page](https://www.centraltexasfoodbank.org/find-food-now) to its
public AccessFood/Vivery locator, then independently inspected the captured
location, food-program and service-schedule responses. The public widget map ID
is `99e94cff-7fdf-4d81-8f11-5dccc11469e6`. Evidence IDs and selected raw food-program
records are retained in `data/research/fifty-tx10-candidates.json`; no authenticated
endpoint was used. Some listings belong to the shared food-bank network, so listing
in this locator does not establish Central Texas Food Bank ownership of a site.

All 11 final coordinates exactly match the directory's published latitude and
longitude. A separately executed polygon check returns inside TX-10 for all 12
additions. Washington's coordinate instead comes from the unique Census address
match described above. These are address-level points, not verified serving gates.
Names, pickup addresses, service text and schedule joins were inspected against
the captured responses rather than inferred from a map marker.

The review caught and excluded two candidates: Bellville Methodist is the same
234 S. Masonic Street distribution already listed as Bellville Christian Food
Pantry; Waller County Library's active-marked service was a children-only summer
meal program whose published dates ended July 31, 2026. It is not a current pantry.

Other checked distinctions:

- House of Help general pantry service **21928** supplies its first/third
  Wednesday and Saturday schedule. Senior-box service **21927** has separate
  age/income restrictions and dates; those are not mixed into general access.
- Consider Love uses food-pantry service **8938**, not unrelated nurse/WIC services.
  Weimar residency/income conditions and holiday schedule exceptions remain visible.
- ACC Elgin service **25653** explicitly says anyone can attend; no student-only
  restriction was inferred. Its explicit drive-through instruction is preserved,
  and pedestrian pickup requires confirmation despite generic walk-in wording.
- Primera's grocery distribution and supplemental produce distribution are distinct.
- Greater Mt. Arie's structured hours conflict with fall/winter prose. No opening
  window is generated. Waldeck, Elgin SDA and St. Andrews have ambiguous recurrence
  field encoding; their prose remains visible without invented opening windows.
- No additional St. Andrews/Wells Port record was found in existing production
  research datasets; the shared-network directory record is admitted once.

This is a source and implementation review, not an on-site visit or confirmation
of current stock. Fifty-three searchable food-assistance sites does not mean every
TX-10 pantry has been found. The three unresolved BVFB sites, provider-directory
reconciliation, current entrances, exceptions and future district boundaries remain
open coverage work. Final automated test counts belong to the main verification
report, not this source audit.

Final integration checks for the 53-site expansion: `npm run check` passed,
including production data validation, TypeScript, 660 unit tests across 80 files,
and the production build. The new admission regression checks boundary inclusion,
search-by-name, and unique IDs for the reviewed expansions. These automated checks
are separate from the independent official-source review above.
