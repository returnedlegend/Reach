import type { DatabaseSync } from "node:sqlite";
import { accountTransaction } from "./account-store";
import { canonicalAccountOrigin } from "./auth-origin";
import { renderEmail } from "./email-templates";
import {
  deliverMail,
  emailDeliveryMode,
  MailDeliveryError,
  type AccountMail,
} from "./mail-delivery";
import {
  createUnsubscribeToken,
  getNotificationPreferences,
  initializeNotifications,
} from "./notifications-store";
import type {
  NotificationCategory,
  NotificationKind,
} from "./notification-types";
type Job = {
  id: string;
  user_id: string;
  category: NotificationCategory;
  kind: NotificationKind;
  resource_type: string | null;
  resource_id: string | null;
  attempts: number;
};
const copy: Record<
  NotificationKind,
  { heading: string; paragraphs: string[]; path: string }
> = {
  "password-changed": {
    heading: "Your Reach password changed",
    paragraphs: [
      "Your password was changed and previous sessions were signed out. If you did not make this change, reset your password now.",
    ],
    path: "/account",
  },
  "email-verified": {
    heading: "Welcome to Reach",
    paragraphs: [
      "Your Reach email address is verified. Welcome! Find food assistance, save useful places, and review your account to choose any optional notifications you want.",
    ],
    path: "/account",
  },
  "email-attached": {
    heading: "Email added to your Reach account",
    paragraphs: [
      "This email address was confirmed and linked to your existing account. If you did not make this change, review your account security.",
    ],
    path: "/account",
  },
  "pantry-updated": {
    heading: "Pantry listing updated",
    paragraphs: [
      "Information for a pantry you manage was updated. Sign in to review the current listing and its change history.",
    ],
    path: "/manage",
  },
  "donation-offered": {
    heading: "A donation needs review",
    paragraphs: [
      "A donor offered food for a pantry you manage. Review the details before accepting. Food availability and pickup are not guaranteed.",
    ],
    path: "/volunteer",
  },
  "new-opportunity": {
    heading: "A food pickup opportunity is available",
    paragraphs: [
      "A pantry-approved volunteer pickup is available in the Bryan–College Station pilot. Sign in to check the current details and availability before claiming.",
    ],
    path: "/volunteer",
  },
  "volunteer-interest": {
    heading: "There is interest in a food pickup",
    paragraphs: [
      "Someone expressed interest in a pickup you coordinate. Sign in to review the current request.",
    ],
    path: "/food-hotspots",
  },
  "assignment-confirmed": {
    heading: "Pickup assignment updated",
    paragraphs: [
      "A pickup assignment was confirmed. Sign in to review the current status and any instructions you are permitted to see.",
    ],
    path: "/volunteer",
  },
  "pickup-completed": {
    heading: "Pickup confirmation recorded",
    paragraphs: [
      "A pickup was marked complete in Reach. Sign in to review the record.",
    ],
    path: "/volunteer",
  },
  "pickup-cancelled": {
    heading: "Pickup plans changed",
    paragraphs: [
      "A pickup or request was cancelled or is no longer available. Sign in before making travel plans.",
    ],
    path: "/volunteer",
  },
  "donation-changed": {
    heading: "Food donation availability changed",
    paragraphs: [
      "A donation you coordinate has an availability update. Sign in for the latest status.",
    ],
    path: "/food-hotspots",
  },
};
function hasTable(db: DatabaseSync, name: string) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}
function isBlocked(db: DatabaseSync, a: string, b: string) {
  return !!db
    .prepare(
      "SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)",
    )
    .get(a, b, b, a);
}
function manager(db: DatabaseSync, userId: string, pantryId: string) {
  return (
    !!db
      .prepare("SELECT 1 FROM users WHERE id=? AND pantry_role='administrator'")
      .get(userId) ||
    !!db
      .prepare("SELECT 1 FROM pantry_managers WHERE user_id=? AND pantry_id=?")
      .get(userId, pantryId)
  );
}
/** Resolve only current authorization and address; never render resource/private content into mail. */
export function notificationRecipient(
  db: DatabaseSync,
  job: Job,
  now: Date,
): string | null {
  const user = db
    .prepare("SELECT email,email_verified_at FROM users WHERE id=?")
    .get(job.user_id);
  if (!user?.email || !user.email_verified_at) return null;
  const prefs = getNotificationPreferences(db, job.user_id);
  if (job.category !== "security" && !prefs[job.category]) return null;
  if (job.category === "security") return String(user.email);
  if (!job.resource_type || !job.resource_id) return null;
  const id = job.resource_id;
  if (job.resource_type === "pantry") {
    if (
      !db.prepare("SELECT 1 FROM pantries WHERE id=?").get(id) ||
      !manager(db, job.user_id, id)
    )
      return null;
  } else if (job.resource_type === "run") {
    if (!hasTable(db, "volunteer_runs")) return null;
    const run = db
      .prepare(
        "SELECT r.*,p.active pantry_active,o.status offer_status,o.ends_at FROM volunteer_runs r JOIN records o ON o.id=r.offer_id JOIN pantries p ON p.id=r.pantry_id WHERE r.id=?",
      )
      .get(id);
    if (!run || isBlocked(db, job.user_id, String(run.donor_id))) return null;
    if (job.kind === "new-opportunity") {
      if (
        !prefs.volunteerParticipation ||
        run.status !== "open" ||
        !run.pantry_active ||
        run.offer_status !== "approved" ||
        String(run.ends_at) <= now.toISOString() ||
        job.user_id === run.donor_id ||
        manager(db, job.user_id, String(run.pantry_id)) ||
        db
          .prepare(
            "SELECT 1 FROM pantry_managers m JOIN blocks b ON (b.user_id=m.user_id AND b.blocked_id=?) OR (b.blocked_id=m.user_id AND b.user_id=?) WHERE m.pantry_id=?",
          )
          .get(job.user_id, job.user_id, run.pantry_id)
      )
        return null;
      if (
        db
          .prepare(
            "SELECT 1 FROM volunteer_runs WHERE volunteer_id=? AND status='assigned'",
          )
          .get(job.user_id)
      )
        return null;
    } else if (
      (job.kind === "assignment-confirmed" && run.status !== "assigned") ||
      (job.kind === "donation-offered" && run.status !== "pending") ||
      (run.volunteer_id &&
        isBlocked(db, job.user_id, String(run.volunteer_id))) ||
      (run.donor_id !== job.user_id &&
        run.volunteer_id !== job.user_id &&
        !manager(db, job.user_id, String(run.pantry_id)))
    )
      return null;
  } else if (job.resource_type === "offer") {
    const record = db
      .prepare("SELECT owner_id FROM records WHERE id=?")
      .get(id);
    if (!record || record.owner_id !== job.user_id) return null;
  } else if (job.resource_type === "request") {
    const request = db
      .prepare(
        "SELECT q.requester_id,o.owner_id FROM requests q JOIN records o ON o.id=q.offer_id WHERE q.id=?",
      )
      .get(id);
    if (
      !request ||
      ![request.requester_id, request.owner_id].includes(job.user_id) ||
      isBlocked(db, String(request.requester_id), String(request.owner_id))
    )
      return null;
  } else return null;
  return String(user.email);
}
export type NotificationDispatchOptions = {
  limit?: number;
  now?: () => Date;
  send?: (
    db: DatabaseSync,
    mail: AccountMail,
  ) => Promise<{ id: string; status: "accepted" | "preview" | "uncertain" }>;
};
export async function dispatchNotifications(
  db: DatabaseSync,
  options: NotificationDispatchOptions = {},
) {
  initializeNotifications(db);
  const clock = options.now ?? (() => new Date());
  const counts = {
    processed: 0,
    accepted: 0,
    preview: 0,
    uncertain: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
    unavailable: false,
  };
  if (
    !canonicalAccountOrigin() ||
    (!options.send && emailDeliveryMode() === "disabled")
  )
    return { ...counts, unavailable: true };
  // A crashed worker may already have handed off the message. Never blindly resend its lease.
  db.prepare(
    "UPDATE notification_outbox SET status='uncertain',error_code='interrupted',updated_at=? WHERE status='sending' AND updated_at<?",
  ).run(clock().toISOString(), new Date(+clock() - 120000).toISOString());
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  for (let index = 0; index < limit; index++) {
    const job = accountTransaction(db, () => {
      const row = db
        .prepare(
          "SELECT * FROM notification_outbox WHERE status='queued' AND available_at<=? ORDER BY created_at,id LIMIT 1",
        )
        .get(clock().toISOString()) as Job | undefined;
      if (!row) return null;
      db.prepare(
        "UPDATE notification_outbox SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'",
      ).run(clock().toISOString(), row.id);
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!job) break;
    counts.processed++;
    try {
      const address = notificationRecipient(db, job, clock());
      if (!address) {
        db.prepare(
          "UPDATE notification_outbox SET status='suppressed',updated_at=? WHERE id=?",
        ).run(clock().toISOString(), job.id);
        counts.suppressed++;
        continue;
      }
      const template = copy[job.kind];
      if (!template) throw new MailDeliveryError("unknown_template", false);
      const origin = canonicalAccountOrigin()!;
      const path =
        job.resource_type === "request" || job.resource_type === "offer"
          ? "/food-hotspots"
          : job.kind === "volunteer-interest" && job.resource_type === "run"
            ? "/volunteer"
            : template.path;
      const token =
        job.category === "security"
          ? null
          : createUnsubscribeToken(db, job.user_id, clock());
      const rendered = renderEmail({
        ...template,
        action: { label: "Review in Reach", url: origin + path },
        footer:
          "Reach does not include private pickup instructions or account secrets in notification emails.",
        ...(token
          ? { unsubscribeUrl: `${origin}/unsubscribe#token=${token}` }
          : {}),
      });
      const result = await (options.send ?? deliverMail)(db, {
        to: address,
        subject: template.heading,
        ...rendered,
        kind: job.kind,
        userId: job.user_id,
      });
      db.prepare(
        "UPDATE notification_outbox SET status=?,delivery_id=?,updated_at=?,error_code=? WHERE id=?",
      ).run(
        result.status,
        result.id,
        clock().toISOString(),
        result.status === "uncertain" ? "ambiguous" : null,
        job.id,
      );
      counts[result.status]++;
    } catch (error) {
      const retry =
        error instanceof MailDeliveryError &&
        error.retryable &&
        job.attempts < 5;
      const code =
        error instanceof MailDeliveryError ? error.code : "worker_failure";
      const status = retry
        ? "queued"
        : error instanceof MailDeliveryError
          ? "failed"
          : "uncertain";
      db.prepare(
        "UPDATE notification_outbox SET status=?,error_code=?,available_at=?,updated_at=? WHERE id=?",
      ).run(
        status,
        code,
        new Date(
          +clock() + Math.min(3600000, 60000 * 2 ** (job.attempts - 1)),
        ).toISOString(),
        clock().toISOString(),
        job.id,
      );
      if (retry) counts.retried++;
      else if (status === "failed") counts.failed++;
      else counts.uncertain++;
    }
  }
  return counts;
}
