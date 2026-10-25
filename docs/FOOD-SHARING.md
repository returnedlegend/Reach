# Community food sharing

`/share` offers **Host a Food Pickup** and **Share Extra Food**, linked directly
from the home page. Public submission requires no account. Sharing remains
available even when old environment files disable legacy community flags.

## Submission and review

The three steps collect food details, location/contact information and consent.
The pickup end must be after the start, not already past, and within the permitted
seven-day duration. Household items must comply with the displayed food rules and
use-by date. Approval is not a food-safety inspection or guarantee of availability.

A moderator signs in at `/admin/sign-in`, reviews pending requests and photos at
`/admin`, then approves or rejects them. Check this page for new requests. Only
approved, unexpired records appear in public food search and AI candidate input.
Approved listings remain subject to takedown and expiry. Moderator access is
checked server-side on every review and private-image request.

Provision an administrator using `npm run admin:setup -- administrator@example.org`
on the trusted application server. Change the temporary password at
`/admin/change-password`. Existing sessions are revoked after password changes.
See [administrator access](AUTHENTICATION.md).

## Privacy and limits

- Private name and contact address remain visible only to reviewers.
- Only explicitly consented public contact information is shown publicly.
- Household locations are approximate; private residential coordinates are not
  published as precise pickup locations.
- Photos are validated and re-encoded to remove embedded metadata.
- The optional developer-test ID must be synthetic or fully redacted, never a real
  government ID. It is not identity verification. Separate consent is required;
  only moderators can access it, access expires after 24 hours, and review clears
  the live blob. Cleanup runs on sharing access. Backups may retain older blobs.
- Up to three submissions per normalized contact address per UTC day and 50 total
  per UTC day. Persistent quotas and idempotency prevent duplicate retries.
- Contact details are self-reported. Same-origin checks do not authenticate a
  submitter; moderator review and hosting-level abuse controls remain important.

Tests use isolated SQLite databases and synthetic food/photo fixtures. They do not
establish real food availability. Existing production data is not seeded or
replaced by test records.
