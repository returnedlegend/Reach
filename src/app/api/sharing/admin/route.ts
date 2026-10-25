import { getSharingAdmin } from "@/lib/sharing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return getSharingAdmin(request);
}
