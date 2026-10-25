import { after } from "next/server";
import { postSharingSubmission } from "@/lib/sharing";
import { openCommunityDatabase } from "@/lib/community";
import { dispatchSharingAlerts } from "@/lib/sharing-alerts-worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const response = await postSharingSubmission(request);
  if (response.ok)
    after(async () => {
      try {
        await dispatchSharingAlerts(openCommunityDatabase(), { limit: 1 });
      } catch {
        console.error(
          "Sharing alert dispatch failed; review the private outbox.",
        );
      }
    });
  return response;
}
