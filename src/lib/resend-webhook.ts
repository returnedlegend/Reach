import type { DatabaseSync } from "node:sqlite";
import { Resend } from "resend";
import { initializeMailSchema } from "./mail-schema";

if (typeof window !== "undefined")
  throw new Error("Mail webhooks are server-only.");
const reply = (status: number) =>
  Response.json(
    { ok: status === 200 },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
export async function rawBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") || 0) > 65536)
    throw new Error("Body too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0,
    expired = false;
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, 4000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (expired) throw new Error("Body timeout");
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}
const statusForEvent: Record<string, string> = {
  "email.sent": "accepted",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.failed": "failed",
  "email.suppressed": "failed",
  "email.bounced": "bounced",
  "email.complained": "bounced",
};
const rank: Record<string, number> = {
  pending: 0,
  accepted: 1,
  uncertain: 1,
  preview: 1,
  delayed: 2,
  held: 2,
  failed: 3,
  delivered: 4,
  bounced: 5,
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  );

/** Verify raw payloads with Resend's SDK; retain only opaque delivery metadata. */
export function createResendWebhookHandler(
  db: DatabaseSync,
  options: { now?: () => Date } = {},
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return reply(405);
    const secret = process.env.RESEND_WEBHOOK_SECRET || "";
    if (!/^whsec_[A-Za-z0-9+/=]{16,200}$/.test(secret)) return reply(503);
    const id = request.headers.get("svix-id"),
      timestamp = request.headers.get("svix-timestamp"),
      signature = request.headers.get("svix-signature");
    if (
      !id ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(id) ||
      !timestamp ||
      !/^\d{9,12}$/.test(timestamp) ||
      !signature ||
      signature.length > 2048
    )
      return reply(401);
    let raw: string;
    try {
      raw = await rawBody(request);
    } catch {
      return reply(400);
    }
    let event: {
      type?: unknown;
      created_at?: unknown;
      data?: unknown;
    };
    try {
      // Verification is local crypto and requires no sending API key or network.
      const verified = new Resend("webhook-verification-only", {
        baseUrl: "https://api.resend.com",
      }).webhooks.verify({
        payload: raw,
        headers: { id, timestamp, signature },
        webhookSecret: secret,
      });
      if (!verified || typeof verified !== "object" || Array.isArray(verified))
        return reply(400);
      event = verified;
    } catch (error) {
      return reply(error instanceof SyntaxError ? 400 : 401);
    }
    const now = (options.now || (() => new Date()))();
    if (typeof event.type !== "string" || typeof event.created_at !== "string")
      return reply(400);
    const at = Date.parse(event.created_at);
    if (!Number.isFinite(at) || at > now.getTime() + 300000) return reply(400);
    if (!Object.hasOwn(statusForEvent, event.type)) return reply(200); // Ignore tracking and unrelated event types.
    const emailId =
      event.data && typeof event.data === "object" && "email_id" in event.data
        ? event.data.email_id
        : undefined;
    if (!uuid(emailId)) return reply(400);
    const status = statusForEvent[event.type],
      eventId = `resend/${id}`;
    try {
      initializeMailSchema(db);
      db.exec("SAVEPOINT resend_webhook");
      try {
        if (
          db
            .prepare("SELECT 1 FROM mail_webhook_events WHERE uuid=?")
            .get(eventId)
        ) {
          db.exec("RELEASE resend_webhook");
          return reply(200);
        }
        const delivery = db
          .prepare(
            "SELECT id,status,event_at FROM mail_deliveries WHERE provider='resend' AND provider_message_id=?",
          )
          .get(emailId);
        // Provider event can precede the send response. Ask for retry without consuming it.
        if (!delivery) {
          db.exec("RELEASE resend_webhook");
          return reply(503);
        }
        db.prepare(
          "INSERT INTO mail_webhook_events(uuid,received_at) VALUES(?,?)",
        ).run(eventId, now.toISOString());
        if (
          (delivery.event_at === null || at >= Number(delivery.event_at)) &&
          rank[status] >= rank[String(delivery.status)]
        ) {
          db.prepare(
            "UPDATE mail_deliveries SET status=?,event_at=?,updated_at=?,error_code=? WHERE id=?",
          ).run(
            status,
            at,
            now.toISOString(),
            ["failed", "bounced"].includes(status)
              ? "provider_delivery_failure"
              : null,
            String(delivery.id),
          );
        }
        db.prepare("DELETE FROM mail_webhook_events WHERE received_at<?").run(
          new Date(now.getTime() - 7 * 86400000).toISOString(),
        );
        db.exec("RELEASE resend_webhook");
        return reply(200);
      } catch {
        db.exec("ROLLBACK TO resend_webhook; RELEASE resend_webhook");
        return reply(503);
      }
    } catch {
      return reply(503);
    }
  };
}
