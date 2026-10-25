## Current public access (2026-10-25)

Public account navigation is removed. `/account` redirects to `/share`; protected moderator sign-in is at `/admin/sign-in`. No signup or Google login is required to submit food. Historical user records are retained for integrity, not deleted.

Food sharing is now a core feature. `REACH_COMMUNITY_ENABLED=false`, `REACH_RELEASE_COMMUNITY=false` and the core profile no longer hide the form or its submission API. Old local environment files do not need changing to access sharing. Existing administrator authentication and email configuration remain necessary for review/delivery.

The optional **test ID** upload is for developer testing only: use a synthetic or fully redacted sample, never a real government ID. It is not identity verification and is never required, published, copied to food photos, or emailed. Separate consent is required. Only authenticated moderators can access it; access expires after 24 hours, and review clears the live blob immediately. Cleanup runs on sharing access and in the alert worker, even when email is unavailable. Database backups/WAL may retain historical bytes until their normal rotation; this is not a guarantee of forensic erasure. The ordinary food photo remains separate.

The older setup notes below describe admin/email setup; their community feature-switch instructions are superseded by this section.

# Food pickup submissions and moderator review

## Where to go

- `/share`: **Host a Food Pickup** (an event at a public location) or **Share Extra Food** (sealed shelf-stable groceries). No account is created. `/share?kind=offer` opens the household offer form.
- `/admin`: private pending/reviewed submissions, photos, submitter contact, approval and rejection. An email alert links to the matching review card.
- `/food-hotspots`: approved events and offers. Approved, unexpired records also participate in pantry discovery and AI ranking. Approval is not certification of food safety or availability.
- `/account`: existing-user/admin sign-in. Public password/username registration is disabled on the server as well as in the UI.

The homepage has a visible Share food action and a direct food-sharing entry. Community is enabled in this workspace's private local configuration. Other installations must enable it explicitly; disabled installations show an unavailable page before collecting information.

## Enable locally

In your ignored `.env.local`:

```ini
REACH_RELEASE_PROFILE=extended
REACH_COMMUNITY_ENABLED=true
REACH_ACCOUNT_ENABLED=true
REACH_APP_ORIGIN=http://localhost:3000
REACH_ADMIN_EMAIL=your-admin@gmail.com
```

Restart `npm run dev`. Use the same hostname as `REACH_APP_ORIGIN`. For production use the real HTTPS origin plus `REACH_RELEASE_COMMUNITY=true`, `REACH_RELEASE_ACCOUNTS=true` and, for alerts, `REACH_RELEASE_EMAIL=true`. Existing release gates deliberately remain in place.

### First moderator

This workspace's ignored local configuration names the owner's requested Google identity. It has no matching account yet. With Google OAuth configured, that exact Gmail identity can sign in at `/account` and become the initial moderator only when no moderator exists. The server requires Google's verified authoritative Gmail/Workspace identity; typing an address in a form never grants a role. The notification inbox **reachpantrysupport@gmail.com** is not an administrator identity.

If the account already exists, verify its email then run on the server with the correct database path:

```sh
npm run community:admin -- set-sole-moderator your-admin@gmail.com
```

The admin CLI requires an existing verified account. It does not load `.env.local` automatically: set `REACH_COMMUNITY_DB` explicitly if the database is not `.local/community.sqlite`. Changing the configured admin email does not silently transfer privileges. No new ordinary Google accounts are created.

## Email alerts

New submissions atomically enqueue one alert in `sharing_alert_outbox`. A post-response task attempts delivery; run a worker to retry definitive transient failures after server restarts:

```sh
npm run sharing:alerts -- --watch
```

This worker loads local Next environment files. Configure production environment explicitly and set `NODE_ENV=production` for a production worker.

Required SMTP variables (see [SMTP.md](SMTP.md)):

