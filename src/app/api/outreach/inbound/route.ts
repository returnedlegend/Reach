import {
  featureEnabled,
  disabledFeatureResponse,
} from "@/lib/release-features";
import { openPantryDatabase } from "@/lib/pantry-store";
import { createOutreachInbound } from "@/lib/outreach-inbound";
import { privateResponse } from "@/lib/access-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!featureEnabled("email")) return disabledFeatureResponse("Email");
  try {
    return await createOutreachInbound(openPantryDatabase())(request);
  } catch {
    return privateResponse({ ok: false }, 503);
  }
}
