# Map and source data audit

Audited 2026-10-17 (America/Chicago). Coordinates below identify published pantry distribution sites or GTFS stop points. They do not identify entrances, establish shelters, or verify a pedestrian route. No pantry organization was contacted, and no pantry entrance or walk was checked. All eight pantry site pins now have published source evidence; the earlier six unresolved pin investigations are closed. The remaining pantry discrepancies are listed in [the machine-readable register](../data/osm-discrepancies.json).

## Pantry discrepancies still requiring care

- **First United Methodist:** the BVFB directory says first Saturday, 11:30am–1:30pm; its named map feature says 10:30am. The church says first Saturday except game days. The user should confirm the time and game-day status for the date of travel.
- **Lincoln House of Hope:** BVFB's named feature says 1013 Eleanor Dr.; its separate Directions result says 1013 Eleanor St. Keep the named feature site point as the sourced pin and preserve the suffix mismatch for precise navigation.
- **The Salvation Army:** the provider and official locator support 2506 Cavitt Ave. and the selected locator point. BVFB says Cavitt St.; its old Directions point is nearby, while its older map feature is about 1 km away. Preserve both older map conflicts.
- **The Bridge Ministries:** the provider's current pickup page supports 304 Post Office St. and its named pantry feature; BVFB's older map location conflicts. The provider page was not independently renewed in the earlier v3 audit, so retain its published-source status and do not imply current reconfirmation.

The other four pantry pins have no unresolved site-location discrepancy in the reviewed sources. Pantry pages and directory entries were last reviewed Oct. 16. The BVFB page returned HTTP 200 on this audit and reported `Last-Modified: 2026-10-16 21:13:45 GMT` (ETag `1792185225`). The successful fetch renews page availability, not every provider's hours or service details.

## BTD GTFS freshness and limits

The official [BTD GTFS page](https://www.btd.org/2025btdgtfs/) returned HTTP 200 on Oct. 17 and linked the feed at `https://www.btd.org/wp-content/uploads/2025/01/2025BTDGTFS.zip`. That ZIP was fetched again and its SHA-256 is `d2b7948582883f6c8191d613ea3c7f80f64db48e86a467057a69725538e4825b`, identical to `data/transit/btd-2026-10-15.zip`. The upstream response reports `Last-Modified: 2026-03-25 21:33:07 GMT`; `feed_info.txt` says `Updated: Mar 25, 2026, 2:20 PM`, with service validity July 15, 2025–December 31, 2026. Thus the checked snapshot remains current as of this audit and has coverage through the end of 2026. A matching fetch does not establish that service is operating as scheduled.

The [fixed-routes page](https://www.btd.org/fixed-routes/) returned HTTP 200. Its page metadata reports modified Dec. 29, 2025; its published 2026 closure list matches the ten-date overlay recorded in `data/transit/provenance.json`. The source GTFS `calendar_dates.txt` is empty, so those closures are a separate website-derived overlay. Do not extrapolate the overlay into 2027.

The official [BCS Fixed Route Map PDF](https://www.btd.org/wp-content/uploads/2025/11/BCS_FixedRouteMap.pdf) returned HTTP 200, with `Last-Modified: 2025-11-13 19:54:37 GMT`. Existing provenance records timetable values in this PDF that differ from the GTFS. Preserve GTFS values in the current projection and flag affected journey results for confirmation; no BTD confirmation was obtained. The source date is older than the GTFS version date. Neither that difference nor the successful refetch settles which timetable is operational.

Only Route 00 Orange and six selected GTFS stop IDs are projected. Stop coordinates are copied from GTFS; they are transit stop points, not verified boarding entrances, shelters, curb access, or safe walking connections. A five-minute transfer margin is an application assumption. No newly fetched source data was imported or written into production data during this audit.

## OSM use boundary

OSM-derived maps and routing can provide geographic context, but the pantry and stop evidence above does not include OSM-verified site entrances or walking paths. Keep visible OSM attribution and follow the selected tile, geocoding, and routing service policies in [OSM-RESEARCH.md](OSM-RESEARCH.md). Do not treat a displayed path or map point as an accessibility or safety review.
