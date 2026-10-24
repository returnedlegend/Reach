# Reach code review and maintenance findings

Reviewed October 24, 2026 (America/Chicago), starting from commit `8ed9703`. This was a focused correctness and maintainability review with fixes, not a full security audit or a public-launch certification.

## Findings and fixes

### P2 — Community availability depended on English error wording

**Trigger:** a 503 Community response said the feature was unavailable without containing the exact word `disabled`. The initial-load and background-refresh handlers in `src/components/community-panel.tsx` inspected the human error text to choose the disabled screen. A copy/localization change could leave that screen showing normal controls with a generic failure. Conversely, a transient-error message mentioning a temporarily disabled action could incorrectly turn the whole feature off in the UI.

**Fix:** the existing server gate in `src/lib/community.ts` now returns `code: "community_disabled"` alongside its readable message. The client reads that field and shares a single status/code guard for initial load and polling. Only HTTP 503 with that code selects the structured disabled state. Other explicit codes remain errors. The old text fallback is retained only when a server supplies no code. No origin, role, account, publication or feature gate was weakened.

**Evidence:** `tests/community.test.ts` checks the status/code and confirms a disabled request does not create its database. Two new scenarios in `tests/hotspot-access.spec.ts` use changed disabled wording and a structured transient failure containing the word `disabled`; they check the correct state and recovery action. The retained legacy-response cases still pass. Browser responses in these scenarios are fixtures, not real external service results.

### P2 — A deterministic AI fixture inherited the operator's provider key

**Trigger:** the nearby-transit negation fixture did not explicitly select a provider. With the new server OpenRouter key present, the application's intended provider inference selected OpenRouter; its empty mock fetch did not return a provider response, so the test returned unavailable rather than the expected local interpretation. The baseline was **516 passed, one failed, across 54 files**. This was a test-isolation defect, not evidence that the key or live service was invalid.

**Fix:** `tests/navigation-needs-agent.test.ts` starts each case with AI explicitly disabled, and provider-specific cases opt in through their fixture setup. The deterministic negation case deliberately supplies an unrelated fixture key, asserts no fetch occurs, and checks computed assistance and `preferTransitNearby:false`. Production inference behavior, credentials, paid-model restrictions and privacy configuration were not changed.

**Evidence:** the corrected full unit suite passed **517/517 in 54 files** with the injected runtime settings still present. The regression fixture never sends a real request.

## Documentation corrections and additions

- [Development and maintenance](DEVELOPMENT.md) now includes a route/method/access map, exact application configuration precedence, origin-error troubleshooting, isolated fixture guidance and the distinction between a newly started Community-enabled test server and reuse of an existing server.
- [Architecture](ARCHITECTURE.md) links HTTP entry points to their handler-level trust boundaries. Exporting a method is not a promise that every catch-all subpath accepts it.
- [Community](COMMUNITY.md) documents the structured disabled error contract while keeping explicit opt-in and moderation requirements.
- [Free OpenRouter setup](FREE-OPENROUTER.md) and the root README distinguish the original missing-key run from the later live credential checks. Current setup instructions no longer contradict the dated verification report.
- [The documentation index](README.md) links the expanded reference and this report. Historical test counts remain dated evidence rather than being silently relabeled as new verification.

## Scope and independent review

Main-agent inspection covered the Community UI/handler boundary, optional AI fixture/provider selection, canonical-origin helpers, bounded private JSON/error responses, coordinate/directions validation, local saved-item validation, development launcher settings and the relevant route files. It was not a line-by-line audit of the entire repository or all dependencies. No new authentication or credential-disclosure defect was established in this bounded inspection; that is not a guarantee that none exists.

A `gpt-6-luna` subagent at high reasoning effort audited and expanded the assigned developer/architecture/index docs, then independently inspected the code and regression-test changes. Main-agent review corrected initial documentation omissions around legacy model precedence, anonymous same-origin checks, signup/login exceptions and existing browser-server reuse. The subagent rechecked those corrections and found no concrete code regression. Main retained architecture, code changes, integration and final acceptance. No token or cost savings were measured.

## Final verification

| Check                                                | Actual result                                                             | Limits                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Full unit suite                                      | 517 tests passed, 54 files                                                | Includes synthetic provider responses; not live service testing                     |
| Data validation                                      | 24 production pantry records and six separately fictional fixtures passed | Structural consistency is not fresh confirmation of inventory or eligibility        |
| TypeScript                                           | Passed                                                                    | Static validation only                                                              |
| Production build                                     | Passed                                                                    | Builds the app; does not verify configured external providers                       |
| Targeted browser regressions                         | Eight passed: four scenarios each on mobile and desktop                   | Chromium emulation with synthetic Community responses, not physical-device testing  |
| Real local disabled API                              | HTTP 503 with `community_disabled`                                        | Runs against an isolated private SQLite path; no email/provider inference requested |
| Formatting, local document links and credential scan | Passed                                                                    | No secrets are intended for version control                                         |

The browser checks used a loopback production server with Community, mail and AI disabled, an isolated temporary database, and an explicitly selected system Chromium. They cover public browsing and fixture-driven Community states, not authenticated/account/assistant acceptance on plain HTTP. Production private workflows still require the documented canonical HTTPS origin. The eight browser cases are a targeted subset, not a claim that every browser suite was rerun.

The full unit count did not increase because existing cases were strengthened. The two new browser cases run under both selected viewport projects alongside the two retained cases.

## Reproduce the relevant checks

Run from the repository root with Node 24 and dependencies installed:

```sh
npm test
npm run data:validate
npm run typecheck
npm run build
```

Use a **disposable** database and a loopback server for the public browser subset; do not reuse production accounts or data. After building, start this server in a POSIX shell:

```sh
reach_review_dir="$(mktemp -d)"
REACH_COMMUNITY_DB="$reach_review_dir/community.sqlite" \
REACH_COMMUNITY_ENABLED=false REACH_EMAIL_PROVIDER=disabled \
REACH_AI_PROVIDER=disabled \
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3014
```

Once that server is ready, in another shell:

```sh
REACH_TEST_URL=http://127.0.0.1:3014 npm run test:e2e -- \
  hotspot-access.spec.ts --project=mobile --project=desktop \
  --grep 'shortcut|entry remains|structured|transient'
```

Install Playwright Chromium or deliberately set `PLAYWRIGHT_CHROMIUM_PATH` to an available compatible binary. [Development setup](DEVELOPMENT.md) explains server lifecycle, Community opt-in, origin matching and Windows equivalents. Do not rebuild the app beneath an active server.

## Remaining external limits

No DNS record, nameserver, deployment or live email was changed during this review. No OpenRouter completion or recipient email was requested. Refer to [the dated Resend DNS audit](RESEND-DNS.md), [OpenRouter observations](FREE-OPENROUTER-VERIFICATION.md), provider guides and pantry source records for external evidence. This review does not resolve pantry stock, unverified access paths, timetable conflicts, DNS ownership/delegation or provider capacity.