```ini
REACH_EMAIL_PROVIDER=smtp
SMTP_HOST=your-mail-provider-host
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-mail-login
SMTP_PASSWORD=your-mail-password
SMTP_FROM_EMAIL=verified-sender@yourdomain.com
SMTP_FROM_NAME=Reach
```

Use port 587 with `SMTP_SECURE=false` only for required STARTTLS, as supported by the existing transport. Credentials remain server-side. This implementation uses the existing SMTP service; a Resend API key alone does not configure SMTP delivery. Configure a valid canonical `REACH_APP_ORIGIN` so the admin link points at the accessible installation.

Recipient is fixed at **reachpantrysupport@gmail.com**. Messages contain a generic alert and admin link, not private contact details/photos. Admin authentication is always required. Live delivery is not verified here: SMTP host/login/password/sender are absent. Local mode is `preview`, which creates a private message preview and sends nothing. Preview jobs are not automatically resent when SMTP is later enabled. Accepted SMTP delivery is not proof of inbox delivery; ambiguous outcomes are retained for manual inspection rather than duplicated.

## Privacy, policy and limits

- Store private name/email, explicit public contact, consent version/time, food details, sanitized photo and moderation history. Only the explicitly consented public contact is published.
- Household listings show a broad area, not a precise home/pickup address. Recipients contact guest donors directly; older account-owned offers retain their request workflow.
- Photos are limited to 2 MB/8 megapixels, decoded and re-encoded to strip EXIF. Visible details can still identify people or places; reviewers must inspect them.
- Food offers require sealed, in-date, commercially packaged shelf-stable groceries, intact labels/packaging, and a public pickup place. No cooked leftovers or perishable foods. Event hosts must have permission to hold their event.
- Maximum 3 submissions per normalized contact email per UTC day and 50 total per UTC day. Quotas, submission insertion and alert enqueue are in one SQLite transaction. Retrying the same payload/key does not duplicate the record or alert.
- Contact email is self-reported, not verified. A determined attacker can rotate addresses; the global cap and moderation limit exposure, but hosting-level abuse controls may be needed for a public launch. Same-origin checks do not authenticate anonymous submissions.
- Pending details/photos are moderator-only. Approval is atomic, expires with the pickup window, and does not transform reported facts into verified directory data.
- Request correction/removal at the support inbox. Automatic retention expiry and submitter self-service editing are not implemented. Operators must handle removal requests and backups. Admin review does not by itself establish legal compliance; review applicable local food-sharing/privacy requirements before public operation.

## Verification

Unit tests exercise pending approval, roles, consents, limits, duplicate suppression, cross-origin rejection, private data, expired windows, queue outcomes and restricted registration. Browser fixtures use an isolated `/tmp` SQLite database and synthetic food; they never create real food availability. See [VERIFICATION.md](VERIFICATION.md) for the final run results. No real email or Google login was completed during this work.

### Local submission origin troubleshooting
In development, guest submissions and account request checks use the direct
loopback Host (localhost, 127.0.0.1, or ::1), even if a stale canonical origin is
configured. The browser Origin must still match that host and port exactly.
Forwarded headers are not trusted. Production still requires the configured
canonical HTTPS origin. After pulling this fix, restart npm run dev.

### Pickup windows and review alerts
Pickup windows may last up to seven days, with a future start within 30 days.
Food must remain within its use-by date throughout pickup. This is a continuous
pickup window, not a recurring daily schedule; choose times you can actually
honor. The same duration limit applies at submission, approval, and discovery.

Review submissions at /admin; authorized moderators sign in at /admin/sign-in.
Alerts target reachpantrysupport@gmail.com and contain a private review-page link.
Preview mode saves mail locally and does not send it. For live alerts configure
SMTP as described in SMTP.md, set REACH_APP_ORIGIN to the address used for Reach,
and run npm run sharing:alerts -- --watch for queued retries. An accepted SMTP
message is not proof of inbox delivery. A localhost admin link works only on the
computer running Reach.
