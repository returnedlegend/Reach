# TX-10 Brazos Valley pantry candidate research

Checked 2026-10-21. This research adds candidate pickup locations to `data/research/tx10-brazos-candidates.json`; it does not modify the live pantry list. The primary food-service evidence is the Brazos Valley Food Bank (BVFB) public Find Food directory, read directly at <https://www.bvfb.org/find-food>. I inspected the page HTML and its county-specific listings, not search-result snippets. BVFB identifies these as pantry or fresh-food distributions, gives actual recurring distribution hours, pickup format, service area, and visit limit. BVFB-linked Maps destinations were followed/resolved for coordinate checks where destination geometry was present. The Washington Mobile Pantry link exposes only camera center, so that candidate has null coordinates. All other coordinates use Maps destination geometry, not estimates from a street address.

## Evidence extracts

Exact relevant directory text (typographical whitespace normalized):

| Candidate | BVFB listing evidence |
| --- | --- |
| Anderson Food Pantry | “367 Fanthorp St., Anderson, TX”; “1st Thursday 9am-12pm”; serves all counties; drive-thru; monthly limit. |
| Bedias Food Pantry | “3202 Main St., Bedias, TX”; “3rd Saturday 9am-12pm”; serves Grimes County; drive-thru; twice-monthly limit; Spanish translators. |
| Caldwell Christians Care | “208 West Buck St., Caldwell, TX”; Tuesday and Wednesday 9-11:30am; serves Burleson County; walk-in; client choice; monthly limit. |
| Christian Community Services | “814 N. LaSalle St., Navasota, TX”; Mon/Tue/Thu 9-11am and 2nd Saturday 9-11am; serves Grimes County; walk-in; partial client choice; monthly limit. |
| Elizabeth Lutheran Church Pantry | “165 CR 307, Caldwell, TX”; 3rd Saturday 7:30-10am; serves Burleson County; drive-thru; monthly limit. |
| In God's Hands Ministry | “680 Lakeview Dr., Caldwell, TX”; 2nd and 4th Saturday 10am-12:30pm; serves all counties; drive-thru; monthly limit. |
| Grimes Mobile Pantry | Grimes County Expo/Fairgrounds, “5220 FM 3455, Navasota, TX”; 2nd Thursday 10-11:30am; drive-thru; serves Grimes and Washington Counties; monthly limit. Directory page links its 2026 schedule and lists the remaining Nov 12 and Dec 10 events. |
| Madison Mobile Pantry | Madison County Fairgrounds, “599 Industrial Park Ln., Madisonville, TX”; 4th Thursday 11-12:30pm; drive-thru; serves Madison County; monthly limit. Page lists Oct 22, Nov 19, Dec 17, 2026 events. |
| New Zion Food Pantry | “1505 Dansby St., Bryan, TX”; 3rd Tuesday 5-6pm; serves Brazos County; drive-thru; monthly limit. |
| Prairie Hill Food Pantry | St. John's Lutheran Church, “6605 Old Independence Rd., Brenham, TX 77833”; 2nd and 4th Tuesday 6:30-8am; drive-thru; serves Washington County; twice-monthly limit. |
| Faith Mission | “500 East Academy, Brenham, TX”; Thursday 9:30am-12:30pm; drive-thru; serves Washington County; monthly limit; Spanish translators. |
| Washington Mobile Pantry | St. Peter's Episcopal Church, “2310 Airline Dr., Brenham, TX”; 1st Friday 10:30am-12pm; drive-thru; serves Washington County; monthly limit. Its linked schedule lists Nov 6 and Dec 4, 2026. |
| Progressive Missionary Baptist Church | Pantry listing: “1013 N. Colorado St., Hearne, TX”; 2nd Wednesday 11:30am-1:30pm produce distribution and 2nd/4th Thursday 11:30am-1:30pm; serves Robertson County; walk-in; weekly limit; Spanish translators. |
| Robertson County Cares | “201 S. Calvert St., Franklin, TX”; Saturday 9am-12pm; serves Franklin ISD; walk-in; weekly limit; Spanish translators. |
| Call for Help | “110 W. 4th St., Hearne, TX”; Monday 1-4pm; serves Robertson County; walk-in; weekly limit; Spanish translators. |

BVFB explicitly lists separate details for distributions (for example, produce program hours and registration hours at First Baptist College Station elsewhere on the page). The candidate records carry distribution windows only; they do not treat an office opening or a registration time as distribution hours. Eligibility strings preserve the directory's stated service area and visit limit. Unpublished intake rules remain “unknown.” No public source gave accessibility accommodations for these new candidates, so access notes only repeat drive-through/walk-in format and mark other details unknown.

## Location checks and conflicts

Each populated coordinate source in the JSON is the Maps URL linked from that BVFB listing. Where URL data includes `!8m2!3dLAT!4dLNG`, those destination coordinates are used; the Grimes and Madison destination blocks encode longitude first (`!1dLNG`) and latitude second (`!2dLAT`). Maps target/name and BVFB's pickup address were compared. A mapping destination corroborates the physical site, not whether a pantry entrance is accessible or which entrance is used.

Additional issues: Lee Chapel’s displayed phone differs from its clickable telephone link; the dataset retains the link value and flags the discrepancy. Progressive Missionary Baptist’s BVFB public pantry listing itself publishes Wednesday produce and Thursday pantry distribution hours; both are retained. A separate fresh-produce listing gives 609 N. Colorado St., while the pantry listing gives 1013 N. Colorado St.; the conflicting address is preserved for confirmation.

One conflict was found at Bedias: BVFB says 3202 Main St., while its Directions link resolves to Google Maps' 3203 Main St. The pin is retained only as a candidate with `needs-confirmation`, and the discrepancy is explicit in its notes. For Grimes and Madison mobile distributions, Maps identifies the named county fairground while the food bank gives the event venue address; the pins are marked `needs-confirmation` because a fairground venue does not identify a particular event gate or serving point. The two Progressive Missionary Baptist listings differ: standard pantry listing says 1013 N. Colorado, while the fresh produce listing separately says 609 N. Colorado. The candidate records the standard pantry and preserves the separate listing address in its notes rather than conflating those locations.

## Scope, duplicate check, and limits

The candidate list contains 16 unique named pickup locations; none uses an address already present among the existing eight records in `src/data/real-pantries.ts` / `src/data/pantry-verification.ts`. Separate sites under one provider (e.g. mobile pantry events held at different fixed venues) remain separate entries only when BVFB identifies a distinct venue and distribution. Fresh-produce distributions are supplemental food pickup sites and are not presented as full grocery pantries.

BVFB's directory supplied the complete public service evidence available in this pass. Its linked map destinations support address-level coordinates, but there was no second independent provider page captured for each candidate, no direct provider confirmation, and no pedestrian-route review. This is why hours, capacity on a given day, appointment exceptions, and access details should be reconfirmed before an actual trip. The Census TIGER 119th-district polygon was used for point filtering: 12 pinned candidate points fall inside it, 3 fall outside, and Washington Mobile Pantry remains unclassified because its coordinate was unset. Candidate status is about the existence of an advertised pickup site, not district inclusion.
