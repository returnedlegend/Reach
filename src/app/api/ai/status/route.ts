import { getAIServiceStatus } from "@/lib/ai-config";
import { privateResponse } from "@/lib/access-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return privateResponse(getAIServiceStatus());
}
