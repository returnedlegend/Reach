# Email accounts and deployment requirements

Reach extends its existing SQLite identity store and preserves existing user IDs,
community records, moderator/organizer roles and active sessions. Supabase Auth
and Better Auth were considered; introducing a second identity store or a remote
provider without an agreed identity migration would split existing community
ownership. This implementation deliberately owns a small email/password lifecycle
using maintained Argon2 and server-side SMTP delivery. A future identity migration must map
existing IDs, migrate ownership, invalidate sessions, and complete a verified
email/password migration rather than creating disconnected users.

## Configuration

The application uses `REACH_COMMUNITY_DB` (default `.local/community.sqlite`) for
both community and pantry/account data. Use persistent private storage with one
SQLite-writing deployment; do not put the database on ephemeral serverless disk
or run independent unshared instances. Database permissions are restricted on
creation. Back up SQLite consistently with its backup command or stop the writer
before copying the database and WAL. Restore the complete backup for rollback;
do not remove only new tables while running a newer application.

Set these server-only values in environment settings:

- `REACH_APP_ORIGIN`: exact canonical origin, e.g. `https://reach.example.org`,
  without a trailing slash. Production requires HTTPS. `REACH_COMMUNITY_ORIGIN`
  is a compatibility fallback.
- `REACH_EMAIL_PROVIDER=smtp` selects the configured relay. Set its `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` and
  `SMTP_FROM_NAME` privately. See [SMTP setup](SMTP.md) for TLS and worker setup.
- `REACH_EMAIL_PROVIDER=preview` explicitly selects private file captures for local
  development only. Configure a canonical local `REACH_APP_ORIGIN`; captures have
  directory/file permissions 0700/0600 and are never returned by an HTTP endpoint.
  Preview is disabled in production and is never selected automatically.
- `REACH_ACCOUNT_ENABLED=false` explicitly disables accounts. Email accounts
  otherwise operate independently of the development community feature flag.

Mail defaults to disabled. SMTP and explicit private preview are supported. Invalid
or missing origin/mail configuration produces an honest 503 for email operations.
`GET /api/account/status` reports configuration and transport mode, not inbox
delivery. SMTP acceptance and preview capture are distinct states; a network
timeout may be uncertain. Automatic delivery webhooks are unavailable. The server never logs email links,
returns raw tokens or exposes a mail capture endpoint. Local preview files contain
real account links and must remain private and be deleted after use.

Next loads `.env.local` for the app. Standalone `tsx` does not; run the local worker
with explicit loading and a development environment, from the repository root:

```sh
NODE_ENV=development node --env-file=.env.local --import tsx scripts/mail-worker.ts --watch
```

Use `--once` for one dispatch, or `NODE_ENV=development npm run mail:worker -- --once`
when all variables are already exported. The worker must use the same database and
canonical origin as the app. See [SMTP setup](SMTP.md) for the complete preview
and production workflow. Tests inject delivery and temporary databases; local
checks do not prove real provider connectivity, DNS alignment or actual inbox delivery.

## Lifecycle and security boundaries

Signup accepts only email, name, password and adult confirmation. Passwords use
Argon2id v19 with random library-generated 16-byte salts, 19 MiB memory, two passes,
one lane and a 32-byte output. Existing scrypt passwords are read only for
compatibility and upgraded after valid login. Unknown-account login does Argon2
work. Community username login remains supported; its longstanding username
availability conflict is public because usernames are public identifiers. It does
not expose email lookup. Legacy accounts retain username login and do not gain email verification or pantry
privileges automatically. A signed-in legacy account without an email can use
`POST /api/account/attach-email` with `{email,currentPassword}` to request an
attachment. Reauthentication, strict input validation and per-user/address/global
limits apply. Existing-email accounts cannot use this route to change addresses.
The email remains unassigned until recipient confirmation via the usual
`/account#verify=` link and `POST /api/account/verify-email` endpoint. Attachment
claims use a separate purpose-specific token table, SHA-256 token hashes, 24-hour
expiry and a password-version check. Confirmation atomically verifies address
uniqueness and assigns the email while preserving the original user ID, username,
community records and roles. Occupied addresses receive neutral mail and the same
generic response; accounts are never merged or granted privileges. Resending an
attachment replaces its previous claim. Password changes/resets and account
deletion revoke outstanding claims. Current-password verification permits legacy
password lengths; all newly created passwords require at least 12 characters.

New signup does not create a session. Users can sign in before verifying email;
saving favorites and private locations does not require email verification.
Crowd reports and management require verification in their respective server
handlers. Pantry administrator privilege is separate from community moderator
privilege. Neither signup nor profile accepts roles or verification flags.

