import { createCommunityHandler } from "@/lib/community";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handle = createCommunityHandler();
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, context: Context) {
  return handle(request, (await context.params).path);
}
export async function POST(request: Request, context: Context) {
  return handle(request, (await context.params).path);
}
export async function PATCH(request: Request, context: Context) {
  return handle(request, (await context.params).path);
}
export async function PUT(request: Request, context: Context) {
  return handle(request, (await context.params).path);
}
export async function DELETE(request: Request, context: Context) {
  return handle(request, (await context.params).path);
}
export async function HEAD(request: Request, context: Context) {
  return handle(request, (await context.params).path);
}
export async function OPTIONS(request: Request, context: Context) {
  return handle(request, (await context.params).path);
}
