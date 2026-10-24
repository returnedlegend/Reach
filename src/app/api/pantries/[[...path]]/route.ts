import { createPantryHandler } from "@/lib/pantry-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createPantryHandler();
type Context = { params: Promise<{ path?: string[] }> };
async function route(request: Request, context: Context) {
  return handle(request, (await context.params).path || []);
}
export {
  route as GET,
  route as POST,
  route as PATCH,
  route as PUT,
  route as DELETE,
};
