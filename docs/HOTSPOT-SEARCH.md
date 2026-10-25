# Community hotspots in pantry search

Approved food hotspots now join the server-owned resource list used by the main food search and its AI comparison. Existing organizer and moderator approval remain required. Nothing is copied into the maintained pantry catalog or promoted to independently verified status.

## Eligibility and labels

- Only approved hotspot records with an unexpired, valid pickup window and valid pilot-region coordinates qualify. Drafts, pending/rejected/cancelled/ended records, expired events and person-to-person offers are excluded.
- Dates are one-time event timestamps displayed in America/Chicago, not inferred weekly opening hours. A reported window does not guarantee food stock or access.
- Results are marked community-reported, with organizer-submitted requirements, food and accessibility claims labeled accordingly. Free-form contact text is not turned into a verified phone number.
- Malformed rows are skipped individually. Source links open Community listings, not a nonexistent maintained pantry detail page. Directions and map selection use the submitted coordinates; the pin is not independently verified.
- Approved hotspots require the community feature to be enabled. Existing directory searches continue to work when it is disabled.

## AI comparison

The bounded six-candidate comparison reserves up to two places for eligible matching community hotspots so confirmed-directory ordering cannot exclude all of them before the model sees them. The model receives explicit verification limitations and may rank a hotspot first. Its returned IDs must belong to that server-owned candidate set, and supporting facts are copied from supplied records; free-form generated availability claims are not displayed. Expired events are also filtered on the client when its clock updates.

This integration is for the main food-search cards, map selection and directions. It does not create verified bus connections, recurring pantry schedules, stock reports or advanced round-trip feasibility for community events. City and ZIP searches match the reported address; organizers should include the city and ZIP. Reach does not guess municipal boundaries from a point. Refresh search/page data to see newly approved or withdrawn records.

## Verification

SQLite fixture tests cover approval/status gates, malformed rows, precise coordinates, one-time dates, expired offset timestamps and maximum window length. Model-fixture tests prove approved events enter a crowded shortlist, can be selected, and are excluded when expired or incompatible with requested days. Browser fixtures use an isolated `/tmp` database and mocked AI response; no real community records or model results are invented in production. Independent Luna review rechecked the active-window labels and ran 16 focused tests successfully. Live model availability remains dependent on the configured inference service.

Final checks for this change: 677 unit tests across 77 files passed; TypeScript, data validation and production build passed. Six targeted Chromium cases passed across mobile and desktop, covering hotspot search/AI selection/map directions plus existing AI ordering and stale-comparison behavior. All synthetic listings were confined to an isolated test database and removed after each browser case. No live inference or real food availability was verified by these fixture-based checks.
