> October 16 pantry update: [Pantry research](PANTRY-RESEARCH-2026-10-16.md) and [independent v3 audit](VERIFICATION-V3.md) supersede the older unresolved-coordinate inventory below. Production records now apply `src/data/pantry-verification.ts`; its evidence supports eight distribution-site pins, with remaining conflicts visible. No Google API-derived route or geocoding content is retained in that dataset.

# Data sources and limitations

## Current coverage

On October 15, 2026, agents reviewed official website information for eight pantry listings and retrieved BTD's official GTFS and linked PDF. Initial requests had failed at the cloud proxy; later retries succeeded after network access changed. **Website review is not direct provider confirmation.** Nobody contacted providers or field-reviewed pedestrian access during this work.

| Source                                                               | What was reviewed                                                                              | Remaining limits                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| https://www.bvfb.org/find-food                                       | Eight local pantry names, addresses, phones, recurrence, conditions, and requested documents   | Holiday exceptions, coordinates, and connecting walks unreviewed  |
| https://thebridgeministries.org/get-food/                            | Tuesday appointment shopping, Thursday drive-through, contact and published access information | Thursday pedestrian pickup remains unknown                        |
| https://www.btd.org/2025btdgtfs/                                     | Official GTFS snapshot; Route 00 Orange projection                                             | Conflicts with linked PDF; no live arrivals                       |
| https://www.btd.org/fixed-routes/                                    | Weekday service and ten 2026 holiday closure dates                                             | Website overlay is separate from original feed                    |
| https://www.btd.org/wp-content/uploads/2025/11/BCS_FixedRouteMap.pdf | Linked official map and timepoint schedules                                                    | Timetable differences unresolved                                  |
| https://transport.tamu.edu/busroutes/                                | Access attempted; retry returned HTTP 503                                                      | No validated integration or rider eligibility; unsupported agency |

Map-source requests needed for pedestrian review remained blocked with HTTP 403. No route was inferred from straight-line geometry.

The eight listings are A Hopeful Harvest, Brazos Church Pantry, The Bridge Ministries Bryan, First Baptist Church of College Station, First United Methodist Church, Lincoln House of Hope, Parkway Baptist, and The Salvation Army. Records retain published service areas, pickup formats, visit-frequency rules, requested versus required documents, and known gaps. A drive-through listing alone does not establish permission or prohibition for pedestrian pickup. Pantry hours do not guarantee food stock, short queues, or admission.

## Transit snapshot

`data/transit/btd-2026-10-15.zip` is the original snapshot. Its version is “Updated: Mar 25, 2026, 2:20 PM”; declared validity is July 15, 2025 through December 31, 2026, with agency timezone `America/Chicago`. The Python importer projects 30 Orange trips at six selected stops into `src/data/btd-timetable.json`. The three selectable origins are exact stops, with no assumed walk from a home or nearby landmark entrance.

The original `calendar_dates.txt` is empty. Ten official 2026 closure dates are an explicit separate overlay: January 1 and 19, February 16, April 3, May 25, September 7, November 26 and 27, and December 24 and 25. No future holiday calendar is invented. A five-minute transfer margin is an app assumption, not a guaranteed connection.

The linked November 2025 PDF and March 2026 GTFS disagree on times. The app preserves the GTFS projection and flags the conflict. A structural import and a stop-to-stop source check do not make a complete pantry visit verified. See [GTFS import](GTFS.md) for source integrity, projection scope, and reproduction.

## Data maintenance

Real pantry records live in `src/data/real-pantries.ts`; `src/data/coverage.ts` connects them with the timetable and supported origins. `src/data/demo.ts` is fictional and separate. `src/lib/data-validation.ts` and `scripts/validate-data.ts` provide the validation workflow. The public source review is read-only.

Follow [Data review](DATA-REVIEW.md). Record the exact source, effective dates, checked date, and method; preserve conflicts and unknowns. Validate monthly recurrence, registration versus distribution windows, appointments, closures, documents, and pickup policy. Do not turn a retrieved timestamp into a provider confirmation. Recheck stale facts before publication and define a review cadence as operational coverage expands.

No explicit redistribution license was found in the GTFS snapshot; attribution is not a license grant. Check applicable terms before broader redistribution. An external booking link is not a booking integration. There is no connected real-time feed.

## What remains unverified

No pantry has a reviewed pedestrian route, and no complete real pantry itinerary meets the acceptance criterion. Real results expose this gap instead of inserting fictional walks. Demo fixtures can exercise successful plans but never count as real evidence. Saved plans are dated snapshots and may become stale.

The next priorities are resolving the BTD time conflict, reviewing one pantry walk and complete round trip, then field-checking the remaining coverage. Obtain explicit user permission before contacting any provider; none was contacted during this implementation.
