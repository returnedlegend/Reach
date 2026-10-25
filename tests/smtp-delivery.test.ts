import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverMail,
  emailDeliveryMode,
  MailDeliveryError,
} from "../src/lib/mail-delivery";
import type {
  SmtpTransport,
  SmtpTransportFactory,
} from "../src/lib/smtp-delivery";
import {
  smtpConfiguration,
  smtpSend,
  smtpTransportOptions,
} from "../src/lib/smtp-delivery";
import type { SendMailOptions } from "nodemailer";

const mail = {
  to: "member@example.org",
  subject: "Synthetic SMTP test",
  text: "Synthetic body; never delivered",
  kind: "verify",
};
let db: DatabaseSync;

function configureSmtp() {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REACH_EMAIL_PROVIDER", "smtp");
  vi.stubEnv("SMTP_HOST", "smtp.example.org");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_SECURE", "true");
  vi.stubEnv("SMTP_USER", "mailer");
  vi.stubEnv("SMTP_PASSWORD", "synthetic-password");
  vi.stubEnv("SMTP_FROM_EMAIL", "mail@example.org");
  vi.stubEnv("SMTP_FROM_NAME", "Reach test");
}

beforeEach(() => {
  configureSmtp();
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY)");
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SMTP delivery boundary", () => {
  it("enables SMTP only when its explicit supported configuration is valid", () => {
    expect(emailDeliveryMode()).toBe("smtp");
    vi.stubEnv("SMTP_HOST", "smtp://invalid.example");
    expect(emailDeliveryMode()).toBe("disabled");
    vi.stubEnv("SMTP_HOST", "smtp.example.org");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_SECURE", "true");
    expect(emailDeliveryMode()).toBe("disabled");
  });

  it("accepts independent relay credentials and rejects malformed headers", () => {
    vi.stubEnv("SMTP_HOST", "mail.relay.example.net");
    vi.stubEnv("SMTP_USER", "reach@example.net");
    vi.stubEnv("SMTP_PASSWORD", "synthetic arbitrary password !@#");
    expect(smtpConfiguration()).toMatchObject({
      host: "mail.relay.example.net",
      user: "reach@example.net",
    });
    vi.stubEnv("SMTP_USER", "mailer\r\nInjected: value");
    expect(emailDeliveryMode()).toBe("disabled");
    vi.stubEnv("SMTP_USER", "mailer");
    vi.stubEnv("REACH_EMAIL_PROVIDER", "unsupported");
    expect(emailDeliveryMode()).toBe("disabled");
  });

  it("classifies authentication and permanent refusal without exposing private diagnostics", async () => {
    for (const [responseCode, code] of [
      [535, "authentication"],
      [550, "rejected"],
    ] as const) {
      const sendMail = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("private credential and recipient"), {
            responseCode,
          }),
        );
      await expect(
        deliverMail(db, mail, { smtpTransportFactory: () => ({ sendMail }) }),
      ).rejects.toMatchObject({ code, retryable: false });
      expect(sendMail).toHaveBeenCalledTimes(1);
    }
    expect(
      JSON.stringify(db.prepare("SELECT * FROM mail_deliveries").all()),
    ).not.toContain("private credential");
  });

  it("uses explicit STARTTLS configuration on port 587", async () => {
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_SECURE", "false");
    let config: Parameters<SmtpTransportFactory>[0] | undefined;
    const factory: SmtpTransportFactory = (value) => {
      config = value;
      return {
        sendMail: vi.fn().mockResolvedValue({
          accepted: [mail.to],
          rejected: [],
          messageId: "<starttls@example.org>",
          response: "250 OK",
        }) as unknown as SmtpTransport["sendMail"],
      };
    };
    expect(
      (await deliverMail(db, mail, { smtpTransportFactory: factory })).status,
    ).toBe("accepted");
    expect(config).toMatchObject({
      port: 587,
      secure: false,
      host: "smtp.example.org",
    });
  });

  it("stores accepted SMTP delivery and its RFC Message-ID separately from provider ID", async () => {
    const sendMail = vi.fn(async (message: SendMailOptions) => ({
      accepted: ["member@example.org"],
      rejected: [],
      messageId: String(message.messageId),
      response: "250 OK",
    }));
    const factory = vi.fn<SmtpTransportFactory>(() => ({
      sendMail: sendMail as unknown as SmtpTransport["sendMail"],
    }));
    const result = await deliverMail(db, mail, {
      smtpTransportFactory: factory,
    });
    expect(result.status).toBe("accepted");
    // Read options from the transport call itself without logging or using a socket.
    const sendOptions = sendMail.mock.calls[0][0];
    expect(sendOptions.headers).toBeUndefined();
    expect(sendOptions.messageId).toBe(`<reach.${result.id}@example.org>`);
    expect(sendOptions.from).toEqual({
      name: "Reach test",
      address: "mail@example.org",
    });
    expect(
      db
        .prepare(
          "SELECT provider,status,provider_message_id,rfc_message_id FROM mail_deliveries",
        )
        .get(),
    ).toEqual({
      provider: "smtp",
      status: "accepted",
      provider_message_id: null,
      rfc_message_id: sendOptions.messageId,
    });
    const stored = JSON.stringify(
      db.prepare("SELECT * FROM mail_deliveries").all(),
    );
    expect(stored).not.toContain(mail.to);
    expect(stored).not.toContain(mail.text);
  });

  it("retries only an explicit temporary SMTP refusal with a bounded attempt count", async () => {
    const error = Object.assign(new Error("private server response"), {
      responseCode: 451,
      command: "DATA",
    });
    const sendMail = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        accepted: [mail.to],
        rejected: [],
        messageId: "<ok@example.org>",
        response: "250 OK",
      });
    const factory: SmtpTransportFactory = () => ({
      sendMail: sendMail as unknown as SmtpTransport["sendMail"],
    });
    const result = await deliverMail(db, mail, {
      smtpTransportFactory: factory,
      maxAttempts: 2,
    });
    expect(result.status).toBe("accepted");
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT attempts FROM mail_deliveries").get()).toEqual({
      attempts: 2,
    });
  });

  it("marks a network ambiguity uncertain without retrying after DATA", async () => {
    const error = Object.assign(new Error("private network details"), {
      code: "ECONNECTION",
      command: "DATA",
    });
    const sendMail = vi.fn().mockRejectedValue(error);
    const factory: SmtpTransportFactory = () => ({
      sendMail: sendMail as unknown as SmtpTransport["sendMail"],
    });
    const result = await deliverMail(db, mail, {
      smtpTransportFactory: factory,
      maxAttempts: 2,
    });
    expect(result.status).toBe("uncertain");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare(
          "SELECT status,attempts,error_code,rfc_message_id FROM mail_deliveries",
        )
        .get(),
    ).toEqual({
      status: "uncertain",
      attempts: 1,
      error_code: "ambiguous",
      rfc_message_id: null,
    });
  });

  it("does not fall back to another transport when SMTP credentials are placeholders", async () => {
    vi.stubEnv("SMTP_PASSWORD", "placeholder");
    expect(emailDeliveryMode()).toBe("disabled");
    await expect(deliverMail(db, mail)).rejects.toBeInstanceOf(
      MailDeliveryError,
    );
  });

  it("uses only canonical SMTP_FROM sender variables even when generic aliases conflict", async () => {
    vi.stubEnv("SMTP_FROM_EMAIL", "canonical@example.org");
    vi.stubEnv("SMTP_FROM_NAME", "Canonical Reach");
    vi.stubEnv("FROM_EMAIL", "wrong@example.net");
    vi.stubEnv("FROM_NAME", "Wrong sender");
    let sent: SendMailOptions | undefined;
    const factory: SmtpTransportFactory = () => ({
      sendMail: vi.fn(async (message) => {
        sent = message;
        return {
          accepted: [mail.to],
          rejected: [],
          messageId: "<canonical@example.org>",
        };
      }) as unknown as SmtpTransport["sendMail"],
    });
    expect(
      (await deliverMail(db, mail, { smtpTransportFactory: factory })).status,
    ).toBe("accepted");
    expect(sent?.from).toEqual({
      name: "Canonical Reach",
      address: "canonical@example.org",
    });
  });

  it("requires certificate-validated implicit TLS or STARTTLS options", () => {
    const config = smtpConfiguration();
    expect(config).not.toBeNull();
    const smtps = smtpTransportOptions(config!);
    expect(smtps).toMatchObject({
      secure: true,
      requireTLS: false,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    });
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_SECURE", "false");
    const startTls = smtpTransportOptions(smtpConfiguration()!);
    expect(startTls).toMatchObject({
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    });
  });

  it("returns uncertain and closes a stalled transport at the hard deadline", async () => {
    let release: (() => void) | undefined;
    const sendMail = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              accepted: [mail.to],
              rejected: [],
              messageId: "<late@example.org>",
            });
        }),
    );
    const close = vi.fn();
    const factory: SmtpTransportFactory = () => ({
      sendMail: sendMail as unknown as SmtpTransport["sendMail"],
      close,
    });
    const result = await smtpSend(
      mail,
      "stable-delivery-id",
      factory,
      Date.now() + 15,
    );
    expect(result).toEqual({ status: "uncertain" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    release?.();
  });
});
