# Volunteer donation coordination

The pilot coordinates transport of an existing moderated food offer to an existing active pantry. It uses the shared SQLite database and the existing account and pantry-manager assignments. Enable it with `REACH_COMMUNITY_ENABLED=true`; no volunteer role or manager access can be self-granted.

A verified donor selects one of their approved, unexpired food offers and a pantry. The whole offer becomes reserved while the pantry reviews the pending run. An assigned verified pantry manager or verified administrator other than the donor approves it to `open`, or declines it to `cancelled`. A verified volunteer who has explicitly enabled volunteer participation can claim an open run with `pickupConsent:true`. A donor or manager cannot claim their own run. An assigned volunteer can release the run; the donor or pantry manager can cancel it. The donor or pantry manager explicitly confirms completion after the pickup window starts. Completion ends the original food offer. Pantry inventory is not fabricated or automatically incremented.

Only one pending/open/assigned run may reserve an offer. Only one run may be assigned to a volunteer at a time. SQLite `BEGIN IMMEDIATE` and partial unique indexes enforce these invariants. A new run requires no existing requested or accepted recipient requests. Existing community discovery, photos, new food requests and request acceptance hide or guard reserved offers. Offers without volunteer runs keep their existing moderated recipient-pickup workflow. Declining or cancelling a run makes the unchanged food offer available again if it remains approved and unexpired.

## API

Browser-safe response types live in `src/lib/volunteer-types.ts`. All responses are `no-store`. Mutations require the shared account cookie, a verified email, same-origin JSON and strict payloads. The persistent mutation limit is 60 per account per hour.

| Method and path                      | Body / result                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/volunteer`                 | Public `{runs: VolunteerRun[]}`, open approved unexpired offers at active pantries; signed-in block filtering                       |
| `GET /api/volunteer/mine`            | `{runs: ManagedVolunteerRun[], participationEnabled, emailVerified}` for donor, assigned volunteer or verified pantry manager/admin |
| `GET /api/volunteer/eligible-offers` | Verified donor's unused approved unexpired offers `{offers: EligibleVolunteerOffer[]}`                                              |
| `POST /api/volunteer`                | `{offerId,pantryId}` → `{run}`, 201                                                                                                 |
| `POST /api/volunteer/:id/approve`    | `{}`; separate assigned pantry reviewer opens pending run                                                                           |
| `POST /api/volunteer/:id/decline`    | `{}`; separate assigned pantry reviewer cancels pending run                                                                         |
| `POST /api/volunteer/:id/claim`      | `{pickupConsent:true}`; eligible verified opted-in volunteer claims once                                                            |
| `POST /api/volunteer/:id/cancel`     | `{}`; donor/manager cancels; assigned volunteer releases                                                                            |
| `POST /api/volunteer/:id/release`    | `{}`; assigned volunteer releases to open, or cancelled if expired                                                                  |
| `POST /api/volunteer/:id/complete`   | `{}`; donor/manager explicitly confirms assigned run after start                                                                    |
| `GET /api/volunteer/:id/pickup`      | `{instructions,area}` with private authorization                                                                                    |

Public run data contains food safety information, quantities, approximate pickup area and pantry identity. It contains no donor/volunteer identities, email addresses or private pickup notes. The private dashboard adds participant ids and server-computed action flags. Exact pickup instructions are available to the donor, or the assigned verified participating volunteer with explicit claim consent and the donor offer's `sharePickupInstructions` enabled. The run and offer must still be active, with no relevant block. Pantry managers cannot read these instructions merely by managing a pantry. Blocking participants or assigned pantry managers prevents discovery/claim/private pickup. Cancellation and release remain possible after a block.

## Persistence and account deletion

`initializeVolunteerSchema(db)` uses only `DatabaseSync`; initialize after shared community/account and pantry schemas. `migrations/volunteer-001.sql` mirrors its additive schema. The API uses `openPantryDatabase`, preserving the existing database path and file protections. Community guard helpers avoid a pantry/community import cycle and work when volunteer tables have not yet been initialized.

Run foreign keys cascade when the donor, original offer or pantry is deleted. Before deleting an assigned volunteer, a trigger releases their assignment to open, clears pickup consent and removes their id; ordinary account/session/token cleanup continues through the existing account handler. Historical completed/cancelled volunteer ids become null on deletion. Archiving a pantry or ending/removing an approved offer cancels active runs. Expiry removes public/claim/pickup availability; a participant may still cancel an expired run.

## Notifications

Business transactions queue metadata through the shared notification outbox, with a stable run id plus revision and event kind for deduplication. They never perform network delivery. Pantry managers receive optional pantry-category donation/review/status notices. Donors and assigned volunteers receive optional pickup-category assignment/completion/cancellation notices. Existing direct community request transitions also queue pickup notices. Addresses, private pickup instructions and freeform bodies never enter these events.

## Validation

`npx vitest run tests/volunteer.test.ts tests/community.test.ts` exercises real handlers and temporary SQLite databases: pantry review, verified participation, strict consent, simultaneous claim conflict, independent-connection uniqueness, recipient request conflicts, public/private serialization, blocks, release/cancellation, completion start-time checks, account deletion and pantry archival. Existing moderated community tests remain in that run.
