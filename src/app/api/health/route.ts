import { databaseHealth } from "@/lib/health";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return databaseHealth();
}
