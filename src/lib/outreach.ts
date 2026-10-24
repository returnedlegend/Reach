import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  AccountError,
  requireAccountActor,
  accountRate,
  accountTransaction,
} from "./account-store";
import { openPantryDatabase } from "./pantry-store";
import { accountRequestOrigin } from "./auth-origin";
import { generateOutreachDraft } from "./access-ai";
import {
  accessFailure,
  privateResponse,
  readPrivateJson,
  requireSameOrigin,
} from "./access-http";
import { emailDeliveryMode } from "./mail-delivery";
import {
  activeRecipient,
  createOutreachDraft,
  initializeOutreach,
  outreachHistory,
  outreachRate,
  publicRecipient,
  syncOutreachDelivery,
  unsubscribeRecipient,
  contactFingerprint,
} from "./outreach-store";
import { isDate } from "./time";
import { chicagoWallInstant } from "./access-time";

const id = z.string().uuid();
const empty = z.object({}).strict();
const sensitive = (s: string) =>
  /\b(?:homeless|diagnos\w*|my (?:home|location|address)|i (?:am|live) at)\b|[-+]?\d{1,3}\.\d{3,}\s*,\s*[-+]?\d{1,3}\.\d{3,}/i.test(
    s,
  );
const boundedText = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s));
const authorization = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((s) => !/[\r\n\0]/.test(s)),
    body: boundedText,
    authorized: z.literal(true),
    followup: z
      .object({
        optIn: z.literal(true),
        intervalHours: z.number().int().min(24).max(72),
        expiresInHours: z.number().int().min(24).max(72),
        max: z.number().int().min(1).max(2),
      })
      .strict()
      .optional(),
  })
  .strict();
