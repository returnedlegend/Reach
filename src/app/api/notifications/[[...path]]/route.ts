import { createNotificationsHandler } from "../../../../lib/notifications-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  return createNotificationsHandler()(
    request,
    (await context.params).path ?? [],
  );
}
export { handler as GET, handler as PUT, handler as POST };
