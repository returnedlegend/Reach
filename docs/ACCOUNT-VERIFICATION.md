# Account, pantry authorization, and crowd verification

This report records local implementation checks. It does not certify a public deployment or a working external email service. No email was sent to an external recipient during these tests, and the site was not deployed.

## Architecture decision

Reach already had Node 24 SQLite storage, community users, moderation roles, and hashed sessions. The implementation extends that database and preserves existing user IDs, community roles, and their relationships. SQLite remains appropriate for one application host with a durable private filesystem. It is not a shared database for independently deployed replicas or ephemeral serverless instances.

New passwords use `@node-rs/argon2` Argon2id with unique salts, 19 MiB memory, two iterations, and one lane. Legacy scrypt hashes remain readable and are upgraded only after a successful login. Existing username accounts continue to work through the community interface. A signed-in legacy account can attach an email only after password reauthentication and recipient confirmation; a separate scoped, expiring claim preserves the existing identity and roles and cannot merge with another account that owns the address.

Account sessions are random 256-bit values; only their SHA-256 hashes are stored. Cookies use HttpOnly, SameSite=Strict, root path, a seven-day lifetime, and Secure for the configured HTTPS origin. Login/logout also expire the old community-scoped cookie. Email verification and reset tokens are random, hashed, purpose-bound, expiring, and consumed in transactions. Verification links last 24 hours; recovery links last 30 minutes. Password changes and resets invalidate every existing session and outstanding account token.

Email links use the configured canonical origin and URL fragments. The account page removes the fragment immediately, including subsequent links opened in the same document, and keeps its token in component memory. It uses a no-referrer policy and requires explicit confirmation before consuming a verification link.

## Security issues addressed

## Tests actually run

The pre-change baseline `npm run check` passed data validation (six demo and eight production pantries), TypeScript, 184 tests across 13 files, and a production build.

Independent post-change command:

```sh
npx vitest run tests/account-security.test.ts tests/pantry-security.test.ts tests/crowd-security.test.ts
```

The account deletion test was additionally rerun after adding private photos, preferred locations, pantry favorites, assignments, corrections, and audit references: **8 account security tests passed**.

Browser command against the running development server:

```sh
REACH_TEST_URL=http://127.0.0.1:3060 npx playwright test tests/account-verification.spec.ts --project=mobile --project=desktop --workers=1 --output=/tmp/reach-account-browser-results
```

An additional test ran against the final production build through the isolated local HTTPS proxy. Its reproducible form is:

```sh
REACH_TEST_URL=https://localhost:3131 REACH_TEST_LOCAL_TLS=true REACH_ACCOUNT_TEST_DB=/tmp/reach-account-browser/data.sqlite npx playwright test tests/account-management-live.spec.ts --project=mobile --project=desktop --workers=1 --output=/tmp/reach-real-management-results
```

The final integrated `npm run check` passed data validation, TypeScript, **251 tests across 20 files**, and a production build. The primary agent additionally reported **188 existing browser regression checks passed** across four viewports, and **28 new feature checks passed against the final production build** across those viewports. The two independently run real account/management lifecycle cases above supplement those checks.

## Configuration and remaining limits

Store `REACH_COMMUNITY_DB` on a private persistent volume, keep backups, and use the documented local administrator bootstrap for an existing verified account. Public HTTP APIs cannot grant administrator access. Multi-host operation needs a shared database and distributed request limiting. Current persistent global rate limits are a backstop and can be exhausted by an attacker; an ingress limiter should enforce trusted client boundaries before public deployment. Email verification increases the cost of duplicate accounts but cannot establish that accounts represent distinct people.

Crowd storage contains aggregate buckets without account IDs. Temporary HMAC deduplication values are pseudonymous, not irreversible anonymous data: the database also holds the secret and account identifiers. Deduplication records expire within 48 hours; historical buckets stop contributing after 90 days. Expired rows are pruned on subsequent crowd requests or by `npm run data:prune`. There is no hard wall-clock deletion guarantee on an idle installation without an operator-scheduled prune job. No real visitor history or inventory was invented. Quieter-window recommendations require supported historical observations and a uniquely quieter future whole hour within today's verified distribution windows; unknown policies, source conflicts, closures, unsupported hours, and tied estimates suppress recommendations. See [CROWD-METHOD.md](CROWD-METHOD.md).

This work does not establish external mail reliability, real-world crowd accuracy, multi-replica scalability, or a completed independent penetration test. Those remain operational validation work.
