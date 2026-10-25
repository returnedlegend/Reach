import { postSharingReview } from "@/lib/sharing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return postSharingReview(request, (await context.params).id);
}
