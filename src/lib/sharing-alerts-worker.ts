import type { DatabaseSync } from "node:sqlite";
import { accountTransaction } from "./account-store";
import { canonicalAccountOrigin } from "./auth-origin";
import { renderEmail } from "./email-templates";
import {
  deliverMail,
  emailDeliveryMode,
  MailDeliveryError,
} from "./mail-delivery";
import {
  initializeSharingAlerts,
  type SharingSubmissionKind,
} from "./sharing-alerts";

const ALERT_RECIPIENT = "reachpantrysupport@gmail.com";
type AlertJob = {
  id: string;
  submission_id: string;
  kind: SharingSubmissionKind;
  attempts: number;
};
type Send = typeof deliverMail;

export async function dispatchSharingAlerts(
  db: DatabaseSync,
  options: { now?: () => Date; limit?: number; send?: Send } = {},
) {
  initializeSharingAlerts(db);
  const clock = options.now || (() => new Date());
  const counts = {
    processed: 0,
    accepted: 0,
    preview: 0,
    uncertain: 0,
    retried: 0,
    failed: 0,
    unavailable: false,
  };
  if (
    !canonicalAccountOrigin() ||
    (!options.send && emailDeliveryMode() === "disabled")
  ) {
    counts.unavailable = true;
    return counts;
  }

  const now = clock();
  // A worker crash may have happened after SMTP accepted the message. Preserve
  // the claim as uncertain so a later run cannot send the same alert again.
  db.prepare(
    `UPDATE sharing_alert_outbox SET status='uncertain',error_code='interrupted',updated_at=?
    WHERE status='sending' AND updated_at<?`,
  ).run(now.toISOString(), new Date(+now - 120000).toISOString());

  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  for (let index = 0; index < limit; index++) {
    const at = clock();
    const job = accountTransaction(db, () => {
      const row = db
        .prepare(
          `SELECT id,submission_id,kind,attempts FROM sharing_alert_outbox
        WHERE status='queued' AND available_at<=? ORDER BY created_at,id LIMIT 1`,
        )
        .get(at.toISOString()) as AlertJob | undefined;
      if (!row) return null;
      const claimed = db
        .prepare(
          `UPDATE sharing_alert_outbox SET status='sending',attempts=attempts+1,updated_at=?
        WHERE id=? AND status='queued'`,
        )
        .run(at.toISOString(), row.id);
      return claimed.changes ? { ...row, attempts: row.attempts + 1 } : null;
    });
    if (!job) break;
    counts.processed++;
    try {
      const origin = canonicalAccountOrigin();
      if (!origin) throw new MailDeliveryError("not_configured", false);
      const rendered = renderEmail({
        heading: "A new Reach sharing submission needs review",
        paragraphs: [
          "A new sharing submission was received in Reach. Sign in to review the submission.",
        ],
        action: {
          label: "Review submission",
          url: `${origin}/admin?request=${encodeURIComponent(job.submission_id)}`,
        },
        footer:
          "Submission details are available only to an authorized Reach administrator.",
      });
      const result = await (options.send || deliverMail)(db, {
        to: ALERT_RECIPIENT,
        subject: "New Reach sharing submission",
        ...rendered,
        kind: "sharing_alert",
      });
      db.prepare(
        "UPDATE sharing_alert_outbox SET status=?,error_code=NULL,updated_at=? WHERE id=? AND status='sending'",
      ).run(result.status, clock().toISOString(), job.id);
      counts[result.status]++;
    } catch (error) {
      const known = error instanceof MailDeliveryError;
      const retry = known && error.retryable && job.attempts < 3;
      const uncertain = !known;
      const status = retry ? "queued" : uncertain ? "uncertain" : "failed";
      const delay = known
        ? Math.max(1000, error.retryDelayMs, 1000 * 2 ** (job.attempts - 1))
        : 0;
      db.prepare(
        "UPDATE sharing_alert_outbox SET status=?,available_at=?,error_code=?,updated_at=? WHERE id=? AND status='sending'",
      ).run(
        status,
        new Date(+clock() + delay).toISOString(),
        known ? error.code : "ambiguous",
        clock().toISOString(),
        job.id,
      );
      if (retry) counts.retried++;
      else if (uncertain) counts.uncertain++;
      else counts.failed++;
    }
  }
  return counts;
}
