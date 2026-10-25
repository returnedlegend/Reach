# Reach demonstration guide

Use the actual running build to demonstrate the real pantry directory first. Reserve fictional timetable scenarios for the explicitly labeled legacy demonstration. A successful test, a map pin, a draft email and a live service response are different claims; explain which one the audience is seeing.

## Prepare before presenting

1. Follow [development setup](DEVELOPMENT.md#local-setup). Rehearse on both the presentation screen and a phone-sized viewport. Avoid changing code during the recording, since development hot reload can reset a workflow.
2. Review pantry sources and dates. The current maintained directory has 24 sites, not complete district-wide service coverage. Never promise current food supply or eligibility from a listing alone.
3. Decide which integrations you will actually use. Verify maps/search/routes beforehand; if a provider is unavailable, keep its honest fallback visible. `GET /api/ai/status` is configuration information, not proof that inference works.
4. Use a known public starting point only if you explicitly identify it as the demonstration origin. Do not imply that example coordinates are the viewer's actual location.
5. Use a clean browser profile or clear only the demo's saved resources. Keep private account tokens, personal origins, email previews and messages off the projected screen.
6. Do not enable live mail merely for the presentation. If demonstrating reviewed inquiries, use an authorized test account, an enrolled consenting recipient and a clearly explained preview workflow.

## Three minute real directory walkthrough

| Time      | Show                                                                                | Explain                                                                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:25 | Home and its starting-point panel                                                   | Reach helps people compare food assistance and practical ways to get there; exploration does not require an account                                                                         |
| 0:25–0:55 | Opt-in location or a clearly labeled public demo origin, then **Find food near me** | Location is a choice; manual controls work when permission is denied                                                                                                                        |
| 0:55–1:25 | Real pantry options and details                                                     | Compare recorded hours, requirements, sources and unknowns; straight-line distance is not a routed walking distance                                                                         |
| 1:25–1:55 | Map, pantry selection and TX-10 boundary                                            | The boundary is the supplied 119th Congress Census dataset; markers do not establish safe entrances or live inventory                                                                       |
| 1:55–2:30 | **Find food I can reach** or directions                                             | Deterministic timing, walking, transit and eligibility checks distinguish a known failure from missing information; only show retrieved itineraries when the provider actually returns them |
| 2:30–3:00 | Optional saved place or assistant, then close                                       | Saving is not booking; AI interprets or explains existing evidence rather than inventing routes or food availability                                                                        |

For a short presentation, choose one optional feature rather than rushing through every screen. Use the wording actually displayed. If route retrieval fails, explain the limitation and show the existing external directions handoff instead of narrating a fictional successful route.

## Optional assistant and email segment

The current AI provider and paid usage controls are described in [DeepSeek AI setup](DEEPSEEK.md). Use only a verified live response from that rehearsal or the honest unavailable state. A dated successful provider request does not ensure future capacity, quota, billing or privacy behavior. The dated supplied-credential observation in [verification](FREE-OPENROUTER-VERIFICATION.md#follow-up-supplied-credentials-october-24-2026-utc) is scoped to that request, not every assistant flow.

For an inquiry, explain each step: select an enrolled contact, generate a draft, review and edit the exact content, provide explicit approval, then inspect the real status. Editing the subject, body or follow-up choice clears prior approval. **Preview only** means no email was sent; provider submission is not inbox delivery or a pantry reply. Do not send an unsolicited real message during judging.

## Separately labeled fictional planner walkthrough

The original outline below applies to the retained `/pantry-planner` fixture mode, not the real directory walkthrough. Keep the fictional-data label visible and choose inputs within the supplied fixture's timetable period. Never describe those sample paths or contacts as operational coverage.

Allow about three minutes if using this as a separate scheduling-engine demonstration. State explicitly that these sample records and journeys are fictional.

1. **Explain the question.** “Can I visit a food pantry and get home within my available time?” Distinguish the separate maintained directory from this fixture. The imported Orange timetable has source conflicts and the retained engine's pantry walking links remain unreviewed; a complete real itinerary still needs verification.
2. **Enter the demonstration deliberately.** Point out the fictional-data label. Choose one of the three sample origins, a date within the fixture timetable period, departure and return limits, travel mode, total walking allowance, visit duration, and appointment status.
3. **Compare results.** Show a plan that fits the sample constraints, a rejected plan with a concrete cutoff or return conflict, and a result that needs confirmation. Explain why uncertainty does not mean automatic ineligibility. Use the actual explanations on screen rather than promising a predetermined outcome for arbitrary inputs.
4. **Inspect the round trip.** Open details. Identify the walks, scheduled rides, waits, visit allowance, and return deadline. Point out the separate registration and distribution windows and the source status. Explore a later departure and observe whether the computed result changes.
5. **Save the trip card.** Save a sample plan, download the plain-text card, and open print preview. Explain that saving does not reserve an appointment. Show the saved-plan removal control and explain that browser site data can also be cleared.
6. **Explain ownership and the next step.** Identify what students actually built and verified. Show the read-only source review and explain the validated data-file maintenance workflow. Finish with the work needed for real coverage: resolve the BTD timetable conflict, review one pantry walk and full round trip, then field-check the remaining coverage.

Do not present a demonstration provider phone number as real, claim live vehicle tracking, describe fixture walking paths as verified, or claim offline routing. Do not claim tests passed without actual execution results. A fictional success case does not satisfy the required manually cross-checked real itinerary.

For a recording, check that the fictional-data label remains visible and that narration never implies real operational coverage. No interviews, provider partnerships, or impact statistics should be added unless they have actually occurred and are documented.

## Answer common judging questions

- **What makes recommendations intelligent?** Deterministic constraints combine supported routes, arrival and return timing, published service windows, recorded requirements and explicit uncertainty. AI is optional interpretation/explanation, not a source of routes or pantry facts.
- **What happens without GPS or internet?** GPS denial has manual alternatives. Missing network/provider data stays unavailable. Saved snapshots and text exports are useful references, not an offline routing engine or current availability guarantee.
- **How is privacy protected?** Explain opt-in location, server-side secrets, private account boundaries, separate consent for precise saved origins and explicit approval before eligible mail dispatch.
- **What is still needed for public launch?** Pantry re-verification, reviewed access paths, provider configuration and capacity, canonical HTTPS, private persistent storage/backups, sender verification and the community safety/moderation review. See [launch limitations](FINAL-POLISH.md#external-service-and-launch-limitations).

For UI evidence and the latest alignment changes, see [final polish](FINAL-POLISH.md) and the [documentation index](README.md).
