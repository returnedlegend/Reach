import { getSharingPhoto } from "@/lib/sharing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return getSharingPhoto(request, (await context.params).id);
}
