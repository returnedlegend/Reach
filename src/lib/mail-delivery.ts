import { featureEnabled } from "./release-features";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Resend, type Response as ResendResponse } from "resend";
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
export type EmailDeliveryMode = "resend" | "smtp" | "preview" | "disabled";
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
function resendConfiguration() {
  const key = process.env.RESEND_API_KEY || "";
  const from = process.env.RESEND_FROM_EMAIL || "";
  const match = from.match(/^([^<>]+) <([^<>]+)>$/);
  const sender = match ? match[2] : from;
  if (
    !/^re_[A-Za-z0-9_-]{8,200}$/.test(key) ||
    /(?:placeholder|your_resend|xxxxxxxx)/i.test(key) ||
    !noNewlines(from) ||
    from.length > 320 ||
    !address(sender) ||
    /@(?:yourdomain\.com|your-domain\.example|example\.com)$/i.test(sender)
  )
    return null;
  return { key, from };
}
export function emailDeliveryMode(): EmailDeliveryMode {
  if (!featureEnabled("email")) return "disabled";
  const provider = process.env.REACH_EMAIL_PROVIDER;
  if (provider === "disabled") return "disabled";
  if (provider === "preview")
    return process.env.NODE_ENV !== "production" ? "preview" : "disabled";
  if (provider === "smtp") return smtpConfiguration() ? "smtp" : "disabled";
  if (provider && provider !== "resend") return "disabled";
  return resendConfiguration() ? "resend" : "disabled";
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
export async function readBoundedResponse(
  response: Response,
  max = 65536,
): Promise<string> {
  if (Number(response.headers.get("content-length") || 0) > max)
    throw new Error("Response too large");
  const reader = response.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
type TransportResult = {
  status: "accepted" | "uncertain";
  messageId?: string;
  rfcMessageId?: string;
};
const RESEND_ENDPOINT = "https://api.resend.com";
const opaqueId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    value,
  );

/** Official SDK serialization with a private, bounded HTTP boundary.
 * Its default development logger can echo provider errors, so never call super.fetchRequest.
 */
export class PrivateResend extends Resend {
  constructor(
    key: string,
    private readonly fetcher: typeof fetch,
    private readonly allowedPath = "/emails",
    private readonly responseLimit = 65536,
  ) {
    super(key, { baseUrl: RESEND_ENDPOINT }); // Never honor a configurable credential destination.
  }
  override async fetchRequest<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<ResendResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const failure = (
      statusCode: number | null,
      name = "application_error",
      headers: Record<string, string> | null = null,
    ): ResendResponse<T> => ({
      data: null,
      error: {
        name: name as "application_error",
        statusCode,
        message: "Email service unavailable.",
      },
      headers,
    });
    try {
      if (
        path !== this.allowedPath ||
        !/^\/emails(?:\/receiving\/[a-f0-9-]{36})?$/.test(path)
      )
        return failure(null);
      const response = await this.fetcher(RESEND_ENDPOINT + path, {
        ...options,
        redirect: "error",
        signal: controller.signal,
      });
      const raw = await readBoundedResponse(response, this.responseLimit);
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        return failure(response.ok ? null : response.status);
      }
      if (!response.ok) {
        const name =
          value && typeof value === "object" && "name" in value
            ? String(value.name)
            : "application_error";
        const allowed = [
          "rate_limit_exceeded",
          "daily_quota_exceeded",
          "monthly_quota_exceeded",
          "invalid_idempotent_request",
          "concurrent_idempotent_requests",
        ];
        return failure(
          response.status,
          allowed.includes(name) ? name : "application_error",
          { "retry-after": response.headers.get("retry-after") || "" },
        );
      }
      return { data: value as T, error: null, headers: null };
    } catch {
      return failure(null);
    } finally {
      clearTimeout(timer);
    }
  }
}
async function resendSend(
  mail: AccountMail,
  id: string,
  fetcher: typeof fetch,
): Promise<TransportResult> {
  const config = resendConfiguration();
  if (!config) throw new MailDeliveryError("not_configured", false);
  const client = new PrivateResend(config.key, fetcher);
  const { data, error, headers } = await client.emails.send(
    {
      from: config.from,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      ...(mail.html ? { html: mail.html } : {}),
    },
    { idempotencyKey: `reach-email/${id}` },
  );
  if (error) {
    const status = error.statusCode;
    if (status === 401 || status === 403)
      throw new MailDeliveryError("authentication", false);
    if (
      error.name === "daily_quota_exceeded" ||
      error.name === "monthly_quota_exceeded"
    )
      throw new MailDeliveryError("quota", false);
    if (status === 429) {
      const delay = Number(headers?.["retry-after"]);
      throw new MailDeliveryError(
        "throttled",
        true,
        Number.isFinite(delay)
          ? Math.min(2000, Math.max(250, delay * 1000))
          : 250,
      );
    }
    // A concurrent idempotent operation may already be processing the same send.
    // Keep its account link valid and avoid an automatic duplicate request.
    if (status === 409) return { status: "uncertain" };
    if (status && status >= 400 && status < 500 && status !== 408)
      throw new MailDeliveryError("rejected", false);
    return { status: "uncertain" };
  }
  return opaqueId(data?.id)
    ? { status: "accepted", messageId: data.id }
    : { status: "uncertain" };
}
export async function deliverMail(
  db: DatabaseSync,
  mail: AccountMail,
  options: {
    fetch?: typeof fetch;
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
      const result =
        mode === "smtp"
          ? await smtpSend(
              mail,
              id,
              options.smtpTransportFactory,
              smtpDeadlineAt,
            )
          : await resendSend(mail, id, options.fetch || fetch);
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
