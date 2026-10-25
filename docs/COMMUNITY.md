# Development community pilot

This local development pilot adds persistent accounts, moderated food-distribution hotspots, and person-to-person offers to Reach. It is disabled by default in development and production. Normal `npm run dev` respects `REACH_COMMUNITY_ENABLED` in the environment or `.env.local`; use `false` to turn it off. Only the explicit `npm run dev:community` command forces it on for that local process. It is not an emergency service, a verified food source, or a production-ready community network. No accounts, organizations, events, meeting places, or offers are seeded.

Use Node 24 (the built-in `node:sqlite` DatabaseSync API is required):

```sh
npm ci
npm run dev:community
```

`REACH_COMMUNITY_DB` selects an SQLite file; the default is `.local/community.sqlite`, relative to the application working directory. Keep `.local/` out of version control. Store this directory on a durable, private, single-host filesystem. The database contains password hashes, session hashes, reports, private pickup instructions, and photographs. SQLite uses foreign keys, WAL, FULL synchronous durability, a five-second busy timeout, and immediate transactions. Keep the database, WAL, and SHM files together; use SQLite's backup API or stop the application before copying the complete database. Ephemeral/serverless disks and multiple application hosts are unsupported.

Set `REACH_COMMUNITY_ORIGIN=https://your-canonical-host.example` behind an HTTPS reverse proxy. It must be the exact origin, without a trailing slash. Without this variable, the server checks mutation Origin against the direct, validated Host header and request protocol. It never trusts forwarded host, protocol, or client-IP headers. Every mutation requires the same Origin and application/json, including logout and login. HTTPS sessions receive Secure cookies. Use HTTPS for any shared deployment.

Create a moderator explicitly; the CLI accepts the password through an environment variable or piped standard input, never an argument:

```sh
# Supply REACH_COMMUNITY_ADMIN_PASSWORD through your shell's secret-input facility.
npx tsx scripts/community-admin.ts create-moderator moderator_username
```

Usernames use 3–32 lowercase letters, digits, or underscores; passwords require 12–128 characters. Registration requires an explicit age-18-or-older affirmation. Passwords use independently salted scrypt hashes. Seven-day opaque sessions are stored as SHA-256 hashes and sent only in HttpOnly, SameSite=Strict cookies. Logging out revokes that session. Global and username/account attempt limits are stored in SQLite, independent of spoofable client-IP headers. A moderator is never created through signup or a role field.

## Food hotspot access

Use the home-screen **Food hotspots** shortcut or open `/food-hotspots`. Browsing needs no account. The shortcut preserves the selected origin and guided-flow answers. **Create Food Hotspot** opens sign-in when needed and returns to hotspot creation afterward. Residents can request organizer approval; only approved organizers or moderators can create drafts. Publication still requires review by another moderator. This access shortcut does not grant roles.

## Publishing and pickup

Residents may submit offers and request organizer status. Moderators approve organizers. Only an approved organizer or moderator can create a hotspot. Drafts and rejected records may be edited; publishing always requires submission followed by another account's moderator approval. Owners cannot edit or replace photos on approved content to bypass review. They can cancel or end a listing. Moderators can remove any reported listing, cancelling pending and accepted requests, then resolve the report with an audit reason.

Hotspots contain deliberately public organizer/contact/address/map information and pickup windows. A moderator must verify permission to publish it, confirm that the venue is a real authorized public distribution location, and review all details before approval. Coordinates are bounded to the Bryan/College Station region. Reach does not invent host sites or claim to verify them automatically.

Offers accept only canned groceries, dry groceries, or sealed snacks that are manufacturer-sealed, shelf-stable, and non-homemade, with explicit undamaged-package, readable original ingredient/date labels, not-recalled, and no-excluded-products affirmations. Infant formula, supplements, and alcohol are excluded. These categories and affirmations support human moderation; they are not automatic inspection or proof of safety. Listings require allergens, storage instructions and a valid use-by date that covers the pickup window in America/Chicago. They cannot accept user coordinates or a public pickup address. Public maps use only fixed approximate city centers for Bryan and College Station. These centers are broad geographic labels, **not actual pickup sites or recommended meeting places**.

Offer pickup instructions must describe an agreed public meeting place, never a home or private address. They are excluded from public discovery, moderation queues, and request summaries. An owner can see their own instructions. A recipient can retrieve them only after the owner accepts their request, the recipient has explicitly consented, the owner has explicitly enabled sharing, the offer remains active, and neither participant has blocked the other. Moderator status does not grant access to those instructions. No private-location coordinates are accepted or geocoded. Do not put private addresses, contact details, or identifying information in any public title or description.

A request reserves the complete offered quantity, rather than an individual portion. Several residents can request an offer, but an immediate transaction and unique partial database index permit one accepted reservation. Reserved offers disappear from public discovery. The owner or accepted recipient can confirm collection; it ends the offer and closes the other requests. Cancelling an accepted request releases the reservation while the offer remains available. Duplicate requests by the same account are rejected. Blocking cancels active requests between the participants and hides their listings from each other's signed-in discovery. Public listings remain public to signed-out visitors.

Pickup windows last at most 24 hours and begin no more than 30 days ahead. Expiry is computed during discovery, moderation approval, requests, collection, and private-detail access; it needs no background job. ISO timestamps are UTC; printed food use-by dates are interpreted as calendar dates in America/Chicago. Reporting creates a moderator queue item; resolving it removes the active queue item, archives the full report, and retains an audit event. The latest 1,000 resolved reports are retained. The latest 1,000 audit events are retained; moderator responses show the latest 100.

