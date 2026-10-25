# AI configuration

The current provider setup is [DeepSeek AI setup](DEEPSEEK.md). Reach uses the official DeepSeek API with `deepseek-flash` as its general model and `deepseek-v4-pro` for reasoning. Both are paid models. Inference remains disabled unless the operator configures a server-side key and accepts the provider data policy.

AI requests are bounded by a request deadline and process-local usage limits, and their results are checked against local schemas. There is no automatic cross-provider fallback. Keep user-submitted text free of identifying or sensitive information; see [privacy and cost details](DEEPSEEK.md#privacy-and-user-data).

The former OpenRouter setup has been retired. Historical OpenRouter configuration and verification documents describe earlier deployments and do not apply to the current provider.
