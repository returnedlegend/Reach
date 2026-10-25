import nodemailer from "nodemailer";
import type { SendMailOptions, SentMessageInfo, Transporter } from "nodemailer";
import type { AccountMail, MailDeliveryError } from "./mail-delivery";

export type SmtpConfiguration = {
  host: string;
  port: 465 | 587;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
};
export type SmtpSendResult = {
  status: "accepted" | "uncertain";
  rfcMessageId?: string;
  providerMessageId?: string;
};
export type SmtpTransport = Pick<Transporter, "sendMail"> &
  Partial<Pick<Transporter, "close">>;
export type SmtpTransportFactory = (config: SmtpConfiguration) => SmtpTransport;
export const SMTP_SEND_DEADLINE_MS = 20_000;

const cleanHeader = (value: string) => !!value && !/[\r\n\0]/.test(value);
const validEmail = (value: string) =>
  value.length <= 254 &&
  /^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(value) &&
  cleanHeader(value);

export function smtpConfiguration(): SmtpConfiguration | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const secure = process.env.SMTP_SECURE;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD || "";
  const fromEmail = process.env.SMTP_FROM_EMAIL || "";
  const fromName = process.env.SMTP_FROM_NAME || "";
  const validPort = port === "465" || port === "587";
  const validSecurity =
    (port === "465" && secure === "true") ||
    (port === "587" && secure === "false");
  if (
    !host ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(host) ||
    !validPort ||
    !validSecurity ||
    !user ||
    !cleanHeader(user) ||
    user.length > 320 ||
    !password ||
    /[\r\n\0]/.test(password) ||
    /(?:placeholder|your_password|xxxxxxxx)/i.test(password) ||
    !validEmail(fromEmail) ||
    /@(?:yourdomain\.com|your-domain\.example|example\.com)$/i.test(
      fromEmail,
    ) ||
    !cleanHeader(fromName) ||
    fromName.length > 100
  )
    return null;
  return {
    host,
    port: port === "465" ? 465 : 587,
    secure: port === "465",
    user,
    password,
    fromEmail,
    fromName,
  };
}

export function smtpTransportOptions(config: SmtpConfiguration) {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.port === 587,
    auth: { user: config.user, pass: config.password },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" as const },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    logger: false,
    debug: false,
  };
}

const defaultFactory: SmtpTransportFactory = (config) => {
  const transport = nodemailer.createTransport(smtpTransportOptions(config));
  return transport;
};

function safeError(error: unknown): {
  code?: string;
  responseCode?: number;
  command?: string;
} {
  if (!error || typeof error !== "object") return {};
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    responseCode:
      typeof value.responseCode === "number" ? value.responseCode : undefined,
    command: typeof value.command === "string" ? value.command : undefined,
  };
}

export async function smtpSend(
  mail: AccountMail,
  deliveryId: string,
  factory: SmtpTransportFactory = defaultFactory,
  deadlineAt = Date.now() + SMTP_SEND_DEADLINE_MS,
): Promise<SmtpSendResult> {
  const config = smtpConfiguration();
  if (!config) {
    const { MailDeliveryError } = await import("./mail-delivery");
    throw new MailDeliveryError("not_configured", false);
  }
  let transport: SmtpTransport | undefined;
  let closed = false;
  const closeTransport = () => {
    if (closed) return;
    closed = true;
    try {
      transport?.close?.();
    } catch {
      // A close failure cannot change SMTP acceptance metadata.
    }
  };
  try {
    transport = factory(config);
    const domain = config.fromEmail.slice(
      config.fromEmail.lastIndexOf("@") + 1,
    );
    const rfcMessageId = `<reach.${deliveryId}@${domain}>`;
    const options = {
      from: { name: config.fromName, address: config.fromEmail },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      messageId: rfcMessageId,
    } satisfies SendMailOptions;
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return { status: "uncertain" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        closeTransport();
        resolve(null);
      }, remaining);
      timer.unref?.();
    });
    let rawInfo: SentMessageInfo | null;
    try {
      rawInfo = await Promise.race([
        transport.sendMail(options).then((info) => info as SentMessageInfo),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (rawInfo === null) return { status: "uncertain" };
    const info = rawInfo;
    const accepted = Array.isArray(info.accepted) ? info.accepted : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected : [];
    if (!accepted.length || rejected.length) {
      const { MailDeliveryError } = await import("./mail-delivery");
      throw new MailDeliveryError("rejected", false);
    }
    const returnedMessageId =
      typeof info.messageId === "string" &&
      info.messageId.length <= 254 &&
      /^<[A-Za-z0-9._+-]{1,180}@[A-Za-z0-9.-]{1,253}>$/.test(info.messageId)
        ? info.messageId
        : rfcMessageId;
    return {
      status: "accepted",
      rfcMessageId: returnedMessageId,
    };
  } catch (error) {
    const { MailDeliveryError } = await import("./mail-delivery");
    if (error instanceof MailDeliveryError) throw error;
    const details = safeError(error);
    if (
      details.responseCode &&
      details.responseCode >= 400 &&
      details.responseCode < 500
    ) {
      if (
        details.responseCode === 421 ||
        details.responseCode === 429 ||
        details.responseCode === 450 ||
        details.responseCode === 451 ||
        details.responseCode === 452
      )
        throw new MailDeliveryError("throttled", true, 250);
      throw new MailDeliveryError("temporary_refusal", true, 250);
    }
    if (
      details.responseCode &&
      details.responseCode >= 500 &&
      details.responseCode < 600
    )
      throw new MailDeliveryError(
        details.responseCode === 535 || details.responseCode === 534
          ? "authentication"
          : "rejected",
        false,
      );
    // A socket failure, especially during DATA, may follow SMTP acceptance. Never retry it.
    return { status: "uncertain" };
  } finally {
    closeTransport();
  }
}
