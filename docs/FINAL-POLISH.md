# Reach final polish

## Audit and priorities

Priority checklist (ordered by impact and effort):

- [x] Repair Windows public-OSM limiter and browser-test portability without weakening private-file checks.
- [x] Stop common negated travel preferences from becoming positive hard constraints.
- [x] Bound legacy planner request bodies and prevent response caching.
- [x] Align email review controls with server limits and invalidate approval when message content changes.
- [x] Give the homepage a clear location-to-food primary path, with advanced tools secondary.
- [x] Restore the broken district-boundary endpoint using existing official geometry and provenance.
- [x] Verify types, maintained data, unit tests, production build, and focused desktop/mobile browser journeys.

Existing strengths: server-only provider keys, explicit email authorization, idempotency, strict AI output schemas, deterministic eligibility/timing, source-backed pantry facts, honest unavailable states, and extensive security tests. No credentials or production messages are required for local verification.

Remaining operational work must not be disguised as UI success: live AI/mail requires operator credentials and sender verification; routing/search providers are opt-in; static transit covers limited BTD service, not the whole district; public hosting requires persistent private storage, moderation and food-sharing safety review. Maintainer data review remains necessary. N+1 directory reads are acceptable at the current 24-site scale but should be revisited before a large expansion.

## Design specification

- Preserve the shared teal/slate DaisyUI light/dark themes: primary #0f766e, ink #0f172a, white surfaces, slate background and visible borders.
- System sans-serif stack, 16px form/body controls, large readable heading, no external font download or new images.
- Primary workflow: choose a starting point → Find food near me → compare → details/directions. Advanced feasibility and AI remain accessible secondary actions.
- Keep source/availability cautions, manual location fallback, existing map and all downstream screens.
- Reuse 44px minimum touch controls, 12–18px corners, 8px spacing rhythm, 1240px content width, visible focus and reduced-motion support.
- Desktop: balanced introduction and starting-point form; mobile: heading, form and primary action stack without horizontal overflow. Avoid decorative statistics, gradients and fabricated claims.

## Implemented

- Desktop two-column introduction and starting-point panel; single primary food-discovery action. Selected locations go directly to real pantry options, without first requiring a destination choice. Step changes move keyboard focus to the new heading.
- Compact phone form keeps continuous GPS inside Advanced. Full trip planning retains its existing follow-location control. Community code and requests are deferred until Map/Community is first opened; state remains mounted afterward. Planner and assistant loads have visible feedback.
- Branded 404 and error recovery pages retain food discovery and telephone-help links.
- Native OS temporary paths for the OSM public-provider limiter, retaining exclusive locks, ownership/symlink checks and POSIX permissions where supported.
- Streamed 8 KB/four-second bounds, strict schemas and private/no-store responses for the retained planner endpoint.
- Common negative travel statements and bus-stop landmarks no longer become affirmative travel instructions. Qualified walking limitations do not fabricate a zero-distance constraint. Manual controls still matter; this is bounded intent recognition, not general language understanding.
- Email edits and follow-up changes require renewed approval; the editor matches the server's 4,000-character limit. Client disconnects cancel draft inference work.
- Missing `/api/coverage` now returns the exact existing Census geometry with locally recorded provenance, bounded asset reads and truthful failures. The ignore rule that accidentally hid this API directory is corrected.
- SQLite handles explicitly close during isolated test teardown; Windows test runs no longer fail solely because the database is open. Browser binaries are portable/configurable. GTFS tests support a configured Python executable.

## Important files

Application: `src/components/guided-reach.tsx`, `guided-reach.module.css`, `location-picker.tsx`, `outreach-panel.tsx`; `src/app/error.tsx`, `not-found.tsx`, `reach-polish.css`; `src/app/api/plan/route.ts`, `api/coverage/route.ts`; `src/lib/reach-assistant.ts`, `outreach.ts`, `osm-services.ts`, `coverage-types.ts`, `community.ts`; `.gitignore`, `playwright.config.ts`.

Regression coverage: `tests/assistant-intent.test.ts`, `plan-api.test.ts`, `coverage-api.test.ts`, `osm-native-limiter.test.ts`, `database-lifecycle.test.ts`, `final-polish.spec.ts`, `outreach-review.spec.ts`, plus explicit teardown in account/mail/community security tests.

## Verification

- `npm run check`: passed. Maintained production data: 24 pantries; separately labeled fictional planner fixtures: six. TypeScript passed; all **504 unit tests across 52 files passed**; optimized production build passed, including `/api/coverage`.
- `npm audit --omit=dev --json`: zero reported production dependency advisories. This is not a comprehensive security certification.
- Focused desktop/mobile browser checks: initial 22-check pass covered quick-start, actual directory records, filters, location denial/timeouts/following, modal focus restoration and origin-preserving directions handoff. Light/dark homepage passed automated WCAG 2.2 checks and 320px overflow checks. A fresh homepage console check returned no warnings/errors/page errors.
- Final browser matrix: **42 unique passing viewport checks**, with **two isolated authenticated-preview fixture tests skipped**. Production-mode checks: final polish/coverage 8, reviewed email 2, navigation 6, location 8, pantry handoff 2, discovery/filtering 6 (32 passes). Supported development-mode access and assistant checks: 10 passes, two skips. The initial six access/assistant checks on plain HTTP production correctly failed closed because a canonical HTTPS origin was not configured; rerunning on development verified the supported local path, not production provider availability. Origin protection was not weakened.
- Small-phone verification includes an explicit assertion that the initial primary action clears bottom navigation at **320×740**. Desktop and phone screenshots were refreshed after the final adjustment. Changed-code Prettier checks and `git diff --check` passed. No dedicated lint command is configured.
- Provider mocks in automated tests establish error/contract behavior, not live service availability. Map cartography is neutralized in repeatable screenshot/accessibility checks; production pantry records are not replaced with fictional records. The real coverage endpoint returned HTTP 200 with GEOID `4810`, 119th Congress provenance, and a public one-hour cache header in the optimized build.

