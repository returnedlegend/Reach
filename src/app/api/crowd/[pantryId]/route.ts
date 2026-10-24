import { z } from "zod";
import { AccountError } from "../../../../lib/account-store";
import { accountRequestOrigin } from "../../../../lib/auth-origin";
import {
  getCrowdSummary,
  initializeCrowdSchema,
  submitCrowdReport,
} from "../../../../lib/crowd-store";
import {
  openPantryDatabase,
  getPantryRecord,
} from "../../../../lib/pantry-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reportSchema = z
  .object({
    level: z.number().int().min(0).max(3),
    waitMinutes: z.number().int().min(0).max(240).optional(),
  })
  .strict();
const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  Vary: "Cookie",
};
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers });
}
function sameOrigin(request: Request) {
  return (
    request.headers.get("sec-fetch-site") !== "cross-site" &&
    request.headers.get("origin") === accountRequestOrigin(request)
  );
}
async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 1024) {
      await reader.cancel();
      throw new AccountError(413, "Report is too large.");
    }
    chunks.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AccountError(400, "Invalid JSON.");
  }
}
export async function GET(
  request: Request,
  context: { params: Promise<{ pantryId: string }> },
) {
  try {
    const { pantryId } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(pantryId))
      return json({ error: "Pantry not found." }, 404);
    const db = openPantryDatabase();
    initializeCrowdSchema(db);
    if (!getPantryRecord(pantryId, db)?.active)
      return json({ error: "Pantry not found." }, 404);
    return json(getCrowdSummary(db, pantryId));
  } catch (error) {
    console.error("Crowd summary request failed");
    return json({ error: "Unable to load crowd information." }, 500);
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ pantryId: string }> },
) {
  try {
    if (!sameOrigin(request))
      return json({ error: "Same-origin requests are required." }, 403);
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return json({ error: "Send a JSON report." }, 415);
    const decoded = await boundedJson(request);
    const body = reportSchema.safeParse(decoded);
    if (!body.success) return json({ error: "Invalid crowd report." }, 400);
    const { pantryId } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(pantryId))
      return json({ error: "Pantry not found." }, 404);
    const db = openPantryDatabase();
    initializeCrowdSchema(db);
    submitCrowdReport(db, request, pantryId, body.data);
    return json({ ok: true }, 201);
  } catch (error) {
    if (error instanceof AccountError)
      return json({ error: error.message }, error.status);
    console.error("Crowd report request failed");
    return json({ error: "Unable to save crowd report." }, 500);
  }
}
