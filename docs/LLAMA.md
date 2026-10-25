# Reach's primary AI: Llama 3.2

Reach defaults to `llama3.2:3b` served by Ollama. Food searches use AI automatically, with a visible disclosure and a user control to turn interpretation off. The existing pantry database, feasibility engine, walking/transfer limits, distribution windows and return checks determine the recommendation. Llama interprets requests and highlights computed evidence; it cannot invent pantry facts or establish food stock. The highest-ranked checked pantry is not a claim of a globally optimal or guaranteed pickup.

## Run on Linux

Install Ollama from https://ollama.com/download/linux, then run `ollama pull llama3.2:3b`. Start `ollama serve` if the installer has not already started the service. Run Reach normally with `npm run dev`. The updated local and example configurations select Llama:

```ini
REACH_AI_PROVIDER=ollama
OLLAMA_MODEL=llama3.2:3b
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_TIMEOUT_MS=40000
REACH_AI_DATA_POLICY_ACCEPTED=true
REACH_RELEASE_PROFILE=extended
REACH_RELEASE_AI=true
```

Keep other feature gates at their reviewed values. An explicit `REACH_AI_PROVIDER=disabled` remains an operator emergency switch. DeepSeek remains available only when explicitly selected. Old DeepSeek keys no longer implicitly select the provider. No API key is needed for local Ollama; no cloud credentials are sent to it.

## Run the website with Docker Compose

The existing `deploy/compose.yaml` includes an internal Ollama service and one-time model pull. The app waits for the pull to complete. Models persist in `ollama-data`; the model port is not published. The website server reaches `http://ollama:11434/v1`; visitors need only their browsers. Follow [Publishing Reach](PUBLISHING.md) for domain, HTTPS and database setup. Building/running this setup requires downloading the Ollama image and roughly 2 GB of model weights and provisioning enough RAM/CPU. This pass does not publicly deploy it. The mutable official image tag should be pinned to a tested digest for an operator's production release.

Only loopback hosts and the exact private Compose hostname `ollama` are accepted. Arbitrary remote endpoints and redirects are rejected. The example uses CPU execution; performance depends on hardware and concurrent load. `llama3.2:1b` is available for smaller machines when running locally, but it may follow instructions less reliably. API billing is absent for local inference; hosting, hardware and electricity are not free. Review Meta's model license.

The shared JSON client retains its historical `deepseekJson` name for compatibility while dispatching according to the selected provider. Request quotas, cancellation, bounded output and strict schema validation apply to Llama. The server deadline defaults to 40 seconds (maximum60), and immediate directory results remain visible while inference runs. A stopped model, malformed response or timeout leaves honest directory results available. Email still requires user approval before sending.

Official references: https://docs.ollama.com/api/openai-compatibility and https://ollama.com/library/llama3.2 . Configuration status is not a live health check. See `docs/evidence/llama-primary-verification.json` for this pass's actual checks and live observations.

## Verification on October 25, 2026

All 651 unit tests, TypeScript, data validation and the production build passed. Four mobile/desktop browser cases verify default AI submission and outage recovery with controlled responses. A separate actual mobile-browser submission through `/api/food-search` successfully called locally installed Ollama0.40.11 with `llama3.2:3b`, returned HTTP200 with `assistance: ai`, interpreted groceries/transit, and kept three maintained pantry cards visible. The cold request took about16seconds on this environment's CPU; this is one observation, not a latency guarantee. No cloud model or paid API was used for that check. Docker Compose was parsed and inspected but was not launched. This proves local website inference, not deployment, actual food stock or live route availability.

## Fix for “AI was not used”

The food-search page previously skipped its API request when a server-rendered feature flag was false. An older core profile could therefore hide a configured local model even with `REACH_RELEASE_AI=true`. The client now asks the server when AI is enabled for the search, and the server returns a safe explanation for disabled configuration or provider errors. Explicit local AI enablement works in the core profile without enabling accounts, community or email. An explicitly disabled provider and the data-policy gate are still enforced.

The generic phrase “near me” is normalized to “nearby” before interpretation; it no longer trips the sensitive-location filter. Actual coordinates and addresses remain protected and the selected starting point is still used only by the planner.

On October25, a real mobile-browser “Find food near me” request reached local Llama3.2 under the core profile with explicit AI enablement, returned `assistance: ai` and showed three maintained records. The updated655 unit tests,14 controlled browser cases, TypeScript, data validation and build passed. See [live evidence](evidence/llama-ai-fix-verification.json). The installed/deployed copy still needs this code and a running Ollama model service. No hosted deployment was performed by this fix.

## Local development origin fix (October 25, 2026)

The old generic “AI service could not be reached” banner also covered non-2xx
responses from Reach itself, including origin rejection before inference.
With `npm run dev`, a configured `http://127.0.0.1:3000` and browser
`http://localhost:3000` could disagree. Anonymous food-search now accepts
same-origin requests using either loopback alias in development, provided the
configured origin is also local with matching protocol and port. Direct Host and
request URL must be loopback; forwarded headers do not grant access.
Production and account authentication keep their existing strict checks.
For a configured public URL or different port, correct `REACH_APP_ORIGIN` to
the intended site rather than bypassing validation.

The UI now displays the bounded error returned by Reach, while retaining pantry
results. This does not disguise an unavailable model as AI success.
Verification: 665 unit tests, TypeScript, data validation and production build
passed. Of 14 mobile/desktop controlled browser cases, 13 initially passed;
one mobile click timed out and passed on an isolated rerun. A separate real
mobile-browser submission using localhost against a development server configured
for 127.0.0.1 returned HTTP 200 and `assistance: ai` from local Llama3.2.
See [recorded live response](evidence/llama-local-origin.json).
This environment's success does not establish that a user's separate local
Ollama installation is running or has the model installed.

## Pantry comparisons

The main food search now uses Llama to shortlist and order up to six confirmed
matching sites using the person's request and maintained pantry facts.
[AI pantry comparison](AI-PANTRY-RANKING.md) documents the algorithm, guardrails
and limits. The model chooses IDs and a supporting fact key; Reach supplies the
actual schedule/requirements text and keeps trip feasibility separate.

### Diagnosing missing summaries (2026-10-25)

Run `npm run ai:check` from the Reach folder. It checks the configured local Ollama endpoint and installed model without printing credentials or sending personal information. Run `npm run ai:check -- --generate` to additionally exercise a small structured generation request. Reach configuration alone does not prove Ollama is running. Start Ollama on the machine running Reach and restart Reach after environment changes.

The comparison prompt now requests three short summaries instead of up to six, preserves numeric comparison parameters, and caps individual fact excerpts. The ranking output budget is 640 tokens (previously 256); a response truncated by the model produces explicit guidance. A comparison with no usable summary offers a retry instead of silently presenting scores as a generated summary. The two-minute local inference deadline remains bounded; this does not guarantee fast inference on every CPU.

Current verification environment: the diagnostic could not reach Ollama. No live generation success is claimed for this change; provider tests use fixtures.