### Visual review

Compared the rendered desktop and phone screenshots for copy, hierarchy, typography, palette, spacing/container geometry, and responsive control wrapping. The initial competing filled actions became one primary action plus outlined assistance; desktop empty width became a balanced two-column layout. Small-phone review led to moving continuous GPS into Advanced. Teal/slate light and dark themes, existing copy, downstream screens, and real interactive HTML remain intact. Screenshots are in [[evidence/final-polish-desktop-after.png]] and [[evidence/final-polish-mobile-after.png]]. No pixel-perfect or full WCAG-conformance claim is made.

## Run and demonstrate

Run these commands **from the repository root, one directory above this docs vault**, using Node 24:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. For the optimized build: `npm run build`, then `npm start`. For local production discovery verification without publishing on the network, use `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100`. Production account/access/assistant endpoints require a real configured canonical HTTPS `REACH_APP_ORIGIN`; a bare local HTTP production server is not a substitute. Use development mode for the supported local unconfigured workflow.

1. Open the homepage on a phone. Use location only with consent, or search a known pantry/address. Without a configured geocoder, select a local directory match only if it is your actual starting place, or enter a known exact point in Advanced. Never label example coordinates as the visitor's location.
2. Choose **Find food near me**, compare recorded pantry information, open details and inspect eligibility/hours/source uncertainty.
3. Open Map, show/hide the official TX-10 boundary, select a pantry and open directions. External directions handoffs remain available; in-app routed instructions require an explicitly configured provider.
4. Use **Find food I can reach** to show deterministic constraints and explainable uncertainty. Do not describe a missing itinerary as a reachable trip.
5. Open Reach AI assistant. Without OpenRouter credentials, demonstrate the honest deterministic fallback, not live inference.
6. Optional email demonstration requires a verified test account and enrolled consenting recipient. Review the exact draft, approve it, and explain preview versus real delivery. Do not send a real message merely to demonstrate the interface.

Browser setup: `npx playwright install chromium`; `PLAYWRIGHT_CHROMIUM_PATH` optionally selects an existing binary. Unit GTFS reproduction needs Python (`python3` on POSIX, `python` on Windows, or `REACH_PYTHON` pointing to an executable). `npm run test:e2e` runs the full browser suite; historical/live-service suites have their own setup requirements and were not all executed in this pass.

## External-service and launch limitations

## Follow-up alignment polish — October 23, 2026

Preserved the established teal/slate palette, copy, typography, controls and wide map/results workspace. A shared `--reach-focus-width: 820px` now centers the progress indicator, guided form, community invitation and saved content. The four progress steps use equal-width columns. Tablet search fills its column instead of stopping at 680px and leaving an uneven right gap. The compact step heading no longer inherits the oversized desktop hero font. Desktop top spacing is tighter, and the footer now shares the centered rail with centered branding/links and left-aligned explanatory prose.

The saved/directory empty-state icon was actually miscentered: the CSS reset makes SVGs block-level, so inherited `text-align: center` did not center them. Explicit inline auto margins fix this without centering normal resource descriptions.

Verification: `npm run check` passed on the current repository (54 unit-test files, **517 tests**, maintained data, TypeScript and production build). **24 browser checks passed** across 390px, 412px, 820px and 1280px projects, with the existing additional 320px check. Checks cover rail width/centering, compact-step alignment, keyboard navigation, empty-state icon centering, light/dark accessibility, discovery and the official map boundary. Initial desktop geometry-test expectations were corrected to account for the existing stable scrollbar gutter; element centering is measured against usable body width. A final homepage/Saved navigation check found no console/page errors or failed local responses. Changed-file formatting and whitespace checks passed. No new dependencies or service behavior changes.

Visual comparison checked copy, layout hierarchy, typography, palette, spacing/container geometry and responsive wrapping. Matching-size review images: [[evidence/alignment-desktop-before.png]], [[evidence/alignment-desktop-after.png]], [[evidence/alignment-tablet-before.png]], [[evidence/alignment-tablet-after.png]], [[evidence/alignment-phone-before.png]], [[evidence/alignment-phone-after.png]]. The automated contrast checks are not a full accessibility certification. Integration limitations above remain unchanged.

## Documentation and publication preparation October 24 2026

Added a [documentation index](README.md) and [development and maintenance guide](DEVELOPMENT.md), expanded the [demonstration guide](DEMO.md), and updated [architecture](ARCHITECTURE.md) to distinguish the current SQLite application from the retained timetable engine. Setup now explains Windows/POSIX commands, test prerequisites, canonical origins, provider fallbacks, layout maintenance, common failures and safe publication. Historical verification reports remain scoped to their original runs; the separately documented supplied-credential OpenRouter observation is not a general delivery or provider-availability guarantee.

Pre-publication checks on October 24: `npm run check` passed with 24 maintained pantry records, six separately labeled fictional fixtures, TypeScript, 517 unit tests across 54 files, and the production build. A local-link check covered 105 Markdown file links across the updated entry points with none missing; external URLs and heading anchors were not part of that check. The 24 alignment/discovery browser checks above describe the prior UI verification, not a new browser run today. Git publication status must be confirmed separately against the remote commit.
