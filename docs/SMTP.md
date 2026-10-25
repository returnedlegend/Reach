# SMTP and local preview email

Reach supports an explicitly selected SMTP relay or private local preview. Mail defaults to disabled; missing or invalid SMTP configuration fails closed.

```dotenv
REACH_EMAIL_PROVIDER=smtp
REACH_APP_ORIGIN=https://your-canonical-host.example
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-mailbox-user
SMTP_PASSWORD=
SMTP_FROM_EMAIL=mail@your-verified-domain.example
SMTP_FROM_NAME=Reach
```

Use the relay host, credentials and authorized sender supplied by your mail service. Store credentials only in private server environment settings. Port 465 requires implicit TLS (`SMTP_SECURE=true`). Port 587 requires `SMTP_SECURE=false` and enforced STARTTLS before authentication. Certificate validation stays enabled. Other ports and mismatched TLS settings are rejected. The runtime needs outbound TCP access to the configured host and port.

SMTP relay acceptance is recorded as `accepted`, not inbox delivery. Reach stores the RFC Message-ID separately from historical provider IDs and does not infer provider IDs from server reply text. Network failures and the 20-second overall deadline produce `uncertain` outcomes without automatic retry because acceptance may already have occurred. Explicit temporary SMTP refusals permit at most two attempts within that deadline. A stable Message-ID is reused for those attempts; SMTP does not guarantee idempotency. Workers do not blindly repeat an interrupted send.

Shared validation, templates, rate limits and private outbox metadata apply to account verification, recovery, security notices and reviewed pantry inquiries. Delivery metadata contains no message bodies or credentials. TLS connection/greeting/socket timeouts are 10 seconds; transport debug logging is disabled.

## Private local preview

```dotenv
REACH_EMAIL_PROVIDER=preview
REACH_APP_ORIGIN=http://localhost:3000
REACH_EMAIL_PREVIEW_DIR=.local/mail-preview
```

Preview writes private files, sends no mail and is disabled in production. Never place captures under a served directory. Start the app with `npm run dev`; run one bounded worker pass with:

```bash
NODE_ENV=development node --env-file=.env.local --import tsx scripts/mail-worker.ts --once
```

Use `--watch` for polling. App and workers must share the same origin, environment and private persistent SQLite database. Production additionally requires the release email feature gate, HTTPS origin and SMTP configuration.

## Pantry replies

Live SMTP outreach also requires `REACH_OUTREACH_REPLY_EMAIL` set to a monitored app-controlled mailbox. Every inquiry uses this address as Reply-To. Operators handle incoming mail in that mailbox; Reach currently has no automatic inbound email or delivery webhook integration. Existing saved replies, their ownership checks and review controls are retained. Inbox replies are not automatically imported or used as availability claims.

Automatic live SMTP follow-ups are disabled because Reach cannot observe replies in the monitored mailbox. New follow-up consent is rejected; the SMTP worker cancels queued automatic child messages and clears remaining follow-up counts without deleting history or stopping reviewed primary inquiries. Preview-only follow-up fixtures remain available. To follow up in practice, review the mailbox first and explicitly review and authorize a new inquiry, subject to the usual limits.

Enrollment consent, verified accounts, explicit message approval, authorization expiry, contact-change checks and dispatch limits remain required. Preview does not require a live reply mailbox. See [access planner](ACCESS-PLANNER.md) for enrollment and message review.

Tests use synthetic Nodemailer transports and private temporary databases. They establish application behavior, not a live provider connection or inbox delivery. See [Nodemailer SMTP transport](https://nodemailer.com/smtp/) for relay options.
