# Independent review of the next TX-10 expansion

Reviewed October 25, 2026. This review concerns selected researched food-assistance sites, not exhaustive coverage or live food availability. The boundary is the checked-in 119th Congress TX-10 polygon (2025–2027).

## Residual locator audit

Independently executed `pointInCoverage` on the 80 unique location IDs in the four captured public locator responses `/tmp/ctfb-sites.json`, `ctfb-sites1.json`, `ctfb-sites2.json`, and `ctfb-sites3.json`. Exactly 26 points classify inside; this reproduces `/tmp/ctfb-inside.json`. These captures are a bounded search result, not a complete regional inventory.

Compared those 26 locations with the prior research datasets and the existing coverage audit. Four unadmitted location records need service evidence before admission:

| Location ID | Lead | Published pickup/address candidate |
| --- | --- | --- |
| 19929 | Meals on Wheels Rural Capital | 106 Royston Street, Smithville |
| 48288 | Smithville Community Garden | 107 SW 2nd St, Smithville |
| 28252 | Park at Clear Creek | 111 Clear Creek St, Hempstead |
| 19429 | Cambridge Villas Apartments | 15711 Dessau Rd, Pflugerville |

The prior captured service and service-schedule responses contain none of these four IDs. A location marker alone therefore does not establish a current food distribution, public access, or a schedule.

Previously blocked distinctions remain applicable:

- Bellville Methodist location 16745 at 234 S Masonic St duplicates the existing Bellville Christian Food Pantry pickup address; a different locator name is not a new pickup site.
- Waller County Library location 28251 was an expired children-only summer meal program, ending July 31, 2026. An active flag alone does not make it current.
- Bastrop County Emergency Food Pantry location 19446 lists 806 Fayette Street, whereas the maintained provider research uses 1201 Pine Street. This is an address conflict requiring reconciliation, not evidence for a second pantry.
- The Elgin locator explicitly supplies 303 N. Avenue C. Resolving its existing uncertain pin would improve an existing record, not increase the number of distinct sites.
- Iola, Chappell Hill Museum and Macedonia Plantersville remain unresolved in prior BVFB research. Wrong or conflicting Directions links must not be substituted for verified pickup points.

## New candidate review

The expanded public locator query captured 45 pages (`/tmp/sixty-page-0.json` through `sixty-page-44.json`). Independently replayed all pages: **882 unique location IDs, 39 inside the polygon**. This describes that query, not every pantry in the region.

Independently compared all 13 candidates in `data/research/sixty-tx10-candidates.json` against `/tmp/sixty-inside.json`, `sixty-services.json`, and `sixty-schedules.json`. Each retained raw location matches exactly; all coordinates exactly equal the locator coordinates. Each selected service is a food program joined to the correct location ID, and every retained schedule belongs to that selected service. A separate execution of `pointInCoverage` returns inside for all 13. These are published address-level points, not verified serving entrances.

| New listing | Location / selected service ID | Review distinction |
| --- | --- | --- |
| Smithville Golden Harvest | 19929 / 26063 | Adults over 60; eligibility process; ID, address and income requested |
| Smithville Community Garden CSFP | 48288 / 58836 | Same age/eligibility restrictions; senior groceries, not unrestricted pantry |
| Cambridge Villas CSFP | 19429 / 25411 | Restricted senior groceries; host-resident access unverified; leasing hours are unrelated |
| New Prairie View Baptist | 17042 / 22148 | Produce-focused mobile service; separate senior service 22149 excluded |
| St. Vincent de Paul Round Rock | 19410 / 25384 | Provider confirms Building 7 and arrival phone call |
| Colorado County Mobile, Eagle Lake | 6668 / 8392 | Church street is in address2: 200 W Prairie Ave; call to register; Colorado County service area |
| Eagle Lake Food Pantry | 6690 / 8414 | 527 N Lake Ave is distinct from mobile church pickup; Colorado County service area |
| Hangar Unity Center | 17209 / 22363 | Produce-focused mobile service |
| Reveal Resource Center | 19358 / 25630 | General pantry schedule distinct from senior service 25629 |
| Brookshire-Pattison Food Pantry | 16765 / 21844 | Food service distinct from benefits assistance at the same address |
| Lake Travis Crisis Ministries | 19388 / 25360 | Provider limits service to people living or working in Lake Travis ISD |
| Travis County Community Center, Jonestown | 19430 / 25412 | Published weekday hours retained with pickup/midday-closure confirmation caveat; no generated opening windows |
| Helping Hands, Spicewood | 19463 / 25455 | Tuesday food-distribution service; direct provider URL unavailable |

No new candidates share a pickup address with an existing admitted site or another candidate. Ordinal values placed in the locator's `daysOfMonth` field remain ambiguous: Cambridge, New Prairie View, Colorado County Mobile, Eagle Lake, Hangar and Reveal retain visible source wording without generated recurrence. Brookshire's separate evening ordinal row is also not modeled. Reveal's weekly Monday/Tuesday senior-box schedule is not assigned to the general pantry.

## Direct provider cross-checks and corrections

Fresh direct requests to [St. Vincent de Paul Round Rock](https://svdprr.com/) and [Lake Travis Crisis Ministries](https://ltcrisisministries.org/services) succeeded. Temporary captures are `/tmp/review-provider-19410.html` and `/tmp/review-provider-19388-services.html`.

- Round Rock confirms Monday/Friday 9 a.m.–noon, Building 7 on St. William's campus, and calling 512-255-2330 on arrival. Its parish-boundary statement is broader than the locator's generic “anyone” wording; the final candidate preserves the restriction uncertainty instead of promising unrestricted access.
- Lake Travis confirms Wednesday 5–7 p.m., Thursday 10 a.m.–noon, Suite 100, and no appointment for food visits. Its service page explicitly serves people living or working in Lake Travis ISD; this replaces the locator's generic unrestricted wording. The provider's ZIP lists differ between sections, so school-district eligibility is the controlling description rather than an inferred ZIP boundary.
- Reveal's provider request returned HTTP 403; Helping Hands' published website returned HTTP 404. Those failures do not establish closure. Their food-service evidence comes from the captured public locator.
- The county Jonestown community-center page returned HTTP 403. Its food-service schedule could not be corroborated as pickup rather than office hours; the record keeps the published text with a confirmation caveat and no generated opening windows.
- Cambridge's provider website describes apartment amenities and leasing-office hours, not a food pickup schedule. No leasing hours were imported.

## Excluded and unresolved leads

The expanded capture resolves the original four residual leads: the three older-adult food programs are admitted with restrictions, while Park at Clear Creek (28252 / 35976) is a summer children-only congregate meal program ending August 7, 2026 and remains excluded. CY-Hope (28230 / 35954) also ended August 7. AccessHealth Brookshire (28141 / 35858) describes summer-only children meals without evidence of a current October pantry. United Way Waller County (21462 / 27958) provides benefits application assistance, not food pickup, and shares the Brookshire-Pattison address.

The prior Bellville duplicate, Waller Library expired summer program, Bastrop address conflict and unresolved BVFB leads remain coverage work. No organization was contacted and no entrance or live stock was verified. This source review supports 13 additions to the prior 53 listings; it does not establish exhaustive coverage or current availability. Automated integration results belong to the main verification report.
