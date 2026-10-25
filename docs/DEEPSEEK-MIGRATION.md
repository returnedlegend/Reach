# Direct DeepSeek migration — October 25, 2026

The existing Reach application now uses the official DeepSeek API for the optional pantry/map assistant, request interpretation, grounded guidance, inquiry drafting and conservative reply extraction. Frontend routing and forms, SQLite, Resend/SMTP delivery, user authentication, maintained pantry data and deterministic trip ranking are retained. No dependencies were added. The migration was verified locally before GitHub delivery. No public deployment was performed.

## Provider and safeguards

The shared server client is `src/lib/deepseek-client.ts`. `src/instrumentation.ts` validates settings when the Node server starts, reporting safe configuration warnings without a provider request. Ordinary tasks select `DEEPSEEK_MODEL=deepseek-flash` with thinking disabled. Guidance involving a return or transfer can select `DEEPSEEK_REASONING_MODEL=deepseek-v4-pro` with bounded low-effort thinking. The official base URL is `https://api.deepseek.com`; its documented `/v1` alias is accepted. Other hosts and redirects are rejected so the key cannot be sent to a configured proxy endpoint.

The client uses the existing HTTP/Fetch infrastructure rather than adding an SDK dependency. It sends official JSON mode, supplies the task schema in the prompt, and validates returned content with the existing strict Zod schemas. Incomplete output, unsupported facts/fields and empty/malformed responses are rejected. Models cannot change the route engine, ranking, source facts or email authorization. The email worker still requires reviewed approval and its existing authentication/rate/duplicate checks.

There is a total timeout, bounded output, at most two attempts for HTTP 429/5xx with backoff and Retry-After handling, a short circuit breaker, and retained process-local request ceilings. An ambiguous network failure is not automatically retried because a paid request may already have been accepted. There is no automatic provider or model fallback. Manual pantry planning, computed guidance and editable email templates remain available. Aggregate token counters are available server-side; they do not estimate dollar charges or prove that a failed response was unbilled.

Removed: the OpenRouter client, its obsolete catalog/pricing/provider-routing logic and environment instructions, and the now-unused Gemini fallback helper. Explicit unrelated Groq/Gemini adapters remain available under their existing separate opt-ins. Historical dated OpenRouter research/evidence is retained as history, not current configuration.

## Local environment and deployment

A real DeepSeek key was already present in the execution environment and was used without printing it. The ignored root `.env` now contains missing DeepSeek placeholder/default settings, mode 0600. Existing `.env.local` credentials and unrelated settings were preserved; its prior provider selection was changed to DeepSeek. Both files remain Git-ignored. Next gives `.env.local` precedence over `.env`, and actual process environment settings take precedence over both.

Required settings and production release gates are in [DeepSeek setup](DEEPSEEK.md). The private API key must never have a `NEXT_PUBLIC_` prefix. DeepSeek is a billed API; its balance and terms differ from the retired free router. Production deployment uses the existing [single-host guide](PUBLISHING.md) and private runtime environment. Nothing was automatically deployed.

## Actual checks

- Baseline: 638 tests in 73 files passed.
- Final `npm run check`: data validation (24 maintained records, six separate fixtures), TypeScript, 645 tests in 73 files, production build all passed.
- Final startup hook: TypeScript and production build rerun passed. With an explicitly empty key, the actual server emitted the safe credentials warning, returned unavailable/credentials from `/api/ai/status`, and served pantry results with HTTP200; no provider call. [Startup evidence](evidence/deepseek-startup.json).
- Production browser run: 32/32 selected mobile/desktop Chromium cases passed. Includes AI success/outage/opt-out/manual override, assistant availability, natural requests, geolocation denial/manual recovery, real selected-coordinate handling, exact checked itinerary handoff, expiry, saving, and scoped accessibility. AI/routing responses in these browser cases were intercepted fixtures. The app itself was the actual standalone production build with disposable SQLite and a synthetic server key.
- Independent reviewer: 27 focused synthetic client/release checks passed, four desktop AI cases separately rerun and passed, plus a direct browser status and coordinate-privacy check. These four cases overlap the 32-case main matrix and are not counted as extra unique tests.
- `npm audit --omit=dev`: zero known vulnerabilities at this check. No lint script exists. Changed-file Prettier, `git diff --check`, credential value scans and ignored-file/mode checks also passed; see [sanitized security evidence](evidence/deepseek-security.json).
- Real API check: three synthetic requests reached official `/chat/completions`; all returned **402 insufficient balance**. No successful live inference is claimed. Preference interpretation and reasoning returned unavailable; draft generation retained its editable template. No email was sent. [Actual responses](evidence/deepseek-live-check.json).

