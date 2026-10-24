import { createOutreachHandler } from "@/lib/outreach";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createOutreachHandler();
async function route(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return handle(request, (await context.params).path || []);
}
export { route as GET, route as POST };
