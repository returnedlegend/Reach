# Reach: executive product, engineering and release-readiness report

> Follow-up: [the implemented first-release candidate](FIRST-RELEASE.md) contains newer changes and verification. This assessment remains a dated record.

**Assessment date: October 24, 2026, America/Chicago.** This report evaluates the existing Reach project, records the changes implemented during this assessment, and separates code that works from services or operating assumptions that remain unverified. It is a release decision document, not a claim that a public service, pantry partnership, or student competition eligibility has already been established.

## Executive judgment

Reach has a substantial working application. It can present maintained food-assistance records, collect a chosen location without requiring an account, show maps, retrieve configured walking/driving routes, evaluate service-window and travel constraints, preserve useful plans, and support private account and communication workflows. The project has progressed beyond a mockup. The strongest product idea is not a long menu of features: it is helping a person decide where a realistic food-assistance trip can work, including the journey home.

The current gap is the connection between software correctness and a successful real visit. A route to the right address does not prove that a person on foot may collect food there. A published distribution schedule does not prove food remains available. A user's acknowledgement does not prove that a pantry accepts their identification or residency. Passing tests cannot settle those facts. Reach should express what it can establish and give a practical next action when it cannot.

My release recommendation is an anonymous, English-language directory and explainable trip-planning release with visible limits. Keep community exchange, volunteer dispatch, real outreach and other account-dependent services disabled until their separate operational requirements pass. This preserves the value already built while keeping visitors away from unsupported promises. A Congressional App Challenge demonstration can show the actual implementation and its engineering decisions without pretending every external service is production-ready.

## How to interpret the evidence

A feature can be implemented, pass synthetic tests, work in a running local build, succeed against a real external API, and still lack a reliable public operating arrangement. Those are separate milestones. This report uses the source, the current tests/build, the local Docker image, and dated real provider observations. Browser fixtures are explicitly synthetic; they are not live service verification. No pantry or person was contacted during this work, and no email or AI inference was sent as part of the readiness audit.

The maintained data currently contains **24 sites**, of which **21 are classified as confirmed sites** and **three need location/details confirmation**. All 24 have stored coordinates; 21 have structured distribution windows. Eighteen do not have verified pedestrian-pickup permission. The source check dates in the data span October 16–22, 2026. These are database/source classifications, not a new physical-site inspection. The exact metrics and unresolved IDs are in [readiness metrics](evidence/readiness-metrics.json).

## Feature-by-feature assessment

## The actual recommendation algorithm

The older service computed trip scores but chose only a few nearby sites for route checking. That meant a closed nearby site could occupy a scarce selection slot before a farther viable pantry was considered. The new implementation spends those slots on actual candidate checks after known exclusions. It also binds a route request to the candidate's identity, preventing a selected origin's matching coordinates from accidentally authorizing another destination.

First, Reach validates the actual selected coordinates, Chicago date/time and declared limits. It considers the recorded distribution windows, closures, registration opening/cutoff, visit length, appointment condition and pedestrian policy. If the window is impossible even with zero travel, it can be rejected without requesting a route. That zero-travel check is a necessary condition, not an invented itinerary. The engine then requests real trips for eligible candidates, checks actual walking/fare/transfer/arrival limits, models registration and service completion, and checks the requested return.

The winner must have a confirmed-site location, valid coordinates, a retrieved outbound trip and a usable timed visit. If the person requested a return, it must also have a retrieved return. An unverified location or a route with unknown service hours can remain available for browsing and contact without being described as the recommended pantry. Known failures rank below viable options; missing facts remain explicit confirmation requirements.

Within the feasibility tier, the score subtracts modeled burdens and adds a limited intake-buffer benefit:

```text
score = closing-buffer bonus
      - travel - extra walking - fare penalty - transfers
      - modeled uncertainty - waiting - time until service
```

The default weights are documented in [the algorithm guide](PANTRY-RECOMMENDATION.md). Walking receives an additional burden penalty beyond its contribution to total travel. Urgency can favor earlier service. Unknown fare is penalized and displayed as unknown; the penalty is not an estimated price. Every full evaluated option exposes its score components. Higher score is preferable within the applicable feasibility tier; these points are not a probability of receiving food.

The algorithm retains non-dominated tradeoffs before filling the displayed alternatives. For example, a faster trip with more cost and a slower trip with less walking may both deserve consideration. This is a practical Pareto comparison over the configured cost dimensions. It does not let an AI invent a “confidence score” or override a user's hard constraints.

The current request defaults to up to eight eligible candidate attempts, configurable from one to 24. The street-routing adapter independently caps requests at 12 external calls and 25 seconds. Transit and return trips can use several calls. Those limits protect response time, privacy and provider capacity, and must be disclosed rather than hidden. If routes, service windows or returns are unresolved, the response says the comparison is incomplete. A genuinely exhaustive optimum would require reliable facts and itinerary coverage for every relevant alternative; the project does not have that evidence today.

