import type { z } from "zod";

if (typeof window !== "undefined") throw new Error("Gemini client is server-only.");

export type GeminiJsonResult<T> =
  | { status: "available"; value: T; model: string; calls: 1 }
  | { status: "unavailable"; reason: string; transient: boolean; calls: 1 };

/** One bounded Gemini request for explicitly opted-in transient OpenRouter fallback. */
export async function geminiJson<T>(input: {
  model: string;
  key: string;
  prompt: string;
  jsonSchema: object;
  schema: z.ZodType<T>;
  fetch: typeof fetch;
  signal: AbortSignal;
}): Promise<GeminiJsonResult<T>> {
  let response: Response;
  try {
    response = await input.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.key,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: {
            responseFormat: {
              text: { mimeType: "APPLICATION_JSON", schema: input.jsonSchema },
            },
            maxOutputTokens: 1200,
            temperature: 0,
          },
        }),
        redirect: "error",
        cache: "no-store",
        signal: input.signal,
      },
    );
  } catch {
    return { status: "unavailable", reason: "Gemini request failed transiently.", transient: true, calls: 1 };
  }
  if (!response.ok) {
    const transient = response.status === 429 || response.status >= 500;
    return {
      status: "unavailable",
      reason: response.status === 401 || response.status === 403
        ? "Gemini credentials were rejected."
        : transient ? "Gemini is temporarily unavailable." : "Gemini request was rejected.",
      transient,
      calls: 1,
    };
  }
  let value: unknown;
  try {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 64 * 1024)
      throw new Error("response limit");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 64 * 1024) { await reader.cancel(); throw new Error("response limit"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    };
    const text = envelope.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
    if (typeof text !== "string") throw new Error("missing output");
    value = JSON.parse(text);
  } catch {
    return { status: "unavailable", reason: "Gemini returned an invalid response.", transient: false, calls: 1 };
  }
  const parsed = input.schema.safeParse(value);
  if (!parsed.success)
    return { status: "unavailable", reason: "Gemini returned an invalid response.", transient: false, calls: 1 };
  return { status: "available", value: parsed.data, model: input.model, calls: 1 };
}
