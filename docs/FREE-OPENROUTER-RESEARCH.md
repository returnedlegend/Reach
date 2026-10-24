# OpenRouter free-router research

Research checked October 24, 2026 UTC (October 23 in America/Chicago). This used OpenRouter’s public documentation and unauthenticated public model catalog only. No API key, inference request, account endpoint, or paid provider was used.

## Documented behavior

OpenRouter documents `openrouter/free` as a router that randomly chooses among currently available free models, filters candidates for request capabilities such as tools and structured outputs, and includes the actual chosen model in the completion’s `model` field. The docs describe the router and its routed requests as free. They also warn that model availability, performance, and free-model rate limits vary. A `:free` variant is a separate catalog model entry; a paid model in a model-fallback array can be billed when the free model fails. The docs say `openrouter/free` by itself falls back only to other free models.

For capability enforcement, the `provider.require_parameters` setting restricts routing to endpoints supporting every requested parameter; if none qualify, the request fails. Without that setting, unsupported parameters may be ignored. OpenRouter notes that `tools` and structured output support can differ by endpoint, even for the same model. `response_format: {type: "json_schema", ...}` with `strict: true` is supported by only some model endpoints, and OpenRouter cautions that strict-schema guarantees vary by provider. The app must validate the returned JSON against its own schema.

Privacy controls are provider routing filters, not blanket guarantees. `provider.data_collection: "deny"` excludes providers OpenRouter identifies as storing user data non-transiently or possibly training on it. `provider.zdr: true` restricts model inference to Zero Data Retention endpoints. OpenRouter states that ZDR does not filter the backends used by server tools or plugins, and its provider policy labels are based on its best knowledge. Do not describe these controls as eliminating OpenRouter’s own handling or making an unreviewed request private.

The documented `provider.max_price` field can cap prompt and completion pricing in dollars per million tokens. OpenRouter’s chat completion schema includes `usage.cost`, but it can be null. The free-router docs say the returned `model` identifies the selected free model. A client should inspect both fields; missing cost is unknown, not proof of zero cost. The request-level ceiling and the router’s documented free-only behavior are defense-in-depth, while local handling should fail closed for a paid/unrecognized model or reported positive cost.

OpenRouter’s current limits page documents `:free` variant caps of 20 requests/minute and 50 or 1,000 requests/day, depending on lifetime credits purchased. It exposes an account-specific `free_model_daily_requests` field from authenticated `GET /api/v1/key`. Those numeric caps are documented under free variants; the docs do not promise that every account or every `openrouter/free` request has the same effective quota. The router is described generally as lower-rate and capacity-limited. This research had no credentials and therefore did not inspect a specific account’s limits. Honor `Retry-After` when supplied; otherwise return an unavailable result instead of retrying aggressively.

## Public catalog observation

An unauthenticated `GET https://openrouter.ai/api/v1/models` on the date above returned 469 model records: 17 IDs ending in `:free`, of which five listed both `tools` and `structured_outputs` with prompt and completion prices of `0`. It also listed `openrouter/free` as “Free Models Router”, with prompt/completion prices of `0`, support for `tools`, `tool_choice`, `structured_outputs`, and `response_format`, and a declared context length of 200,000. The router catalog record’s endpoint listing was empty; it is a routing entry, not a normal provider endpoint. These mutable catalog values are an observation, not a durable allowlist or service guarantee.

One free-model endpoint was also queried publicly: `liquid/lfm-2.5-2.6b:free` reported zero prompt/completion pricing and endpoint-level support for tools and structured outputs at that moment. Its endpoint record did not expose a privacy field. This illustrates why capability and pricing should be checked at endpoint detail when selecting a fixed `:free` model; it does not establish the current provider privacy policy or behavior for the free router.

## Recommendations for Reach

1. Use `model: "openrouter/free"` as the free profile by itself. Do not append paid models or apply a paid fallback when free routing is unavailable. Preserve explicit paid-model controls only as a separate, deliberate profile; environment flags left from earlier configurations must not turn the free profile into a paid one.
2. Send the required JSON schema and set `provider.require_parameters: true`; set `data_collection: "deny"`, `zdr: true`, and zero prompt/completion `max_price` as request constraints where supported. If no eligible endpoint can satisfy the parameters and policies, fail closed rather than relaxing them.
3. Validate the model’s locally accepted free identifier and reported `usage.cost` before using the result. Treat a missing/null cost as unknown and a positive cost as a failed free-profile result. Keep hard eligibility, location, availability, and trip facts under deterministic planner authority; AI output may only supply bounded preferences or grounded explanation.
4. Treat free-model quality, quota, provider privacy, response-shape compliance, and availability as variable. Keep provider input minimal and exclude sensitive fields; validate strict JSON locally, bound retries, and present a clear unavailable state when the free router cannot complete.

## Sources

- [Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router.md)
- [Free Model Variant](https://openrouter.ai/docs/guides/routing/model-variants/free.md)
- [Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection.md)
- [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs.md)
- [Provider Logging and Data Retention](https://openrouter.ai/docs/guides/privacy/provider-logging.md)
- [Credit and Rate Limits](https://openrouter.ai/docs/api_reference/limits.md)
- [Public model catalog](https://openrouter.ai/api/v1/models)
- [Public free-model endpoint detail](https://openrouter.ai/api/v1/models/liquid/lfm-2.5-2.6b:free/endpoints)
