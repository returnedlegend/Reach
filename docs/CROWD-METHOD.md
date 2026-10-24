# Pantry crowd observations

Crowd reports are optional community observations. They describe what contributors reported and do not represent live occupancy. The system never infers visitor volume from opening hours.

## Collection and privacy

The API accepts a level from 0 (not busy) through 3 (very busy), with an optional wait estimate from 0 through 240 minutes. The server timestamps each report and converts that instant to America/Chicago weekday, local date, and hour. It immediately adds the report to a five-minute aggregate bucket. Buckets keep report count, level sum, optional wait sum/count, inferred staff-report count, and last update time. They contain no account, session, request, address, IP, or coordinate fields.

A persistent random secret is created in database metadata. The only per-contributor dedup value is a pseudonymous HMAC over local date, account ID, and pantry ID. It is not linked to a crowd bucket and expires within 48 hours. Treat it as short-lived pseudonymous data, not irreversible or anonymous data. One report per account per pantry per Chicago-local day is allowed. Verified accounts, active pantry records, same-origin JSON submissions, and account/global request limits are required. A verified administrator or assigned pantry manager is marked as staff by the server; callers cannot choose their source. Staff reports face the same privacy thresholds.

Reports older than 90 days and dedup hashes past their expiry are excluded from crowd summaries immediately. A GET or eligible POST also prunes expired rows. On an idle deployment, expired rows remain on disk until a scheduled prune runs; schedule `npm run data:prune` hourly or daily to keep disk retention close to the stated windows. The scheduler is an operator responsibility and is not installed by the application. The command uses the configured pantry/community SQLite database and reports only deletion counts. The secret remains in the same private database so restarts do not reset the dedup hashes.

## Historical estimate

Observations are grouped by pantry, Chicago weekday, and local hour over the latest 90 days. A bin is shown only after at least three reports on each of at least three distinct local dates. Daily deduplication means each qualifying date represents at least three distinct accounts; contributors are not linked across dates. Its category is the report-weighted mean level rounded to the nearest integer category. Wait estimates are weighted by reports that supplied a wait and are hidden until at least three wait reports appear on each of three dates. Empty or under-threshold bins have `status: insufficient` and no level, wait, or exact count.

Confidence is high at 20 or more reports across six or more dates, medium at 10 or more reports across four or more dates, and low for other bins that pass the minimum display threshold. Repeated reports on one local date cannot satisfy the date threshold. Daylight saving transitions are handled by `Intl.DateTimeFormat` in America/Chicago; repeated fall-back hours contribute to the same local hour.

Recent reports are considered separately from historical data. A current label appears only when at least three reports from the same Chicago-local date fall within the last 60 minutes, so reports around midnight cannot count the same account twice. The bucket start time determines freshness. Its label is explicitly `community observations`; old observations are not carried forward as current conditions. A recent wait estimate appears only with at least three actual wait reports in that same group.

A quieter-window suggestion remains null unless at least two supported future whole-hour bins fall inside today's verified distribution windows, closures do not block today's schedule, and one eligible hour has a uniquely lower observed crowd level. The schedule must match today's Chicago date, declare its policy known, have no source conflict, and cite current non-fictional pantry source evidence. Source IDs are resolved against the active database pantry record; replaced or removed source records no longer support a window. Appointment policy must explicitly say no appointment is required. Registration opening/cutoff and distribution cutoff times must cover the entire suggested hour. Schedule notes that signal programmed closures, closure dates, or game-day exceptions suppress recommendations. Opening hours and cutoffs only restrict possible visiting windows; they never supply or change a crowd estimate.

## Contract

`GET /api/crowd/{pantryId}` returns all seven weekdays with 24 slots each, plus the current Chicago weekday as `hourly`, a nullable `recent` observation, a nullable `quieterWindow`, and method/explanation text. `POST` accepts only `{ "level": 0..3, "waitMinutes"?: 0..240 }`. Responses use `Cache-Control: no-store`. No synthetic or seeded public reports are included.
