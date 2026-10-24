# Reach AI Navigation

Implemented 2026-10-23 in the existing Next.js application. No new application, database replacement, mapping dependency or package was introduced. OpenRouter uses its OpenAI-compatible server-side REST contract. The map remains MapLibre/OpenStreetMap; email remains Resend with private local preview.

## What runs

Open **Find food I can reach** on the home page. The question-first planner accepts GPS with permission, a manual address/coordinates, or a corrected map pin. Preferences remain editable without an account. New service, urgency, household-size, identification and near-transit controls are optional. Driving joins walking and scheduled transit. All trip clocks use America/Chicago, including next-day offsets.

Five independently testable modules share typed contracts rather than calling five LLMs:

| Module    | Implementation                                                                       | Responsibility                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs     | `navigation-needs-agent.ts`, existing preference controls                            | Validate declared needs; optionally interpret user-submitted text using the fast model. Show suggestions for explicit review/apply. No inferred coordinates, eligibility or appointment. Conservative local recognition of clearly stated needs works when inference is disabled.                                                                                                                     |
| Resources | `navigation-resource-agent.ts`, `access-service.ts`, existing pantry/inventory store | Reuse active maintained DB records and source dates. Keep private reviewed reports account-scoped. Household capacity, missing documents, old/unknown source dates and food-type gaps remain uncertain. Historical crowd summaries use only supported weekday/hour buckets; never substitute for a live queue or stock.                                                                               |
| Transport | `access-routing.ts`, existing OSM adapter and published GTFS router                  | Actual origin/destination, routed walking/driving geometry, scheduled buses with real walking connectors, transfer buffers, service calendars and the existing route budget. Driving fuel, parking, loading and approach-to-entrance costs/times remain unknown.                                                                                                                                      |
| Ranking   | `navigation-ranking-agent.ts`, `access-engine.ts`                                    | Deterministic feasibility before scoring: distribution/registration windows, arrival buffer, appointment, full-trip walking/fare/transfer/return limits, fresh availability at service time and published pedestrian policy. Urgency adds time until service, including waiting for a bus or opening. Near-transit preference increases the weight of actual walking connectors only in transit mode. |
| Guidance  | `navigation-guidance-agent.ts`, new guidance view                                    | Generate a concise explanation from computed evidence, actual alternatives, cautions and public contacts. The primary model may choose evidence IDs to foreground; it cannot author facts, change rankings, select a failed option, change timing or omit hard warnings. Turn instructions remain the actual routing-provider instructions in the itinerary, download and print view.                 |

`POST /api/access/plan` preserves the existing strict `input` and optional `destinationId`, adding optional `needs` and `explain` (default false). It returns optional `guidance` alongside the existing options. `POST /api/access/assist` preserves `{task:"preferences",text}` and returns optional typed `patch`/`needs`; neither is applied until the user requests it. Both enforce same-origin requests, body bounds and private/no-store responses.

The planner's straight-line calculation is used only to shortlist a bounded number of confirmed sites for actual routing. It is never a route distance, ETA or proof of reachability. Missing external routes leave distances unavailable. The existing budget checks up to five selected nearby sites; it does not promise a globally optimal regional search. A selected destination can be checked separately.

## Configuration

Use Node 24, `npm ci`, then `npm run dev`. Next loads `.env.local` automatically. The existing ignored **`/workspace/Reach/.env.local`** has missing OpenRouter variables appended with placeholders, preserving other values. On another machine, use the project-root `.env.local`. Never paste a real key into chat or use a `NEXT_PUBLIC_` key name.

```ini
REACH_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_FAST_MODEL=
OPENROUTER_PRIMARY_MODEL=
OPENROUTER_FALLBACK_MODEL=
REACH_AI_FREE_ONLY=true
REACH_AI_ALLOW_PAID=false
REACH_AI_DATA_POLICY_ACCEPTED=false
```