Browser command, against the isolated local TLS preview:

```sh
REACH_TEST_URL=https://localhost:3443 REACH_TEST_LOCAL_TLS=true \
REACH_TEST_AI_CONFIGURED=true PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium \
npm run test:e2e -- tests/simple-food-ai.spec.ts tests/assistant.spec.ts \
  tests/simple-food.spec.ts tests/simple-food-trip.spec.ts \
  --project=mobile --project=desktop
```

Four Luna/high subagents handled workflow adapters, workflow tests, official documentation/setup, and independent verification with separate file ownership. The main agent integrated the client/configuration, reviewed changes, corrected configuration and model-selection issues, ran the final checks, and attempted the live integration. No compute savings are quantified.

## Remaining action

The DeepSeek account owner must add usable API balance or provision a funded key securely. Then rerun a small synthetic inference, check provider usage, and restart the app with the intended release settings. Current live evidence proves the endpoint was reached and its error was handled; it does not establish funded model access or successful output. Existing routing, DNS/email, field-data and public-hosting limitations are unchanged by this provider migration.

## Files

### Created

- `docs/evidence/deepseek-startup.json`
- `src/instrumentation.ts`
- `docs/DEEPSEEK-MIGRATION.md`
- `docs/DEEPSEEK-VERIFICATION.md`
- `docs/DEEPSEEK.md`
- `docs/evidence/deepseek-live-check.json`
- `docs/evidence/deepseek-security.json`
- `src/lib/deepseek-client.ts`
- `tests/assistant.spec.ts`
- `tests/deepseek-client.test.ts`
- `tests/deepseek-independent.test.ts`
- `tests/deepseek-workflows.test.ts`

### Modified

- `.env.example`
- `README.md`
- `deploy/production.env.example`
- `docs/ACCESS-INTEGRATIONS.md`
- `docs/ACCESS-PLANNER.md`
- `docs/AI-CONFIGURATION.md`
- `docs/AI-NAVIGATION.md`
- `docs/ARCHITECTURE.md`
- `docs/CODE-REVIEW.md`
- `docs/DEMO.md`
- `docs/DEVELOPMENT.md`
- `docs/FEATURE-READINESS-2026-10-24.md`
- `docs/FOOD-FIRST-RELEASE.md`
- `docs/FREE-OPENROUTER.md`
- `docs/NAVIGATION-FILES.md`
- `docs/NAVIGATION-PROVIDERS.md`
- `docs/PUBLISHING.md`
- `docs/README.md`
- `docs/SMTP-AI-FILES.md`
- `docs/SMTP-AI-SETUP.md`
- `src/lib/access-ai.ts`
- `src/lib/ai-config.ts`
- `src/lib/navigation-guidance-agent.ts`
- `src/lib/navigation-needs-agent.ts`
- `src/lib/release-features.ts`
- `tests/access-ai.test.ts`
- `tests/ai-fallback.test.ts`
- `tests/food-search-service.test.ts`
- `tests/navigation-independent.test.ts`
- `tests/navigation-needs-agent.test.ts`
- `tests/release-features.test.ts`
- `tests/release-preflight.test.ts`
- `tests/smtp-ai-independent.test.ts`

### Removed or replaced

- `src/lib/gemini-client.ts`
- `src/lib/openrouter-client.ts`
- `tests/free-ai-workflows.test.ts`
- `tests/free-assistant.spec.ts`
- `tests/free-openrouter-independent.test.ts`
- `tests/openrouter-client.test.ts`

Private local configuration, excluded from Git: `.env` created; `.env.local` provider selection updated while existing secrets were preserved.
