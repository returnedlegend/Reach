import { z } from "zod";
import { AccountError } from "./account-store";
import { accountRequestOrigin } from "./auth-origin";

export const privateResponse = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== accountRequestOrigin(request))
    throw new AccountError(403, "Reload Reach and try again from this site.");
}
export async function readPrivateJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit = 16384,
): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError(400, "Request body is required.");
  let size = 0,
    expired = false;
  const parts: Uint8Array[] = [];
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, 4000);
  try {
    for (;;) {
      const r = await reader.read();
      if (expired) throw new Error();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new AccountError(413, "Request is too large.");
      }
      parts.push(r.value);
    }
    const parsed = schema.safeParse(
      JSON.parse(Buffer.concat(parts).toString("utf8")),
    );
    if (!parsed.success) throw new Error();
    return parsed.data;
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(400, "Check the fields and try again.");
  } finally {
    clearTimeout(timer);
  }
}
export function accessFailure(error: unknown) {
  return privateResponse(
    {
      error:
        error instanceof AccountError
          ? error.message
          : error instanceof RangeError
            ? error.message
            : "This request could not be completed. Please try again.",
    },
    error instanceof AccountError
      ? error.status
      : error instanceof RangeError
        ? 400
        : 503,
  );
}
