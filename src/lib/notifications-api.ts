import { featureEnabled, disabledFeatureResponse } from "./release-features";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  AccountError,
  accountFail,
  accountRate,
  accountTransaction,
  getAccountActor,
  requireAccountActor,
} from "./account-store";
import { accountRequestOrigin } from "./auth-origin";
import { openPantryDatabase } from "./pantry-store";
import {
  consumeUnsubscribeToken,
  getNotificationPreferences,
  initializeNotifications,
  saveNotificationPreferences,
} from "./notifications-store";
import { emailDeliveryMode } from "./mail-account";
const preferences = z
  .object({
    pantry: z.boolean(),
    volunteer: z.boolean(),
    pickup: z.boolean(),
    volunteerParticipation: z.boolean(),
  })
  .strict();
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (
    request.headers.get("origin") !== accountRequestOrigin(request) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    accountFail(403, "A same-origin request is required.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    accountFail(415, "Send JSON.");
  const reader = request.body?.getReader();
  if (!reader) accountFail(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 2048) {
      await reader.cancel();
      accountFail(413, "Request is too large.");
    }
    chunks.push(part.value);
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    accountFail(400, "Check the notification fields.");
  }
}
export function createNotificationsHandler(database?: DatabaseSync) {
  return async (request: Request, path: string[] = []): Promise<Response> => {
    try {
      if (!featureEnabled("email") && path.join("/") !== "unsubscribe")
        return disabledFeatureResponse("Email notifications");
      const db = database ?? openPantryDatabase();
      initializeNotifications(db);
      if (
        path.length === 1 &&
        path[0] === "unsubscribe" &&
        request.method === "POST"
      ) {
        const data = await body(
          request,
          z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
        );
        accountRate(db, "unsubscribe:global", 120, 60);
        accountTransaction(db, () => consumeUnsubscribeToken(db, data.token));
        return json({
          message:
            "If this link is current, optional email notifications are now off. You can also review preferences in your account.",
        });
      }
      const actor = requireAccountActor(db, request);
      if (!path.length && request.method === "GET")
        return json({
          preferences: getNotificationPreferences(db, actor.id),
          deliveryMode: emailDeliveryMode(),
        });
      if (!path.length && request.method === "PUT") {
        const data = await body(request, preferences);
        accountRate(db, `notification-preferences:${actor.id}`, 20, 60);
        accountTransaction(db, () => {
          const live = getAccountActor(db, request);
          if (!live || live.id !== actor.id) accountFail(401, "Sign in again.");
          if (Object.values(data).some(Boolean) && !live.emailVerified)
            accountFail(
              403,
              "Verify your email before opting into notifications or volunteering.",
            );
          saveNotificationPreferences(db, actor.id, data);
        });
        return json({
          preferences: getNotificationPreferences(db, actor.id),
          deliveryMode: emailDeliveryMode(),
        });
      }
      if (
        path.length === 1 &&
        path[0] === "deliveries" &&
        request.method === "GET"
      ) {
        const hasDelivery = !!db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mail_deliveries'",
          )
          .get();
        // Provider data never includes message content or a recipient address here.
        const rows = db
          .prepare(
            "SELECT id,kind,status,created_at,updated_at,delivery_id FROM notification_outbox WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
          )
          .all(actor.id);
        const deliveries = rows.map((row) => {
          let status = row.status;
          if (hasDelivery && row.delivery_id) {
            const delivery = db
              .prepare("SELECT status FROM mail_deliveries WHERE id=?")
              .get(row.delivery_id);
            if (delivery) status = delivery.status;
          }
          return {
            id: row.id,
            kind: row.kind,
            status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        });
        return json({ deliveries });
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return error instanceof AccountError
        ? json({ error: error.message }, error.status)
        : json(
            { error: "Notification preferences are temporarily unavailable." },
            503,
          );
    }
  };
}
