# Account, pantry authorization, and crowd verification

> Historical verification report: its implementation and transport references describe the pre-Resend code at the time these checks ran. Current production email uses the server-side Resend SDK; see [Resend setup](RESEND.md) and [current Resend verification](RESEND-VERIFICATION.md). The findings below remain evidence of those earlier local checks, not of the current provider integration.

This report records local implementation checks. It does not certify a public deployment or a working external email service. No email was sent to an external recipient during these tests, and the site was not deployed.

## Architecture decision

Reach already had Node 24 SQLite storage, community users, moderation roles, and hashed sessions. The implementation extends that database and preserves existing user IDs, community roles, and their relationships. SQLite remains appropriate for one application host with a durable private filesystem. It is not a shared database for independently deployed replicas or ephemeral serverless instances.

Supabase Auth and PostgreSQL are compatible with the frontend stack, but introducing them requires an external project and an explicit migration of existing identities and data. No such credentials are available. Better Auth is another maintained SQLite-compatible option; replacing the established session and password schema would require a separate migration. At the time of this report, custom authentication used maintained Argon2id and SMTP libraries. The current mail transport uses the Resend SDK; ongoing authentication maintenance remains the application's responsibility.

New passwords use `@node-rs/argon2` Argon2id with unique salts, 19 MiB memory, two iterations, and one lane. Legacy scrypt hashes remain readable and are upgraded only after a successful login. Existing username accounts continue to work through the community interface. A signed-in legacy account can attach an email only after password reauthentication and recipient confirmation; a separate scoped, expiring claim preserves the existing identity and roles and cannot merge with another account that owns the address.

Account sessions are random 256-bit values; only their SHA-256 hashes are stored. Cookies use HttpOnly, SameSite=Strict, root path, a seven-day lifetime, and Secure for the configured HTTPS origin. Login/logout also expire the old community-scoped cookie. Email verification and reset tokens are random, hashed, purpose-bound, expiring, and consumed in transactions. Verification links last 24 hours; recovery links last 30 minutes. Password changes and resets invalidate every existing session and outstanding account token.

Email links use the configured canonical origin and URL fragments. The account page removes the fragment immediately, including subsequent links opened in the same document, and keeps its token in component memory. It uses a no-referrer policy and requires explicit confirmation before consuming a verification link.

## Security issues addressed

- Separate pantry administrator and per-pantry manager permissions preserve the distinction from existing community moderators and organizers. Privileged pantry operations require a verified email; users cannot assign their own roles or edit another manager's pantry.
- Email registration/recovery responses do not disclose account existence. Eligible and ineligible addresses both pass through the mail transport; the latter receives neutral information, so transport failures also produce matching status and body. Login errors are generic.
- Strict schemas reject extra role, identity, and verification fields. Protected writes require same-origin JSON requests, bounded request bodies, and server-side permissions. SQL values use bound parameters. Pantry links accept HTTP/HTTPS URLs and reject executable URL schemes.
- Pantry edits use optimistic version checks. Archive operations require the pantry name, hide the listing and its favorites from public views, preserve history, and can be restored.
- Schedule source IDs retain their original identity only while the matching evidence URL remains in the current record. Added evidence receives an ID derived from its URL (or title when no URL exists), so reordering sources cannot relabel old references and replacing a source does not silently validate an old schedule. Computed source mappings are excluded from stored user-editable fields. Moving a pantry's address or coordinates also removes its old walking connections from active planning pending a new review.
- Deletion reauthenticates with the password, removes account/private-location/session/photo/community relationships, and leaves pantry corrections and administrative records with nullable actor references. Independent tests verify foreign-key integrity and preservation of unrelated accounts.
- Independent crowd review found and corrected a pattern that one recurring contributor could previously publish, duplicate counting across local midnight, and incorrect wait weighting. Historical bins now require at least three distinct daily contributors on each of three local dates. Recent observations require three contributors from the same local date within 60 minutes. Wait estimates have their own contributor thresholds and use actual wait-report counts.
- Browser verification identified and corrected account origin comparison against Next's rewritten local URL, token extraction missing same-document fragment changes, and password helper text being included in a field's accessible name.

## Tests actually run

The pre-change baseline `npm run check` passed data validation (six demo and eight production pantries), TypeScript, 184 tests across 13 files, and a production build.

Independent post-change command:

```sh
npx vitest run tests/account-security.test.ts tests/pantry-security.test.ts tests/crowd-security.test.ts
```

Result: **22 tests passed across three files** (11 account, five pantry, six crowd). These tests invoke the actual account/pantry handlers, Argon2id implementation, and crowd store against isolated temporary SQLite databases. Email transport is injected as an in-memory sink or deliberate failure; token values never leave the test process. Coverage includes:

