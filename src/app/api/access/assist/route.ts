import { z } from "zod";
import { interpretNavigationNeeds } from "@/lib/navigation-needs-agent";
import {
  accessFailure,
  privateResponse,
  readPrivateJson,
  requireSameOrigin,
} from "@/lib/access-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = await readPrivateJson(
      request,
      z
        .object({
          task: z.literal("preferences"),
          text: z.string().trim().min(1).max(1200),
        })
        .strict(),
    );
    return privateResponse(
      await interpretNavigationNeeds(body.text, { signal: request.signal }),
    );
  } catch (error) {
    return accessFailure(error);
  }
}
