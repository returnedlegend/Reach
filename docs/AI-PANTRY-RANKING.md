# AI pantry comparison

The food-first search now asks the configured AI (local Ollama/Llama by default)
to compare matching pantry records, rather than only extract a service type.
The person can describe priorities in the existing search box, for example
“food in Bryan without an appointment” or “groceries in Bryan on Saturday.”

## Data and boundaries

- Candidates come from the active server directory. Existing geographic/service
  filtering runs first. Only confirmed pickup sites qualify; known prohibited
  pedestrian pickup is excluded for walking/transit comparisons.
- Up to six matching candidates are compared in one model request. This is a
  comparison of that shortlist, not a nationwide or mathematically optimal search.
- The prompt includes maintained offerings, distribution schedules, computed next
  published windows in Central time, requirements, access notes and freshness.
  Registration, distribution and appointment information remain distinct.
- The request text is sent to the configured provider. Selected coordinates,
  account data and credentials are not included. The existing sensitive-text
  check rejects addresses, phone numbers and email addresses in the request.
- The model returns a shortlist of ordered candidate IDs and the main supporting
  fact key. Explicit service and mode handling remains in the existing local parser. It cannot create pantry records or write explanations.
  The server displays the selected fact plus schedule and requirements text; unknown facts stay unknown.
- Ollama native JSON-schema output constrains generation. The server also validates
  the response, rejects invented/duplicate IDs and empty recommendations, and refuses ungrounded
  reason keys. Text inside the request and directory is treated as data.
- Existing privacy consent, release controls, rate limits and timeouts still apply.
  No automatic cloud-provider fallback was added.

## What the person sees

Cards can change order after comparison. The first is labeled “AI's first suggestion
to check,” with the published facts used in the comparison. It is not a promise of
food stock, eligibility, appointments, safe access or a feasible journey.

Existing computed trip recommendations remain separate and authoritative for
travel feasibility. AI order does not override their checks. Exact origins and
routed travel times are not available to this comparison model.

Directory results appear immediately. Timeouts, invalid output and unavailable AI
leave them usable with an honest message. Comparisons expire after five minutes.
A new search, disabling AI, changing location or manually changing travel mode
clears the previous comparison. Submit again to compare the updated request.

## Operations

No new key or provider is required. Use the Ollama configuration in LLAMA.md.
Model latency depends on hardware and load; concurrent builds/browser tests can
consume enough CPU to hit the configured timeout. Do not raise timeouts without
considering hosting limits. A valid structured response is not proof that the
model made the best choice: human review and source verification remain necessary.

Official reference: https://docs.ollama.com/capabilities/structured-outputs

## Schedule guard

For an explicit “only … Saturday” (or other named weekday) restriction, complete,
non-conflicting structured schedules are checked before inference. Known weekday
mismatches cannot be promoted by AI. Multiple explicitly permitted days are kept.
Unverified or missing schedules remain unknown, not evidence that pickup is possible.
The guard does not establish a booking, food stock or a usable trip on that date.

## Validation

The implementation includes tests for changed model order, grounded explanations,
invented and duplicate IDs, unsuitable-site exclusion, sensitive text, provider
failure, empty and partial recommendations, explicit weekday restrictions, native
schema requests, stale results, mobile ordering and disabling AI. Live evidence
is recorded separately from fixture-based tests in the evidence directory.

Final checks on October 25, 2026: **678 unit tests in 75 files**, TypeScript,
production data validation and production build passed. **18 mobile/desktop
browser cases passed** after fixing stale-result handling. Earlier browser runs
during active development had failures; the final stable run passed all cases.

A separate actual mobile-browser request for Saturday pickup reached local
Llama 3.2 3B and returned HTTP 200 with an AI ranking. A Hopeful Harvest moved
to the first visible card; its explanation showed the recorded Saturday schedule
and requirements. See [live response](evidence/llama-ranking-live.json) and
[mobile screenshot](evidence/llama-ranking-mobile.png).
Earlier loaded-CPU attempts timed out, and an earlier unconstrained response failed
validation; neither was presented as AI success. Native schema generation and the
smaller response contract were exercised successfully.

This is not an independently certified optimal ranking. Lower-ranked options with
incomplete/conflicting schedules still need confirmation; the structured weekday
guard intentionally does not infer missing facts from prose. Source freshness,
food availability and trip feasibility remain separate limitations.
