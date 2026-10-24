import { createGoogleAuthHandler } from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createGoogleAuthHandler();
async function route(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handle(request, (await context.params).action);
}
export { route as GET, route as POST };
