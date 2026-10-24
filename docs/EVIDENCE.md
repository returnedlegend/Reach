# Evidence and acceptance boundary

On October 15, 2026, the official BTD snapshot was checked for these Orange stop-to-stop times:

| Segment                            | GTFS schedule             |
| ---------------------------------- | ------------------------- |
| Outbound stop 126 → stop 127       | 08:48 → 08:49             |
| Return portion stop 127 → stop 151 | 09:49 → 10:20             |
| Continue after waiting at stop 151 | 11:00 → stop 126 at 11:15 |

These values were manually cross-checked against the original GTFS ZIP. They are **schedule evidence only**. The official linked PDF disagrees with GTFS times. No pantry entrance connection was reviewed, and no pantry visit is included in this evidence. This must not be described as a validated complete real pantry round trip or a guaranteed bus connection.

Source: https://www.btd.org/2025btdgtfs/; snapshot `data/transit/btd-2026-10-15.zip`. See [GTFS import](GTFS.md) for feed validity, source integrity, calendar overlays, and scope.

The real-itinerary acceptance criterion remains unmet. The fictional demo demonstrates computed feasible, rejected, and uncertain outcomes and save/export/print behavior, but cannot satisfy that criterion. Automated checks establish software behavior on supplied inputs, not real-world accuracy. Consult executed test output and the completion report for final validation results.

## Executed software checks

- Frozen-lockfile clean install completed successfully.
- Data validation passed for eight real records and six fictional records.
- TypeScript and the optimized Next.js production build passed.
- 37 unit/integration tests passed, including recurrence, registration, holidays, return trips, transfers, extended service times, original-feed reproduction, and corrupt saved snapshots.
- 12 Playwright checks passed against the production server across 390×844 and 1280×900 viewports. These exercised the API, real uncertainty results, fictional full trips, later departures, invalid inputs, call/source links, save/reload/clear, download, print styling, and keyboard dialog focus.
- Automated axe WCAG A/AA checks passed on the tested key screens at both sizes after fixing supporting-text contrast and the mobile help button label. This is not a claim of a complete manual accessibility audit.
- Desktop, mobile, and print screenshots were visually inspected. Screenshots and traces are generated in ignored `test-results/`.

These executed checks do not remove the real-world acceptance boundary described above.