Optional photos are stored as SQLite bytes under opaque record IDs, never uploaded filenames. Uploads are owner-only on editable drafts. The image sanitizer enforces 2 MB / 8 megapixel source limits, decodes/re-encodes JPEG, strips metadata, and rejects unsupported inputs. Reads require an eligible public listing, ownership, or moderator access. All media responses use no-store and nosniff. Photo privacy still requires human review for faces, labels, street signs, and other identifying content.

## API

All paths below start with `/api/community`. Errors include a human-readable `{error:string}`. When Community is switched off, HTTP 503 also includes `code: "community_disabled"` before database initialization. Clients should use that stable code for the disabled screen instead of matching the error wording; other structured 503 errors remain service failures. Legacy no-code disabled responses remain supported. The feature returns 503 when `REACH_COMMUNITY_ENABLED` is not exactly `true`; unsupported methods return 405 when enabled. Read endpoints use no-store. Normal JSON bodies are limited to 8 KB; photo JSON bodies to 3 MB.

| Method | Path                                                      | Body / result                                                                |
| ------ | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/discovery`                                              | `{mode:'development',pickupAreas,hotspots,offers}`; public redacted listings |
| GET    | `/me`                                                     | `{user,organizerRequested}`                                                  |
| POST   | `/auth/signup`                                            | `{username,password,adultConfirmed:true}` → `{user}` + session cookie        |
| POST   | `/auth/login`                                             | `{username,password}` → `{user}` + session cookie                            |
| POST   | `/auth/logout`                                            | `{}`; revokes session                                                        |
| GET    | `/mine`                                                   | Own records and incoming/outgoing request summaries                          |
| POST   | `/organizer-request`                                      | `{}`                                                                         |
| POST   | `/hotspots` or `/offers`                                  | Full `HotspotDraft` / `OfferDraft` from `community-types.ts` → `{record}`    |
| PATCH  | `/hotspots/:id` or `/offers/:id`                          | Full draft; owner only                                                       |
| POST   | `/:kind/:id/submit`, `/cancel`, `/end`                    | `{}`; kind is hotspots/offers                                                |
| POST   | `/:kind/:id/photo`                                        | `{dataUrl}`; owner editable draft only                                       |
| GET    | `/media/:recordId`                                        | Authorized sanitized image bytes                                             |
| POST   | `/offers/:id/request`                                     | `{pickupConsent:true}` → `{id,status}`                                       |
| POST   | `/requests/:id/accept`, `/decline`, `/cancel`, `/collect` | `{}`; role/ownership/status checked                                          |
| GET    | `/requests/:id/pickup`                                    | `{instructions,area}`; private consent checks                                |
| POST   | `/reports`                                                | `{targetType: hotspot / offer / user, targetId, reason}`                     |
| POST   | `/blocks`                                                 | `{userId}`                                                                   |
| GET    | `/moderation`                                             | Pending listings/organizers, reports, audit; moderator only                  |
| POST   | `/moderation/:kind/:id/approve` or `/reject`              | `{reason?}`; kind hotspots/offers/organizers                                 |
| POST   | `/moderation/:kind/:id/remove`                            | `{reason}`; kind hotspots/offers                                             |
| POST   | `/moderation/reports/:id/resolve`                         | `{reason?}`; retains reason in audit                                         |

## Before production

Production release is blocked on verified email/contact ownership, password recovery and account lifecycle controls, abuse-resistant signup beyond this global limiter, durable hosting/backups and restore drills, trained staffed moderation and incident response, and legal review of food safety, liability, privacy, age policy, and retention. The current global limiter deliberately favors a small trusted development pilot and can be exhausted by one abusive visitor. It is not a public-scale abuse prevention system. There are no delivery, payment, chat, notification, nutritional guarantee, or emergency-service features. Manual moderation and user affirmations cannot establish food safety.

Run `npx vitest run tests/community.test.ts tests/community-photo.test.ts` for backend security, privacy, status, transaction and image checks. HTTP/browser integration is checked separately against Next because its request URL may use the bind hostname.

## Assign exactly one moderator

A trusted server operator can make an existing, email-verified account the sole community moderator:

```sh
npm run community:admin -- set-sole-moderator owner@example.com
```

Run this on the same server/database used by Reach. If the application uses a custom database, explicitly set `REACH_COMMUNITY_DB` to that path for the command. The CLI uses the process environment and defaults to `.local/community.sqlite`; it does not automatically load `.env.local`.

The command refuses missing or unverified accounts without changing roles. It atomically promotes the target, demotes other community moderators to residents, revokes their sessions and records an audit entry. It preserves accounts and posts; pantry administrator/manager roles are separate. Ordinary registration never grants moderator access. Sign in through the verified email identity (including configured Google sign-in) first. As with other privileged local tools, a server operator can change this assignment later.

Hotspots remain available with organizer approval and moderator publication review. A moderator cannot approve their own submission; with a single moderator, other approved organizers submit posts for that moderator to review.

Approved, unreserved household offers and approved hotspots now join main food search and AI comparison. [Privacy rules, moderation and UI details](HOUSEHOLD-SEARCH.md). Both still require moderator approval.
