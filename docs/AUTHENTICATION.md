# Administrator access

Public discovery and food sharing do not require an account. Moderators use
`/admin/sign-in` and review submissions and photos at `/admin`. Approval is
required before a community listing appears in search. Existing database records
and identities are retained.

## Setup

Use Node 24 and persistent private SQLite storage (`REACH_COMMUNITY_DB`). Set
`REACH_APP_ORIGIN` to the exact site origin; production requires HTTPS.

From a trusted server terminal:

```sh
npm run admin:setup -- administrator@example.org
```

The script prompts for a temporary password and refuses to overwrite an existing
identity. Change the temporary password at `/admin/change-password` after signing
in. New passwords require 12–128 characters. Keep credentials out of Git.

## Security

Passwords use Argon2id. Older scrypt hashes upgrade after a successful login.
Sessions use random tokens stored as hashes, expire after seven days, and use
HttpOnly, SameSite=Strict cookies with Secure on HTTPS. Mutations validate the
origin, bounded JSON, strict schemas and persistent rate limits. Password changes
require the current password and invalidate all sessions. Moderator permission
is checked server-side; opening a protected page without it does not grant access.

Back up the shared database before upgrading. Existing installations retain their
historical tables; this release does not destroy stored user or community data.
