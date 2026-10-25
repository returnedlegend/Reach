# Distance-first pantry comparison — October 25, 2026

Reach supplies up to three matching options without waiting for a model. If fewer
than three records satisfy the geographic/service filters, it says so instead of
inventing results or silently ignoring the requested area.

## Numeric ranking
Each eligible record gets:
- Distance: 60 / (1 + straight-line miles).
- Pickup schedule: 25 / (1 + days until the next published pickup).
- Evidence: 15 for a confirmed maintained pickup site; 10 for an approved
  community listing.

Unknown distance and schedule earn zero in that component and remain labeled
unknown. These are preference points, not probabilities, routed distances or a
guarantee of opening hours, eligibility, food stock or travel feasibility.
Actual selected coordinates are used server-side. Only rounded distance and score
components reach the AI, not raw origin coordinates or private household addresses.
Household offers have only approximate areas, so exact distance remains unknown.

Explicit city/ZIP/service filters apply first. Unsupported or expired community
records and known walking prohibitions remain excluded. With a selected origin,
nearby approved hotspots compete with maintained sites instead of being buried
behind them. No-location browsing includes the regional directory, not just Bryan.

## AI and resilience
The six-candidate model request includes numeric distance, score components,
published schedules, requirements and uncertainty. Two candidate slots are
reserved for approved community options where available. A valid model response
breaks equal-score ties; it does not override a higher mathematical score.
Partial responses are filled from eligible mathematical matches up to three.
Invalid IDs, duplicates, provider failure or an empty response use mathematical
results, labeled directory assistance. Only IDs actually returned by a valid model
are labeled AI-compared. Invented prose is never displayed as provider facts.

The UI shows mathematical comparisons immediately, refreshes server directory
data on AI search, and expires model comparisons after one minute. Existing
privacy, explicit AI choice, release controls and rate limits remain. No external
provider call is required to return local mathematical matches.

## Scope
No BTD integration or bus-schedule fallback is required by discovery. Public
transit directions open Google Maps to calculate a trip separately. Existing
walking/driving routing remains optional. Historical advanced transit code and
tests are retained, but are not a claim of live integration.

The maintained directory has 29 pantry sites; approved, unexpired food hotspots
and extra-food offers are added from the same private SQLite database at runtime.
Only a moderator can approve them; pending submissions do not appear.
