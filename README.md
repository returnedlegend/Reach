# Reach

Reach helps people find food assistance in the reviewed TX-10 area. It uses
Next.js 16, React 19, TypeScript, Node.js 24 and persistent SQLite storage.

## Run locally

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Use Node 24. Open http://localhost:3000. Preserve an existing `.env.local` instead
of copying over it. Private environment files and databases must stay out of Git.

## Find food

Search by city, ZIP, address or a short description. Browser location is optional;
manual selection and map correction are available. Maintained pantry sites and
approved active community offers appear together. Mathematical distance and
pickup scoring supplies up to three options, even when AI is unavailable.

Groq is the default AI provider. Run `npm run ai:setup`, then configure its private
key and review the data policy in [Groq setup](docs/GROQ.md). Provider failures keep
the directory usable. AI explains source-backed options; it cannot establish food
stock, eligibility, safe pedestrian access or live transit service.

MapLibre displays an OpenStreetMap-derived map without a Google key. Routing and
geocoding need compliant provider configuration. External directions remain
available. See [mapping setup](docs/OPENSTREETMAP.md) and
[ranking](docs/AI-PANTRY-RANKING.md). Saved places, downloadable trips and printing
remain available. Saving a precise trip origin requires explicit consent.

## Share food and review submissions

Open `/share` to **Host a Food Pickup** or **Share Extra Food**. Both links are on
the home page. No registration is required. Submissions require moderator approval
before appearing publicly; rate limits, consent, photo validation and privacy
rules apply. Household locations remain approximate.

Moderators sign in at `/admin/sign-in`, review requests and photos at `/admin`,
and change their password at `/admin/change-password`. Check the review page for
new requests. Provision an administrator from a trusted terminal:

```sh
npm run admin:setup -- administrator@example.org
```

See [administrator access](docs/AUTHENTICATION.md) and
[sharing rules](docs/FOOD-SHARING-SAFETY.md).

## Checks and hosting

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Browser tests require a running server and their documented environment settings.
Production authenticated requests require the canonical HTTPS `REACH_APP_ORIGIN`.
Use persistent private storage and test backups before hosting. See
[publishing](docs/PUBLISHING.md), [development](docs/DEVELOPMENT.md), and the
[documentation index](docs/README.md). This repository does not imply that the app
is publicly deployed or that external providers have been verified live.

Read the [judge-style review and engineering response](docs/JUDGE-REVIEW-2026-10-25.md) for reproduced defects, fixes, validation, and remaining competition-readiness work.