A real test through the new handler used the official BTD Bryan Terminal example origin and requested a Monday October 26 walking round trip. It conditionally selected Brazos Church Pantry, retrieving approximately **0.2701 miles and six minutes each way** from Valhalla/FOSSGIS. Seventeen records were eliminated before street routing; three had retrieved itineraries; two still had unresolved trip/service information; three locations were excluded as unverified. Some counters overlap because a routed site can still have unknown service facts. The API correctly labeled the comparison incomplete and did not claim confirmed food, eligibility or pedestrian pickup. [The live evidence](evidence/live-recommendation.json) is separate from the synthetic regression tests.

The next algorithm investment should be better inputs and measured evaluation, not a more elaborate AI prompt. Confirm pedestrian access, express eligibility and schedule exceptions in structured fields, compare results with a human planner using the same constraints, and measure actual failure reasons with permission. Without that loop, changing score weights is a design choice rather than evidence of better real-world outcomes.

## What makes the release genuinely useful

For a person depending on food assistance, three questions matter most: will this place serve me, can I realistically reach it, and what should I do if the plan fails? Each result should answer with evidence or a plainly labeled unknown. A prominent phone number, an authoritative source link, a recorded pickup window and a clear external-directions fallback can be more useful than another account feature.

The biggest data gap is pedestrian pickup. Eighteen maintained records do not establish whether someone arriving on foot may collect food. A drive-through address is not proof that a pedestrian can safely enter or receive food. The first field-validation effort should establish two or three dependable walking/public-transit food trips, including the actual entrance, crossing, intake process, relevant restrictions and return service. That needs permissioned confirmation or fieldwork; no code change can honestly substitute for it.

Inventory needs a similar operating process. Ask who is allowed to report food, how old the report may become, whether it applies to a category or the whole pantry, and what happens when stock changes. A record saying “produce available” must not imply all dietary needs or enough food for any household. Private replies should remain private until appropriately reviewed; they should not silently overwrite public organization facts.

Accessibility requires actual keyboard/screen-reader and low-end-phone testing. Scoped automated contrast/focus checks are valuable, and the new default respects stored light preferences, but they are not certification. The map must remain optional, controls must be large, forms must retain answers, errors must offer recovery, and geolocation denial must not trap the visitor. Spanish support should be translated and reviewed as service instructions, not attached as an unverified machine-translation badge. A bounded offline reference could help, but it must never pretend to compute fresh directions or bypass public tile policies.

## Publication architecture and its limits

This is a concrete deployment path, but a public release still needs a host, a domain under the owner's control, correct DNS, HTTPS issuance, private environment settings and final checks at that exact public origin. An ephemeral or horizontally scaled serverless deployment does not safely fit the current local SQLite design. A managed relational database migration is an alternative project, not something a hosting toggle accomplishes. Free geographic data and free AI variants do not establish free hosting, perpetual provider capacity or zero operating costs.

Backups, restore, maintenance and ownership are part of publishing. Stop ingress and all database writers for the documented offline backup, protect snapshots, and test recovery with disposable data before relying on the process. Run pruning and workers deliberately with the same database/origin. Maintain security updates and sanitized monitoring. Avoid access logs that retain OAuth codes, exact origins, private message bodies or keys. The publishing runbook explains the commands and release gates; no public infrastructure, domain purchase or paid service was created during this task.

For the initial release I would keep accounts/email/community off unless they pass their own acceptance checks. Anonymous food search and travel planning already carry the mission. A visitor should not have to navigate a broken signup or seek moderator approval merely to learn where to request food. Before a broader launch, remove or clearly explain dead-end navigation to disabled services and establish who responds to corrections, abuse and incidents.

## Current integration blockers

The actual routing observation used Valhalla/FOSSGIS demonstration service. It worked, but a public student app should deliberately choose a suitable operating arrangement, comply with rates/attribution and preserve provider-switching/failure behavior. BTD data needs its own work: resolve the schedule conflict, expand reviewed coverage, keep service dates current and distinguish demand-response/restricted services. OSM geometry is not a source of bus departures.

## Congressional App Challenge: a separate acceptance gate

The official-source review found two urgent submission facts. First, the 2026 rules call for a **public 1–3 minute YouTube or Vimeo demonstration** with participant names, app name, purpose, audience, tools/languages and functionality. The existing 30-second video is a useful teaser but does not satisfy that stated range. It also predates the new dark default and recommendation panel; a final demonstration should show the actual current build and honestly identify the sample origin and unverified conditions.

Second, official sources disagree on the October 26 deadline. The registration page says 9 p.m. ET, which is 8 p.m. America/Chicago. The official 2026 rules PDF says noon EDT, which is 11 a.m. America/Chicago. Prepare for the earlier time unless the official portal/organizer establishes another cutoff. The main agent independently fetched both official sources successfully after the research agent's review; [the requirements document](CHALLENGE-REQUIREMENTS-2026.md) preserves the links and discrepancy. No registration or organizer contact was performed.