Signup and recovery use the same generic 202 response for existing and unknown
addresses. To avoid revealing existence through transport errors, ineligible requests
also send a neutral informational message containing no token or account status.
Definite pre-acceptance failures use the same 503 response and discard their unused token. Ambiguous acceptance preserves the token because the SMTP relay may already have accepted the link; it is never blindly resent.
Address/global persistent limits apply before sending. A failed initial signup
can leave an unverified identity: sign in and resend verification after mail is
restored. This never verifies the address or changes an existing password.

Verification links expire in 24 hours; reset links expire in 30 minutes. Random
256-bit tokens are stored only as SHA-256 hashes with their owner and purpose.
Links carry tokens in URL fragments, avoiding ordinary server access logs and
referrers. The UI asks for confirmation before POSTing verification; reset tokens
require a new password. GETs never consume tokens. Consumption rechecks purpose,
expiry and existence inside an immediate SQLite transaction. Resending replaces
the previous token of that purpose. Password resets and password changes revoke
all sessions and every outstanding email token. Concurrent password changes and
logins check a password version to prevent a stale password opening a new session.

Sessions are opaque random tokens stored as hashes with seven-day expiry. Cookies
are HttpOnly, SameSite=Strict, Path=/ and Secure on HTTPS. Every login/logout clears
the old `/api/community` cookie scope. Account reads and mutations use no-store.
Mutations require bounded JSON, strict Zod schemas and the configured same origin.
Only local development can fall back to a loopback request origin (using the
direct, validated loopback Host header when Next rewrites its bind address). Email links
always use configured origin, never Host or forwarded headers. Rate limits use
persistent global, address-hash and account keys; untrusted forwarded-IP headers
are never accepted as identity. The modest global limits suit the current pilot;
higher traffic needs calibrated per-edge throttling and a deployment capacity
review. Neither distributed protection nor constant network timing is claimed.

Profile preferences currently accept only `accessibility` (`standard` or
`step-free`) and `transportation` (`walk`, `transit` or `drive`). Saved preferred
locations require explicit consent on each write, contain a label and coordinates,
are private to the session owner and are limited to ten. They are not continuous
location or food-collection history. Deletion requires the current password and
literal `DELETE`, and transactionally removes community posts/photos, pickup
instructions, requests, blocks, reports, personal audit references, sessions,
tokens and private locations; new pantry relationships use foreign-key policies.
Aggregate pantry observations have no user foreign key and remain aggregate data.

Optional pantry, volunteer and pickup mail starts off and requires verified,
explicit consent. Volunteer participation is a separate choice. Unsubscribe links
carry a token in a URL fragment and require an explicit POST; only its hash is
stored. Unsubscribing suppresses queued optional notices while essential security
messages remain eligible. The durable notification outbox stores event/resource
metadata, never bodies, recipients, pickup instructions or action URLs. Its worker
resolves the current address and rechecks consent, blocks, assignments and resource
availability before sending. Delivery metadata has a nullable user foreign key
with `ON DELETE SET NULL`; it retains no address or body.

## Administrator bootstrap

Register and confirm the email using the configured transport, then run from a trusted server shell. Private preview confirmation is limited to local development; production requires actual provider delivery:

```sh
npx tsx scripts/account-admin.ts administrator@example.org
```

This only elevates an existing verified account and writes an audit entry. It
never creates an identity or accepts credentials/role fields from a browser.
Pantry manager assignments are managed by an authenticated administrator.

## Migration and validation

`initializeAccountSchema` applies additive columns/indexes/tables when the shared
store opens, checking columns before ALTER statements and recording migration 1.
`migrations/account-001.sql` and `account-002.sql` are the reviewable reference
SQL; the initial column-adding migration must not be rerun blindly. Migration 2
adds the separate email attachment claims table. Existing identity IDs, legacy roles and content are retained. Test the
backup restoration and migration against a copy before upgrading production.

Run `npx vitest run tests/account.test.ts tests/account-security.test.ts
tests/community.test.ts` and `npm run typecheck`. Account tests use temporary
SQLite files and injected delivery; they do not validate live SMTP connectivity,
domain DNS or TLS proxy deployment. Run `tests/mail-delivery.test.ts`,
`tests/smtp-delivery.test.ts` and `tests/smtp-outreach.test.ts` for transport and worker
checks. A final production smoke check should exercise actual
verification/reset delivery, secure cookies and the canonical origin.
