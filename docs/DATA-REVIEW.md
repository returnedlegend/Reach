# Data review before publication

Production contains eight website-reviewed pantry records and a limited BTD Orange GTFS projection. It does not contain reviewed pantry walking connections or a verified complete pantry trip. Demo data is explicitly fictional and must never be copied into real coverage.

Use reviewed data-file changes; the public source view cannot edit records. Maintain `src/data/real-pantries.ts` and `src/data/coverage.ts`, reproduce the timetable with `python3 scripts/import-btd.py`, and follow [GTFS import](GTFS.md) when changing feed inputs. Preserve the original ZIP and provenance. A new feed requires renewed editorial review; the old checked date must not masquerade as verification of new contents.

For each pantry, retain HTTPS source URLs, titles, checked dates, and verification method. Website review and provider confirmation are different. Preserve disagreements in `conflictingSources`, transit uncertainties, or `missingInformation`. Separate registration opening/cutoff from distribution times. Record recurrence precisely, appointments, closures, service area, visit frequency, requested versus required documents, language/accessibility claims, and pedestrian pickup. Do not infer walk-up rules from drive-through availability.

Check BTD agency identity, timezone, feed validity, service calendars, exceptions, stop sequences, and chronological times. Keep the ten website-derived 2026 closure dates distinct from the empty original GTFS exception file. Resolve the GTFS/PDF time discrepancy before removing its warning. The current five-minute transfer margin is a planner assumption. Additional agencies require verified data, rider eligibility, and a complete tested journey.

Only set a walking connection's `reviewed` flag after reviewing an actual pedestrian path, its entrance, distance, duration, crossings, and barriers. Coordinates alone cannot establish a safe walk. The three real starting points are exact bus stops; their zero-length boarding connection says nothing about reaching them from home. Synthetic fixture flags mean fixture review only.

Run `npm run data:validate`, `npm test`, `npm run typecheck`, and relevant browser tests. Inspect generated diffs and provenance. Add focused tests for newly supported recurrence and cutoff behavior. Then manually cross-check both directions of a real trip against current source material, including provider windows and walk access. Automated validation does not establish real operation, food availability, eligibility, or accessibility.

A second reviewer should compare factual edits with their original sources before publication. Define a refresh cadence and retain dated review notes without private contact details. Obtain explicit permission before contacting providers; no provider contact or direct confirmation occurred in this work. Do not claim the MVP complete until a real pantry round trip has been demonstrated and its remaining uncertainty disclosed.