The rules also matter for authorship. They allow supporting AI use while requiring student/team technical contribution and full AI disclosure. This project history contains substantial AI-generated implementation, integration, testing and documentation. A truthful submission must describe what each actual participant created, reviewed and can technically explain, and how AI and libraries contributed. An AI cannot certify those personal facts or guarantee eligibility. Do not say the project was wholly student-written if that is untrue; seek official clarification where needed. The app's service-area map does not establish the student's district eligibility.

The reviewed rules allow judges to request reasonable app/source access. They did not establish a universal public-code, specific-host or production-deployment requirement. That means unresolved optional email should not distract from finishing a clear, truthful demonstration of the working core. Register, confirm the participating district and team rules, prepare factual answers, document outside tools, and provide access as requested. [Submission preparation](SUBMISSION-PREPARATION.md) includes a 1 minute 50 second storyboard and answer prompts without inventing participant names, users, interviews or partnerships.

## Release priorities and acceptance criteria

**P0 — Finish the contest package and release scope.** Confirm eligibility/deadline/authorship, prepare the required video and factual submission, choose the final host/domain and decide which optional features are intentionally off. Acceptance means an actual participant can explain the algorithm and limitations, open the app for judges, and provide source access as required. Tests alone do not pass this gate.

**P0 — Publish the working anonymous core correctly.** Use the tested persistent single-host deployment, correct public origin and HTTPS, private configuration and tested recovery. Verify health, pantry browsing, manual location, provider failures, save/download and the recommendation explanation at the real URL. Publish only after the owner authorizes the host/DNS action. Acceptance requires an actual public-origin check, not a screenshot of localhost.

**P1 — Validate real food-access journeys.** Resolve or quarantine the three uncertain sites, confirm pedestrian pickup/entrances for initial recommendations, verify relevant intake/appointment rules and at least one full outbound/return trip, and establish a correction contact. Acceptance requires source/field evidence with dates, not guessed map pins or generated stock.

**P1 — Choose provider operations.** Adopt a suitable geocoder/router or transparently ship external handoffs; resolve/label transit conflicts and track feed expiry; configure sanitized monitoring, backups/pruning and responsibility for outages. Acceptance means a failed provider leaves useful instructions and a working directory, and an operator knows what to repair.

**P2 — Improve access and evaluate outcomes.** Add reviewed Spanish, better low-bandwidth reference information and permissioned user testing. Measure whether people could understand requirements, find the entrance, receive the intended service and return, while minimizing personal data. No impact statistics or success rate is currently established.

## Implementation, tests and review

The source changes include dark bootstrap/default theme and toggle behavior; candidate-identity and budget-aware search; pre-route timing/appointment exclusions; transparent score components, Pareto-aware alternatives and comparison metadata; recommendation UI and deterministic guidance binding; readiness health; standalone production output; runtime worker dependency packaging; Docker/Compose/Caddy/environment examples; CI; and detailed algorithm/publication/submission documentation. Secrets were not moved into source or image layers.

The new unit coverage includes theme storage failures, recommendation eligibility and score arithmetic, unknown fare, missing hours/return, tradeoffs, budget disclosure, ID-based routing and the new database health endpoint. Integrated handler tests use isolated SQLite plus synthetic route responses. Independent review caught an unused Pareto-frontier result; displayed alternatives now prioritize meaningful tradeoffs and a regression test proves the change. The live-provider example remains separate evidence.

At the final app/test snapshot, **536 unit tests across 58 files**, data validation (24 production and six fictional demo records), TypeScript and the production build passed. Thirty distinct targeted mobile/desktop browser cases passed across the final runs: dark-first behavior, stored choice, cross-tab removal, denied storage, recommendation/no-recommendation states, community recovery, layout and scoped automated accessibility. Four new recommendation browser cases initially failed because the test locator matched both starting-point and optional return controls; the selector was corrected and all four passed without changing application authorization. These results are not a claim that every historical browser suite, every physical device, a screen reader or a live account/mail workflow was rerun.

The production image build found and fixed two packaging defects: the builder needed the evaluation script's fixtures for TypeScript checking, and the runtime worker needed root `data/` assets. Production `tsx` packaging now uses the existing locked package versions. A separate recovery test also found that copying only the SQLite main file could omit committed WAL data. The publication procedure now uses a stopped-writer `VACUUM INTO` snapshot; container replacement, restored marker contents, integrity and health were exercised successfully on a disposable volume. CI is added to reproduce unit/data/type/build and image checks on GitHub; its remote run is not claimed passed until observed. Exact counts and operational verification are recorded in the linked evidence and final handoff.

Luna subagents handled bounded theme work, source/evidence inventory, official rules research and deployment-kit preparation; main owned the recommendation architecture, integration, real handler probe and final report. Independent checks inspected the changes and exercised focused suites. No token/cost savings, field validation or production uptime is invented.

## Final decision

Reach now has a stronger recommendation path, the requested dark default and a tested publication architecture. I would approve finishing and demonstrating the scoped core with precise limitations. Broad public-service readiness still depends on authoritative data, a real host/domain and accountable operating processes. The next work should make a small number of food-access journeys dependable and finish an honest contest submission, rather than add another unverified feature.