- Email normalization, Argon2id hashes, hashed tokens, mass-assignment rejection, and matching recovery/registration responses during a mail transport outage.
- Verification/reset purpose separation, replacement, expiry, concurrent one-time consumption, password/session revocation, and legacy identity migration.
- Legacy email claims require both password reauthentication and recipient confirmation, preserve user IDs/roles, expire, cannot reset passwords, are revoked by password changes, and cannot take over an address registered by another account during a pending claim.
- Cookie boundaries, canonical-origin link generation, cross-origin rejection, private-location ownership, and deletion across legacy and new foreign keys.
- Community moderator exclusion, unverified administrator exclusion, manager ownership/revocation, archive/restore visibility, executable URL rejection, stale edits, and correction review permissions.
- One-person recurring history, midnight duplicate counting, wait-report weighting, daylight-saving fall-back deduplication, stale data, short-lived dedup expiry, archived-pantry reporting rejection, and early cancellation of an oversized chunked HTTP body without a Content-Length header.

The account deletion test was additionally rerun after adding private photos, preferred locations, pantry favorites, assignments, corrections, and audit references: **8 account security tests passed**.

Browser command against the running development server:

```sh
REACH_TEST_URL=http://127.0.0.1:3060 npx playwright test tests/account-verification.spec.ts --project=mobile --project=desktop --workers=1 --output=/tmp/reach-account-browser-results
```

Result: **6/6 passed**, three cases each at mobile 390×844 and desktop 1280×900. Checks exercised the actual account API for invalid link consumption, fragment removal on initial and same-document navigation, explicit verification action, password reset form, the then-current absent-SMTP messaging, public pantry details, and anonymous management gating. Account screens had zero axe violations and no horizontal overflow at both sizes. These checks do not claim a successful external email delivery.

An additional test ran against the final production build through the isolated local HTTPS proxy. Its reproducible form is:

```sh
REACH_TEST_URL=https://localhost:3131 REACH_TEST_LOCAL_TLS=true REACH_ACCOUNT_TEST_DB=/tmp/reach-account-browser/data.sqlite npx playwright test tests/account-management-live.spec.ts --project=mobile --project=desktop --workers=1 --output=/tmp/reach-real-management-results
```

Result: **2/2 passed**, mobile and desktop. This test creates a uniquely named, offline-verified administrator fixture in the isolated database, then uses the real browser forms and actual API/database for login, Secure/HttpOnly session cookies, profile preferences, favorites, pantry creation and editing, inventory, archive/restore with anonymous visibility checks, password change and reauthentication, retained preferences/favorites, and account deletion. It removes only its own fixture user/listing afterward. No API responses are mocked and no email is sent. `REACH_TEST_LOCAL_TLS=true` is an explicit exception for the local test certificate; it affected only that test server's certificate handling. Current Resend API calls use verified HTTPS. The test is skipped unless an isolated database path is explicitly supplied.

The final integrated `npm run check` passed data validation, TypeScript, **251 tests across 20 files**, and a production build. The primary agent additionally reported **188 existing browser regression checks passed** across four viewports, and **28 new feature checks passed against the final production build** across those viewports. The two independently run real account/management lifecycle cases above supplement those checks.

## Configuration and remaining limits

This historical verification report predates the Resend migration. Current production mail requires `REACH_EMAIL_PROVIDER=resend`, `REACH_APP_ORIGIN` set to the canonical HTTPS origin, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` on a verified Resend domain. See [Resend setup](RESEND.md) for current configuration. No provider credentials or DNS have been configured here; live delivery and inbox-link completion remain unverified. Without valid transport configuration, the UI reports that registration/verification/recovery are unavailable; existing accounts can still sign in.

Store `REACH_COMMUNITY_DB` on a private persistent volume, keep backups, and use the documented local administrator bootstrap for an existing verified account. Public HTTP APIs cannot grant administrator access. Multi-host operation needs a shared database and distributed request limiting. Current persistent global rate limits are a backstop and can be exhausted by an attacker; an ingress limiter should enforce trusted client boundaries before public deployment. Email verification increases the cost of duplicate accounts but cannot establish that accounts represent distinct people.

Crowd storage contains aggregate buckets without account IDs. Temporary HMAC deduplication values are pseudonymous, not irreversible anonymous data: the database also holds the secret and account identifiers. Deduplication records expire within 48 hours; historical buckets stop contributing after 90 days. Expired rows are pruned on subsequent crowd requests or by `npm run data:prune`. There is no hard wall-clock deletion guarantee on an idle installation without an operator-scheduled prune job. No real visitor history or inventory was invented. Quieter-window recommendations require supported historical observations and a uniquely quieter future whole hour within today's verified distribution windows; unknown policies, source conflicts, closures, unsupported hours, and tied estimates suppress recommendations. See [CROWD-METHOD.md](CROWD-METHOD.md).

This work does not establish external mail reliability, real-world crowd accuracy, multi-replica scalability, or a completed independent penetration test. Those remain operational validation work.