export function canContact(
  db: DatabaseSync,
  userId: string,
  recipient: Record<string, unknown>,
) {
  if (
    recipient.owner_id &&
    db
      .prepare(
        "SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)",
      )
      .get(
        userId,
        String(recipient.owner_id),
        String(recipient.owner_id),
        userId,
      )
  )
    throw new AccountError(404, "This contact is unavailable.");
}
export function createOutreachHandler(
  databasePath?: string,
  options: { now?: () => Date } = {},
) {
  return async (request: Request, path: string[] = []): Promise<Response> => {
    try {
      const now = (options.now || (() => new Date()))(),
        db = openPantryDatabase(databasePath);
      initializeOutreach(db);
      const route = path.join("/");
      if (route === "unsubscribe" && request.method === "POST") {
        requireSameOrigin(request);
        const b = await readPrivateJson(
          request,
          z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
        );
        outreachRate(db, "unsubscribe", 60, 60, now);
        return privateResponse(unsubscribeRecipient(db, b.token, now));
      }
      const actor = requireAccountActor(db, request, { verified: true });
      if (request.method !== "GET") requireSameOrigin(request);
      if (request.method === "GET" && !route) {
        syncOutreachDelivery(db);
        const recipients = db
          .prepare(
            "SELECT * FROM outreach_recipients WHERE revoked_at IS NULL ORDER BY enrolled_at DESC LIMIT 100",
          )
          .all()
          .filter((r) => {
            try {
              activeRecipient(db, String(r.id), now);
              canContact(db, actor.id, r);
              return true;
            } catch {
              return false;
            }
          });
        return privateResponse({
          messages: outreachHistory(db, actor.id),
          recipients: recipients.map(publicRecipient),
          ownedRecipientIds: recipients
            .filter((r) => r.owner_id === actor.id)
            .map((r) => String(r.id)),
          deliveryMode: emailDeliveryMode(),
          inboundConfigured: outreachInboundConfigured(),
        });
      }
      if (request.method !== "POST")
        throw new AccountError(405, "This action is unavailable.");
      accountRate(db, `outreach:${actor.id}`, 40, 3600, +now);
      if (route === "enroll") {
        if (process.env.REACH_COMMUNITY_ENABLED !== "true")
          throw new AccountError(
            503,
            "The household sharing pilot is not enabled.",
          );
        const b = await readPrivateJson(
          request,
          z.object({ offerId: id, consent: z.literal(true) }).strict(),
        );
        const offer = db
          .prepare(
            "SELECT * FROM records WHERE id=? AND owner_id=? AND kind='offer' AND status='approved' AND ends_at>?",
          )
          .get(b.offerId, actor.id, now.toISOString());
        if (!offer || !actor.email)
          throw new AccountError(
            404,
            "Choose your own approved, unexpired household offer and verify your email.",
          );
        const source = `${accountRequestOrigin(request)}/food-hotspots`;
        const existing = db
          .prepare("SELECT id FROM outreach_recipients WHERE offer_id=?")
          .get(b.offerId);
        if (existing)
          db.prepare(
            "UPDATE outreach_recipients SET email=?,revoked_at=NULL,enrolled_at=? WHERE id=? AND owner_id=?",
          ).run(actor.email, now.toISOString(), String(existing.id), actor.id);
        else
          db.prepare(
            "INSERT INTO outreach_recipients(id,kind,offer_id,owner_id,name,email,source_url,enrolled_at,unsubscribe_token) VALUES(?,'household',?,?,?,?,?,?,?)",
          ).run(
            randomUUID(),
            b.offerId,
            actor.id,
            actor.name,
            actor.email,
            source,
            now.toISOString(),
            randomBytes(32).toString("hex"),
          );
        return privateResponse({ ok: true });
      }
      if (route === "suppress") {
        const b = await readPrivateJson(
          request,
          z.object({ recipientId: id, consent: z.literal(true) }).strict(),
        );
        const r = db
          .prepare(
            "SELECT unsubscribe_token FROM outreach_recipients WHERE id=? AND owner_id=?",
          )
          .get(b.recipientId, actor.id);
        if (!r) throw new AccountError(404, "Your enrollment was not found.");
        return privateResponse(
          unsubscribeRecipient(db, String(r.unsubscribe_token), now),
        );
      }
      if (route === "draft") {
        const b = await readPrivateJson(
          request,
          z.object({ recipientId: id, question: boundedText }).strict(),
        );
        const recipient = activeRecipient(db, b.recipientId, now);
        canContact(db, actor.id, recipient);
        if (sensitive(b.question))
          throw new AccountError(
            400,
            "Remove personal circumstances and precise location from this inquiry.",
          );
        outreachRate(db, `draft:${actor.id}`, 12, 3600, now);
        const draft = await generateOutreachDraft({
          recipientName:
            recipient.kind === "household"
              ? "Participating household donor"
              : String(recipient.name),
          question: b.question,
        });
        const messageId = createOutreachDraft(
          db,
          actor.id,
          b.recipientId,
          draft.subject,
          draft.body,
          now,
        );
        return privateResponse(
          {
            message: outreachHistory(db, actor.id).find(
              (m) => m.id === messageId,
            ),
            assistance: draft.assistance,
          },
          201,
        );
      }
      if (path.length !== 2 || !id.safeParse(path[0]).success)
        throw new AccountError(404, "Outreach message was not found.");
      const thread = db
        .prepare("SELECT * FROM outreach_threads WHERE id=? AND user_id=?")
        .get(path[0], actor.id);
      if (!thread)
        throw new AccountError(404, "Outreach message was not found.");
      if (path[1] === "authorize") {
        const b = await readPrivateJson(request, authorization);
        if (sensitive(b.body))
          throw new AccountError(
            400,
            "Remove personal circumstances and precise location from this inquiry.",
          );
        const disclosure =
          "Reach is sending an AI-assisted inquiry on a user's behalf.";
        if (!b.body.includes(disclosure))
          throw new AccountError(
            400,
            "Keep the Reach AI-assisted disclosure in your reviewed message.",
          );
        const reviewedRecipient = activeRecipient(
          db,
          String(thread.recipient_id),
          now,
        );
        if (emailDeliveryMode() === "disabled")
          throw new AccountError(
            503,
            "Email delivery is not configured. Your draft is saved; no email was sent.",
          );
        if (
          ["resend", "smtp"].includes(emailDeliveryMode()) &&
          !outreachInboundConfigured()
        )
          throw new AccountError(
            503,
            "Configure the app-controlled receiving domain before sending outreach.",
          );
        accountTransaction(db, () => {
          const current = db
            .prepare(
              "SELECT status FROM outreach_threads WHERE id=? AND user_id=?",
            )
            .get(path[0], actor.id);
          if (current?.status !== "draft")
            throw new AccountError(
              409,
              "This draft has already been authorized or cancelled.",
            );
          if (
            db
              .prepare(
                "SELECT 1 FROM outreach_threads WHERE user_id=? AND recipient_id=? AND id<>? AND status NOT IN ('draft','cancelled','failed') AND created_at>?",
              )
              .get(
                actor.id,
                String(thread.recipient_id),
                path[0],
                new Date(+now - 24 * 3600000).toISOString(),
              )
          )
            throw new AccountError(
              429,
              "Wait at least 24 hours before another inquiry to this recipient.",
            );
          outreachRate(db, `authorize:${actor.id}`, 5, 86400, now);
          db.prepare(
            "UPDATE outreach_threads SET subject=?,body=?,status='queued',available_at=?,authorization_expires=?,followup_expires=?,followup_remaining=?,followup_hours=?,approved_contact_hash=? WHERE id=?",
          ).run(
            b.subject,
            b.body,
            now.toISOString(),
            new Date(+now + 24 * 3600000).toISOString(),
            b.followup
              ? new Date(
                  +now + b.followup.expiresInHours * 3600000,
                ).toISOString()
              : null,
            b.followup?.max || 0,
            b.followup?.intervalHours || 24,
            contactFingerprint(reviewedRecipient),
            path[0],
          );
        });
        return privateResponse(
          {
            message: outreachHistory(db, actor.id).find(
              (m) => m.id === path[0],
            ),
          },
          202,
        );
      }
      if (path[1] === "cancel") {
        await readPrivateJson(request, empty);
        db.prepare(
          "UPDATE outreach_threads SET status=CASE WHEN status IN ('draft','queued') THEN 'cancelled' ELSE status END,followup_remaining=0 WHERE user_id=? AND (id=? OR parent_id=?)",
        ).run(actor.id, path[0], path[0]);
        return privateResponse({ ok: true });
      }
      if (path[1] === "confirm") {
        const b = await readPrivateJson(
          request,
          z
            .object({
              confirmed: z.literal(true),
              replyId: id,
              pickupCoordinates: z
                .object({
                  lat: z.number().min(-90).max(90),
                  lng: z.number().min(-180).max(180),
                })
                .strict()
                .optional(),
              pickupConsent: z.literal(true).optional(),
            })
            .strict(),
        );
        const reply = db
          .prepare(
            "SELECT * FROM outreach_replies WHERE thread_id=? ORDER BY received_at DESC,id DESC LIMIT 1",
          )
          .get(path[0]);
        if (!reply || reply.id !== b.replyId)
          throw new AccountError(
            409,
            "The reply changed. Read the latest reply before confirming.",
          );
        const facts = JSON.parse(String(reply.facts_json));
        // Private user confirmation is not verified organization publication or identity proof.
        const received = Date.parse(String(reply.received_at));
        let expires = Math.min(received + 48 * 3600000, +now + 48 * 3600000);
        if (facts.date && isDate(facts.date)) {
          const { chicagoNow } = await import("./journey");
          if (facts.date < chicagoNow(now).date)
            throw new AccountError(409, "This report applies to a past date.");
          const cutoff = chicagoWallInstant(
            facts.date,
            facts.pickupEnd || "23:59",
          );
          if (!cutoff)
            throw new AccountError(
              409,
              "The reported pickup time is ambiguous. Confirm it with the sender.",
            );
          expires = Math.min(expires, +cutoff);
        } else
          throw new AccountError(
            409,
            "Confirm the applicable date with the sender before using this report.",
          );
        if (expires <= +now)
          throw new AccountError(
            409,
            "This availability report has expired. Request a current update.",
          );
        if (b.pickupCoordinates) {
          const recipient = activeRecipient(
            db,
            String(thread.recipient_id),
            now,
          );
          if (
            !b.pickupConsent ||
            recipient.kind !== "household" ||
            !db
              .prepare(
                "SELECT 1 FROM requests WHERE offer_id=? AND requester_id=? AND status='accepted' AND pickup_consent=1",
              )
              .get(String(recipient.offer_id), actor.id)
          )
            throw new AccountError(
              403,
              "A mutually accepted pickup request and your explicit location consent are required.",
            );
          const offer = db
            .prepare("SELECT data FROM records WHERE id=?")
            .get(String(recipient.offer_id));
          if (!offer || !JSON.parse(String(offer.data)).sharePickupInstructions)
            throw new AccountError(
              403,
              "The donor has not shared this pickup arrangement.",
            );
        }
        db.prepare(
          "UPDATE outreach_replies SET reviewed_at=?,expires_at=?,pickup_json=? WHERE id=?",
        ).run(
          now.toISOString(),
          new Date(expires).toISOString(),
          b.pickupCoordinates ? JSON.stringify(b.pickupCoordinates) : null,
          b.replyId,
        );
        return privateResponse({
          ok: true,
          private: true,
          message:
            "The private report is ready for a new search. It does not guarantee food or update public pantry records.",
        });
      }
      throw new AccountError(404, "Outreach action was not found.");
    } catch (error) {
      return accessFailure(error);
    }
  };
}
export function replyDomain(): string | null {
  const domain = process.env.REACH_OUTREACH_REPLY_DOMAIN || "";
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
    domain,
  ) && !/(?:^|\.)(?:example\.(?:com|org)|yourdomain\.com)$/.test(domain)
    ? domain.toLowerCase()
    : null;
}
export function outreachInboundConfigured(): boolean {
  const key =
    process.env.RESEND_INBOUND_API_KEY || process.env.RESEND_API_KEY || "";
  return (
    !!replyDomain() &&
    /^whsec_[A-Za-z0-9+/=]{16,200}$/.test(
      process.env.RESEND_INBOUND_WEBHOOK_SECRET || "",
    ) &&
    /^re_[A-Za-z0-9_-]{8,200}$/.test(key) &&
    !/placeholder|your_resend|xxxxxxxx/i.test(key)
  );
}
