import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Resend } from "resend";
import { PrivateResend } from "./mail-delivery";
import { rawBody } from "./resend-webhook";
import {
  initializeOutreach,
  recipientEmail,
  unsubscribeRecipient,
} from "./outreach-store";
import { replyDomain } from "./outreach";
import { extractOutreachFacts } from "./access-ai";
import { privateResponse } from "./access-http";

export type InboundEmail = {
  id: string;
  from: string;
  to: string[];
  received_for?: string[];
  created_at: string;
  text: string | null;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
async function receiveEmail(id: string): Promise<InboundEmail | null> {
  const key =
    process.env.RESEND_INBOUND_API_KEY || process.env.RESEND_API_KEY || "";
  if (
    !/^re_[A-Za-z0-9_-]{8,200}$/.test(key) ||
    /placeholder|your_resend/i.test(key)
  )
    return null;
  const response = await new PrivateResend(
    key,
    fetch,
    `/emails/receiving/${id}`,
    512 * 1024,
  ).emails.receiving.get(id);
  if (response.error || !response.data) return null;
  return response.data;
}
function mailbox(from: string) {
  const match = from.trim().match(/^(?:[^<>\r\n]+<)?([^<>\s@]+@[^<>\s@]+)>?$/);
  return match && recipientEmail(match[1]) ? match[1].toLowerCase() : null;
}
/** The signature authenticates Resend, not the human sender. Review is mandatory. */
export function createOutreachInbound(
  db: DatabaseSync,
  options: {
    receive?: (id: string) => Promise<InboundEmail | null>;
    now?: () => Date;
  } = {},
) {
  return async (request: Request) => {
    const reject = (status: number) =>
      privateResponse({ ok: status === 200 }, status);
    if (request.method !== "POST") return reject(405);
    const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET || "",
      domain = replyDomain();
    if (!/^whsec_[A-Za-z0-9+/=]{16,200}$/.test(secret) || !domain)
      return reject(503);
    const id = request.headers.get("svix-id"),
      timestamp = request.headers.get("svix-timestamp"),
      signature = request.headers.get("svix-signature");
    if (
      !id ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(id) ||
      !timestamp ||
      !/^\d{9,12}$/.test(timestamp) ||
      !signature ||
      signature.length > 2048
    )
      return reject(401);
    let event: unknown;
    try {
      event = new Resend("local-webhook-verification").webhooks.verify({
        payload: await rawBody(request),
        headers: { id, timestamp, signature },
        webhookSecret: secret,
      });
    } catch {
      return reject(401);
    }
    if (!event || typeof event !== "object" || !("type" in event))
      return reject(400);
    if (event.type !== "email.received") return reject(200);
    const typed = event as {
      type: string;
      created_at?: string;
      data?: { email_id?: unknown };
    };
    const now = (options.now || (() => new Date()))();
    if (
      !uuid(typed.data?.email_id) ||
      !typed.created_at ||
      !Number.isFinite(Date.parse(typed.created_at)) ||
      Date.parse(typed.created_at) > +now + 300000
    )
      return reject(400);
    try {
      initializeOutreach(db);
      if (
        db
          .prepare("SELECT 1 FROM outreach_events WHERE id=?")
          .get(`resend/${id}`) ||
        db
          .prepare("SELECT 1 FROM outreach_replies WHERE email_id=?")
          .get(typed.data.email_id)
      )
        return reject(200);
      const mail = await (options.receive || receiveEmail)(typed.data.email_id);
      if (!mail) return reject(503);
      if (
        mail.id !== typed.data.email_id ||
        typeof mail.from !== "string" ||
        !Array.isArray(mail.to) ||
        mail.text === null ||
        typeof mail.text !== "string" ||
        mail.text.length > 512000 ||
        !Number.isFinite(Date.parse(mail.created_at)) ||
        Date.parse(mail.created_at) > +now + 300000
      )
        return reject(400);
      const envelope =
        Array.isArray(mail.received_for) && mail.received_for.length
          ? mail.received_for
          : mail.to;
      const tokens = envelope
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.toLowerCase().match(/^reach-([a-f0-9]{48})@([^@]+)$/))
        .filter((m) => m && m[2] === domain);
      if (tokens.length !== 1) return reject(200);
      const thread = db
        .prepare(
          "SELECT t.*,r.email,r.unsubscribe_token,r.revoked_at FROM outreach_threads t JOIN outreach_recipients r ON r.id=t.recipient_id WHERE t.reply_token=? AND t.sent_at IS NOT NULL",
        )
        .get(tokens[0]![1]);
      if (
        !thread ||
        thread.revoked_at ||
        mailbox(mail.from) !== String(thread.email).toLowerCase()
      )
        return reject(200);
      const text = mail.text
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
        .slice(0, 5000);
      const replyId = randomUUID();
      const unknown = {
        availability: "unknown",
        date: null,
        pickupStart: null,
        pickupEnd: null,
        foodType: "",
        requirements: "",
        supportingText: "",
        uncertainty: [
          "Untrusted sender report; extraction and recipient confirmation are pending.",
        ],
      };
      db.exec("SAVEPOINT outreach_inbound");
      try {
        const inserted = db
          .prepare(
            "INSERT OR IGNORE INTO outreach_replies(id,thread_id,email_id,text,received_at,facts_json) VALUES(?,?,?,?,?,?)",
          )
          .run(
            replyId,
            String(thread.id),
            mail.id,
            text,
            mail.created_at,
            JSON.stringify(unknown),
          );
        db.prepare("INSERT OR IGNORE INTO outreach_events VALUES(?,?)").run(
          `resend/${id}`,
          now.toISOString(),
        );
        if (!inserted.changes) {
          db.exec("RELEASE outreach_inbound");
          return reject(200);
        }
        db.prepare(
          "UPDATE outreach_threads SET status='replied',followup_remaining=0 WHERE id=?",
        ).run(String(thread.id));
        const root = String(thread.parent_id || thread.id);
        db.prepare(
          "UPDATE outreach_threads SET followup_remaining=0,status=CASE WHEN status='queued' AND parent_id=? THEN 'cancelled' ELSE status END WHERE id=? OR parent_id=?",
        ).run(root, root, root);
        if (
          /^\s*(?:please\s+)?(?:unsubscribe|stop(?:\s+(?:emailing|emails|messages|inquiries))?)[.!]?\s*$/i.test(
            text,
          )
        )
          unsubscribeRecipient(db, String(thread.unsubscribe_token), now);
        db.exec("RELEASE outreach_inbound");
      } catch (error) {
        db.exec("ROLLBACK TO outreach_inbound; RELEASE outreach_inbound");
        throw error;
      }
      // Untrusted content is only data for extraction, never a tool or authorization.
      const unquoted = text
        .split(
          /\n(?:On .{1,200}wrote:|From:|[-_]{2,}\s*(?:Original|Forwarded) Message)/i,
        )[0]
        .split("\n")
        .filter((line) => !/^\s*>/.test(line))
        .join("\n");
      const facts = await extractOutreachFacts(
        {
          text: unquoted,
          receivedAt: mail.created_at,
          timeZone: "America/Chicago",
        },
        { signal: AbortSignal.timeout(1000) },
      );
      db.prepare("UPDATE outreach_replies SET facts_json=? WHERE id=?").run(
        JSON.stringify(
          facts.supportingText && !unquoted.includes(facts.supportingText)
            ? {
                ...unknown,
                uncertainty: [
                  "Extraction did not match the reply text; review the original message.",
                ],
              }
            : facts,
        ),
        replyId,
      );
      return reject(200);
    } catch {
      return reject(503);
    }
  };
}
