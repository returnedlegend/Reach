import { openCommunityDatabase } from "@/lib/community";
import { createResendWebhookHandler } from "@/lib/resend-webhook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  try {
    return await createResendWebhookHandler(openCommunityDatabase())(request);
  } catch {
    return Response.json(
      { ok: false },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
