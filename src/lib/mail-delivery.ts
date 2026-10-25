import { featureEnabled } from "./release-features";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { canonicalAccountOrigin } from "./auth-origin";
import { initializeMailSchema } from "./mail-schema";
import {
  SMTP_SEND_DEADLINE_MS,
  smtpConfiguration,
  smtpSend,
  type SmtpTransportFactory,
} from "./smtp-delivery";
export { initializeMailSchema } from "./mail-schema";

// Node-only dependencies enforce the module boundary at build time as well.
if (typeof window !== "undefined")
  throw new Error("Mail delivery is server-only.");
export type AccountMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  kind?: string;
  userId?: string;
  /** App-controlled reply mailbox; never taken directly from an anonymous request. */
  replyTo?: string;
};
export type EmailDeliveryMode = "smtp" | "preview" | "disabled";
export class MailDeliveryError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
    public retryDelayMs = 250,
  ) {
    super("Email could not be accepted. Please try again later.");
    this.name = "MailDeliveryError";
  }
}
const noNewlines = (value: string) => !!value && !/[\r\n\0]/.test(value);
const address = (value: string) =>
  value.length <= 254 &&
  /^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(value) &&
  noNewlines(value);
export function emailDeliveryMode(): EmailDeliveryMode {
  if (!featureEnabled("email")) return "disabled";
  const provider = process.env.REACH_EMAIL_PROVIDER;
  if (provider === "disabled") return "disabled";
  if (provider === "preview")
    return process.env.NODE_ENV !== "production" ? "preview" : "disabled";
  if (provider === "smtp") return smtpConfiguration() ? "smtp" : "disabled";
  return "disabled";
}
export function accountMailConfigured(): boolean {
  return !!canonicalAccountOrigin() && emailDeliveryMode() !== "disabled";
}
function cap(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 10000 ? n : fallback;
}
function takeRate(db: DatabaseSync, userId: string | undefined, now: number) {
  // SAVEPOINT composes with caller transactions; each UPSERT enforces the cap atomically.
  db.exec("SAVEPOINT mail_rate");
  try {
    db.prepare("DELETE FROM mail_rate_limits WHERE reset_at<=?").run(now);
    const limits: [string, number][] = [
      ["all", cap(process.env.REACH_EMAIL_HOURLY_LIMIT, 100)],
    ];
    if (userId)
      limits.push([
        `user:${userId}`,
        cap(process.env.REACH_EMAIL_USER_HOURLY_LIMIT, 20),
      ]);
    for (const [key, limit] of limits) {
      const r = db
        .prepare(
          "INSERT INTO mail_rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END WHERE reset_at<=? OR count<?",
        )
        .run(key, now + 3600000, now, now, now, limit);
      if (!r.changes) throw new MailDeliveryError("rate_limited", true);
    }
    db.exec("RELEASE mail_rate");
  } catch (e) {
    db.exec("ROLLBACK TO mail_rate; RELEASE mail_rate");
    throw e;
  }
}
type TransportResult = {
  status: "accepted" | "uncertain";
  messageId?: string;
  rfcMessageId?: string;
};
export async function deliverMail(
  db: DatabaseSync,
  mail: AccountMail,
  options: {
    now?: () => Date;
    maxAttempts?: number;
    smtpTransportFactory?: SmtpTransportFactory;
  } = {},
): Promise<{ id: string; status: "accepted" | "preview" | "uncertain" }> {
  if (
    !address(mail.to) ||
    (mail.replyTo !== undefined && !address(mail.replyTo)) ||
    !noNewlines(mail.subject) ||
    mail.subject.length > 300 ||
    !mail.text ||
    mail.text.length > 100000 ||
    (mail.html?.length || 0) > 200000 ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(mail.kind || "account")
  )
    throw new MailDeliveryError("invalid_message", false);
  const mode = emailDeliveryMode();
  if (mode === "disabled") throw new MailDeliveryError("not_configured", false);
  const now = options.now || (() => new Date()),
    at = now(),
    id = randomUUID();
  try {
    initializeMailSchema(db);
    takeRate(db, mail.userId, at.getTime());
    db.prepare(
      "INSERT INTO mail_deliveries(id,user_id,kind,provider,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)",
    ).run(
      id,
      mail.userId || null,
      mail.kind || "account",
      mode,
      at.toISOString(),
      at.toISOString(),
    );
  } catch (error) {
    if (error instanceof MailDeliveryError) throw error;
    throw new MailDeliveryError("storage", true);
  }
  const finish = (
    status: "accepted" | "preview" | "uncertain",
    attempts: number,
    result?: TransportResult,
  ) => {
    try {
      db.prepare(
        "UPDATE mail_deliveries SET status=?,attempts=?,provider_message_id=?,rfc_message_id=?,error_code=?,updated_at=? WHERE id=?",
      ).run(
        status,
        attempts,
        result?.messageId || null,
        result?.rfcMessageId || null,
        status === "uncertain" ? "ambiguous" : null,
        now().toISOString(),
        id,
      );
    } catch {
      return { id, status: "uncertain" as const };
    } // Never invalidate tokens if acceptance succeeded but metadata storage failed.
    return { id, status };
  };
  if (mode === "preview") {
    try {
      const dir = resolve(
        /* turbopackIgnore: true */ process.env.REACH_EMAIL_PREVIEW_DIR ||
          ".local/mail-preview",
      );
      for (const served of ["public", ".next", "out"]) {
        const location = relative(
          resolve(/* turbopackIgnore: true */ served),
          dir,
        );
        if (
          !location ||
          (location !== ".." &&
            !location.startsWith(`..${sep}`) &&
            !location.startsWith(sep))
        )
          throw new Error("Preview directory must be private.");
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      writeFileSync(
        /* turbopackIgnore: true */ resolve(dir, `${id}.json`),
        JSON.stringify({ ...mail, id }, null, 2),
        { mode: 0o600, flag: "wx" },
      );
      return finish("preview", 0);
    } catch {
      try {
        db.prepare(
          "UPDATE mail_deliveries SET status='failed',error_code='preview_storage' WHERE id=?",
        ).run(id);
      } catch {
        /* Preserve the sanitized known-not-accepted outcome. */
      }
      throw new MailDeliveryError("preview_storage", false);
    }
  }
  const max = Math.min(2, Math.max(1, options.maxAttempts || 2));
  const smtpDeadlineAt = Date.now() + SMTP_SEND_DEADLINE_MS;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const result = await smtpSend(
        mail,
        id,
        options.smtpTransportFactory,
        smtpDeadlineAt,
      );
      return finish(result.status, attempt, result);
    } catch (error) {
      const safe =
        error instanceof MailDeliveryError
          ? error
          : new MailDeliveryError("rejected", false);
      if (safe.retryable && attempt < max) {
        await new Promise((resolve) => setTimeout(resolve, safe.retryDelayMs));
        continue;
      }
      try {
        db.prepare(
          "UPDATE mail_deliveries SET status='failed',attempts=?,error_code=?,updated_at=? WHERE id=?",
        ).run(attempt, safe.code, now().toISOString(), id);
      } catch {
        /* Never expose storage diagnostics. */
      }
      throw safe;
    }
  }
  return finish("uncertain", max);
}
