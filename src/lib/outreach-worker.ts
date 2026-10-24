import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AccountError, accountTransaction } from "./account-store";
import { canonicalAccountOrigin } from "./auth-origin";
import {
  deliverMail,
  emailDeliveryMode,
  MailDeliveryError,
} from "./mail-delivery";
import { renderEmail } from "./email-templates";
import {
  activeRecipient,
  initializeOutreach,
  outreachRate,
  syncOutreachDelivery,
  contactFingerprint,
} from "./outreach-store";
import { canContact, replyDomain, outreachInboundConfigured } from "./outreach";

/** Future voice adapters implement this same delivery seam, not authorization or generation. */
export type OutreachChannel = { deliver: typeof deliverMail };
export async function dispatchOutreach(
  db: DatabaseSync,
  options: { now?: () => Date; send?: typeof deliverMail } = {},
) {
  initializeOutreach(db);
  syncOutreachDelivery(db);
  const clock = options.now || (() => new Date());
  const counts = {
    processed: 0,
    accepted: 0,
    preview: 0,
    uncertain: 0,
    failed: 0,
    cancelled: 0,
    retried: 0,
    unavailable: false,
  };
  if (
    emailDeliveryMode() === "disabled" ||
    !canonicalAccountOrigin() ||
    (["resend", "smtp"].includes(emailDeliveryMode()) &&
      !outreachInboundConfigured())
  ) {
    counts.unavailable = true;
    return counts;
  }
  const now = clock();
  // A crash after claiming can have sent mail. Never blindly re-send a lease.
  db.prepare(
    "UPDATE outreach_threads SET status='uncertain',followup_remaining=0 WHERE status='sending' AND available_at<?",
  ).run(new Date(+now - 10 * 60000).toISOString());
  // Follow-ups are bounded clones of a reviewed message, and only after explicit opt-in.
  for (const parent of db
    .prepare(
      "SELECT * FROM outreach_threads WHERE parent_id IS NULL AND followup_remaining>0 AND followup_expires>? AND status IN ('accepted','delivered','preview') AND sent_at IS NOT NULL LIMIT 20",
    )
    .all(now.toISOString())) {
    if (
      +now - Date.parse(String(parent.sent_at)) <
      Number(parent.followup_hours) * 3600000
    )
      continue;
    if (
      db
        .prepare("SELECT 1 FROM outreach_replies WHERE thread_id=?")
        .get(String(parent.id))
    )
      continue;
    accountTransaction(db, () => {
      const prior = db
        .prepare(
          "SELECT created_at FROM outreach_threads WHERE parent_id=? ORDER BY created_at DESC LIMIT 1",
        )
        .get(String(parent.id));
      if (
        prior &&
        +now - Date.parse(String(prior.created_at)) <
          Number(parent.followup_hours) * 3600000
      )
        return;
      const childId = randomUUID();
      db.prepare(
        "INSERT INTO outreach_threads(id,user_id,recipient_id,subject,body,status,created_at,available_at,reply_token,parent_id,authorization_expires,approved_contact_hash) VALUES(?,?,?,?,?,'queued',?,?,?,?,?,?)",
      ).run(
        childId,
        String(parent.user_id),
        String(parent.recipient_id),
        String(parent.subject),
        String(parent.body),
        now.toISOString(),
        now.toISOString(),
        randomBytes(24).toString("hex"),
        String(parent.id),
        String(parent.followup_expires),
        String(parent.approved_contact_hash),
      );
      db.prepare(
        "UPDATE outreach_threads SET followup_remaining=MAX(0,followup_remaining-1) WHERE id=?",
      ).run(String(parent.id));
    });
  }
  for (let n = 0; n < 10; n++) {
    const at = clock();
    const thread = accountTransaction(db, () => {
      const row = db
        .prepare(
          "SELECT * FROM outreach_threads WHERE status='queued' AND available_at<=? ORDER BY created_at,id LIMIT 1",
        )
        .get(at.toISOString());
      if (!row) return null;
      db.prepare(
        "UPDATE outreach_threads SET status='sending',attempts=attempts+1,available_at=? WHERE id=? AND status='queued'",
      ).run(at.toISOString(), String(row.id));
      return row;
    });
    if (!thread) break;
    counts.processed++;
    let recipientSlot = false,
      userSlot = false;
    try {
      const actor = db
        .prepare("SELECT email_verified_at FROM users WHERE id=?")
        .get(String(thread.user_id));
      if (!actor?.email_verified_at) throw new Error("Revoked account");
      if (
        !thread.authorization_expires ||
        Date.parse(String(thread.authorization_expires)) <= +at
      )
        throw new Error("Follow-up authorization expired");
      const recipient = activeRecipient(db, String(thread.recipient_id), at);
      if (thread.approved_contact_hash !== contactFingerprint(recipient))
        throw new AccountError(
          409,
          "The enrolled contact changed after review.",
        );
      canContact(db, String(thread.user_id), recipient);
      if (thread.parent_id) {
        const parent = db
          .prepare(
            "SELECT followup_expires,status FROM outreach_threads WHERE id=?",
          )
          .get(String(thread.parent_id));
        if (
          !parent ||
          !parent.followup_expires ||
          Date.parse(String(parent.followup_expires)) <= +at ||
          ["cancelled", "replied", "bounced", "failed", "uncertain"].includes(
            String(parent.status),
          ) ||
          db
            .prepare("SELECT 1 FROM outreach_replies WHERE thread_id=?")
            .get(String(thread.parent_id))
        )
          throw new Error("Follow-up authorization expired");
      }
      outreachRate(db, "recipient:" + String(recipient.id), 1, 24 * 3600, at);
      recipientSlot = true;
      outreachRate(db, "user-send:" + String(thread.user_id), 5, 24 * 3600, at);
      userSlot = true;
      const origin = canonicalAccountOrigin()!;
      const unsubscribe = `${origin}/outreach/unsubscribe#token=${recipient.unsubscribe_token}`;
      const rendered = renderEmail({
        heading: String(thread.subject),
        paragraphs: String(thread.body).split(/\n\n+/),
        footer:
          "This inquiry does not promise food availability. Replies may be processed to extract pickup facts and shared privately with this requester. Do not include unnecessary personal information. Public pantry records are not automatically changed.",
        unsubscribeUrl: unsubscribe,
      });
      const domain = replyDomain();
      const result = await (options.send || deliverMail)(db, {
        to: String(recipient.email),
        subject: String(thread.subject),
        ...rendered,
        userId: String(thread.user_id),
        kind: "outreach",
        ...(domain ? { replyTo: `reach-${thread.reply_token}@${domain}` } : {}),
      });
      db.prepare(
        "UPDATE outreach_threads SET status=?,delivery_id=?,sent_at=? WHERE id=?",
      ).run(
        result.status,
        String(result.id),
        clock().toISOString(),
        String(thread.id),
      );
      counts[result.status]++;
    } catch (error) {
      // Release only known pre-acceptance reservations; uncertainty retains them.
      if (error instanceof MailDeliveryError || error instanceof AccountError) {
        if (recipientSlot)
          db.prepare(
            "UPDATE outreach_limits SET count=MAX(0,count-1) WHERE key=?",
          ).run("recipient:" + String(thread.recipient_id));
        if (userSlot)
          db.prepare(
            "UPDATE outreach_limits SET count=MAX(0,count-1) WHERE key=?",
          ).run("user-send:" + String(thread.user_id));
      }
      const retry =
        error instanceof MailDeliveryError &&
        error.retryable &&
        Number(thread.attempts) < 3;
      const uncertain =
        !(error instanceof MailDeliveryError) &&
        !(error instanceof AccountError) &&
        error instanceof Error &&
        !["Revoked account", "Follow-up authorization expired"].includes(
          error.message,
        );
      const status = retry
        ? "queued"
        : uncertain
          ? "uncertain"
          : error instanceof MailDeliveryError ||
              (error instanceof AccountError && error.status === 429)
            ? "failed"
            : "cancelled";
      db.prepare(
        "UPDATE outreach_threads SET status=?,available_at=?,followup_remaining=CASE WHEN ?='queued' THEN followup_remaining ELSE 0 END WHERE id=?",
      ).run(
        status,
        new Date(
          +clock() + Math.min(3600000, 60000 * 2 ** Number(thread.attempts)),
        ).toISOString(),
        status,
        String(thread.id),
      );
      if (retry) counts.retried++;
      else if (uncertain) counts.uncertain++;
      else if (status === "failed") counts.failed++;
      else counts.cancelled++;
    }
  }
  // Minimize private content retention; no origin is stored in these tables.
  db.prepare(
    "DELETE FROM outreach_threads WHERE created_at<? AND status NOT IN ('queued','sending')",
  ).run(new Date(+clock() - 30 * 86400000).toISOString());
  db.prepare("DELETE FROM outreach_events WHERE created_at<?").run(
    new Date(+clock() - 7 * 86400000).toISOString(),
  );
  return counts;
}