Fill exact model IDs after reviewing the current public [catalog](https://openrouter.ai/api/v1/models), [capability documentation](https://openrouter.ai/docs/guides/features/structured-outputs) and provider privacy terms. Both configured roles must support `tools` and `structured_outputs`. The client checks public catalog metadata, cached for at most 60 seconds; every completion still validates its output and free-profile cost constraints. This pipeline uses schema-constrained completions; it does not permit the model to execute tools, contact people or make arbitrary network requests. A catalog capability is model-level evidence; `provider.require_parameters` filters actual endpoints for requested parameters. There is no claim that a live endpoint has been tested here.

`FAST` handles needs/preferences and existing outreach assistance; `PRIMARY` handles guidance. An optional `FALLBACK` model must pass the same checks before any completion occurs. Blank fallback means at most one retry on the same model. Existing `REACH_AI_MODEL` is a legacy fallback; `REACH_AI_FAST_MODEL`/`REACH_AI_PRIMARY_MODEL` aliases are accepted but canonical `OPENROUTER_*` names take priority.

Keep `REACH_AI_DATA_POLICY_ACCEPTED=false` until you have reviewed and accepted the selected provider's terms. Change it to `true` only as the operator's explicit acknowledgement. With the provider disabled, placeholder credentials, unaccepted policy, invalid catalog or failed inference, manual controls and computed guidance still work. The AI-guidance checkbox is off by default and requires a separate user choice.

## Privacy and cost controls

Preference interpretation sends only the optional text submitted with the button; address/coordinate/contact patterns are rejected before inference, but this is not a perfect personal-data detector. The UI asks users to exclude identifying information. Guidance sends only generated public route timings, routed totals and availability uncertainty. It excludes origin coordinates, raw routing instructions, addresses, contact/profile information, household pickup data and private reply text. No prompts or provider error bodies are logged.

Free-only is the default: every selected or fallback model must be `openrouter/free` or end in `:free` and have explicit, nonblank zero catalog prices for prompt, completion and all reported pricing fields. Requests set `data_collection:"deny"`, `require_parameters:true`, `allow_fallbacks:false` and zero `max_price` ceilings for prompt/completion/request/image. No automatic model list or silent paid fallback exists. These controls cannot establish the account's quota, downstream retention or a billing guarantee. `data_collection:"deny"` is not a zero-retention promise. Paid use requires both `REACH_AI_FREE_ONLY=false` and `REACH_AI_ALLOW_PAID=true`.

The shared client bounds catalog bodies to 8 MiB and completion bodies to 64 KiB, with an 8-second overall deadline and cancellation. At most two completions occur. Transient network/5xx errors can use the explicit fallback; authentication or invalid JSON/schema returns to local guidance. A short Retry-After may be honored within the bounded wait; a delay over 500 ms stops the operation rather than bypassing the provider's delay. Every completion attempt, including a retry, consumes a quota unit. Catalog preflight also reserves the first unit, so failed preflights conservatively consume capacity. Three failures within a minute open a short circuit.

Process-local ceilings are 128 reserved attempts/day and 20/minute shared across OpenRouter features, plus 32/day and 5/minute per feature by default. Features are `PREFERENCES`, `NEEDS`, `GUIDANCE`, `DRAFT`, `REPLY`; `REACH_AI_<FEATURE>_<DAILY|MINUTE>_LIMIT` can lower/configure these within the ceilings, and zero disables a feature. Invalid settings fail closed. These counters reset on process restart and do not coordinate multiple processes. Before multi-instance deployment, use a shared persistent limiter and provider account spending caps. Free-model availability and provider limits change; no compute or infrastructure cost saving is guaranteed.

Optional ranking overrides in `REACH_ACCESS_WEIGHTS` are strict JSON fields with finite values from 0 to 100: `travelMinute`, `walkingMinute`, `dollar`, `transfer`, `uncertainty`, `closingSlackMinute`, `waitingMinute`, `timeToServiceMinute`. Defaults are 1, 2, 4, 8, 12, 0.1, 0, 0 respectively. Declared urgency adds 2 (soon), 0.5 (today), or 0 (flexible) to `timeToServiceMinute`; near-transit preference adds 2 to walking-minute weight in transit mode. These are ranking points, not probabilities. No weight can erase a hard failure.

## Coverage and verification

There are 24 maintained food sites, 21 confirmed distribution sites and three unresolved records in the retained catalog. No new pantry or schedule records were fabricated. Prepared-meal and shelter requests return an explicit lack of verified catalog coverage, not pantry recommendations. A household size never establishes sufficient quantity; having ID never proves eligibility. Pickup registration and food-distribution windows remain separate facts.

Only scheduled BTD Route 00 Orange is integrated. The existing GTFS/PDF disagreement remains a caution, no live predictions exist, and expired service data produces unavailable service. CapMetro is documented as a legitimate future data source; no feed/route/fare integration or TX-10 route overlap is claimed. Restricted school buses and demand-response service remain distinct. See [official provider research](NAVIGATION-PROVIDERS.md), [BTD audit](ACCESS-INTEGRATIONS.md), and [GTFS provenance](GTFS.md).

See [independent navigation verification](NAVIGATION-VERIFICATION.md) for observed browser/backend checks and remaining blockers. Automated model responses and routes in tests are synthetic fixtures, not evidence of live inference. The public OpenRouter catalog returned HTTP 200 during this task (468 models, five free entries advertising both required capabilities); **no authenticated OpenRouter completion ran**. Existing mapping/routing functionality is preserved. No public deployment was performed.

## Run the checks

`npm test`, `npm run typecheck`, `npm run data:validate`, `npm run access:evaluate` and `npm run build` run the deterministic checks. The `test:e2e` script now loads the existing `tsx` hook so Node 24 can collect retained tests that import server data through JSON modules. For browser fixtures, point `REACH_TEST_URL` at an isolated development server and run `npm run test:e2e -- tests/navigation-flow.spec.ts --project=mobile --project=desktop`. The retained outreach browser case additionally requires explicit private `/tmp` database/preview paths and preview-only email; its safeguards reject production storage. See the final [verification report](NAVIGATION-VERIFICATION.md) for actual counts and fixture/live distinctions.
