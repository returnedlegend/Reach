# Free OpenRouter verification

Independent verification performed October 24, 2026 UTC (October 23 in America/Chicago). Tests use a synthetic public catalog, synthetic completion responses, and a fake clock. No OpenRouter credentials or live inference were used.

## Results

| Requirement                                                                                                        | Result | Evidence                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Default free router and explicit free profile remain free despite stale paid/Gemini flags                          | Pass   | `tests/free-openrouter-independent.test.ts` checks request model, all-zero `max_price`, disabled provider fallbacks, and no Gemini call. |
| Catalog preflight is public, bounded to a 60-second metadata cache, and contains no prompt or authorization header | Pass   | Independent test inspects the GET and verifies expiry while sending distinct prompts only to completion calls.                           |
| Configured free models must advertise `tools` and `structured_outputs` and have zero reported prices               | Pass   | Tests reject missing prompt/completion prices and a nonzero request price before inference.                                              |
| Router output identifies a concrete catalog-verified free model                                                    | Pass   | Tests reject missing/null model, the router alias, and unlisted or paid models.                                                          |
| Positive, negative, and malformed string `usage.cost` are rejected; null cost is treated as unknown                | Pass   | Independent cost cases verify fail-closed behavior and accept null only with a verified free model.                                      |
| Unrestricted `openrouter/auto`, paid fallback, and Gemini fallback cannot silently enter the free profile          | Pass   | Invalid routing is rejected before use; a simulated 503 does not call another provider.                                                  |
| Returned JSON is locally schema-validated                                                                          | Pass   | Extra hallucinated eligibility data is rejected despite a valid free model and zero cost.                                                |
| Status reporting does not call a provider or reveal the API key                                                    | Pass   | `getAIServiceStatus()` is tested with global fetch stubbed; output contains no key.                                                      |
| TypeScript                                                                                                         | Pass   | `npm run typecheck`.                                                                                                                     |

Focused result: **10/10 independent tests passed**. This is not a full-suite or live-service result.

## Code and privacy review

The shared client keeps the OpenRouter endpoint fixed to its canonical HTTPS URL, uses bounded response sizes and an eight-second abort deadline, disables redirects, and validates completion JSON against the caller’s strict Zod schema. The free profile checks catalog prices/capabilities before requesting completion, sets zero price ceilings and `allow_fallbacks: false`, and accepts output only when the reported router-selected model is listed as free. The status function describes configuration only; it cannot establish model availability, a provider’s current behavior, or account billing.

The navigation preference caller rejects recognizable location, coordinate, phone, and email details before sending free text; its model schema only permits bounded preference enums and numbers. The route explanation caller sends generated evidence for public pantry options only, excludes status text and private household/pickup data, and lets the model reorder evidence identifiers without changing the deterministic ranking or authored facts. The outreach draft path keeps the message body fixed and validates an exact copy before using AI-selected subject text. These checks reduce exposure and constrain model authority; regex-based detection cannot guarantee that all sensitive details in natural language are detected.

OpenRouter’s request currently specifies `data_collection: "deny"`, but does not set `provider.zdr: true`. The official documentation treats these as distinct controls: `deny` filters providers OpenRouter marks as collecting data, while `zdr` requests inference endpoints with zero data retention. The request also does not make OpenRouter’s own handling disappear. Consider adding `zdr: true` if that is part of Reach’s intended privacy policy, and document the limits of both controls. This review did not make or validate that application-policy decision.

## Not verified

No credentials were configured, so live inference, real account quota, latency, selected-provider privacy behavior, and billing were not tested. Catalog contents and compatible free-provider capacity are mutable. The observed public catalog and official documentation are recorded separately in [FREE-OPENROUTER-RESEARCH.md](FREE-OPENROUTER-RESEARCH.md). No claim is made that provider-level zero-price metadata predicts account charges; the client rejects a positive reported completion cost but missing/null cost remains unknown.

## Main-agent integration checks

## Follow-up: supplied credentials, October 24, 2026 UTC

This follow-up was performed by the main agent and is separate from the independent fixture review above. The earlier missing-key observations describe that earlier test session.
