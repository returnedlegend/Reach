import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverMail,
  emailDeliveryMode,
  initializeMailSchema,
  MailDeliveryError,
} from "../src/lib/mail-delivery";
import { renderEmail } from "../src/lib/email-templates";
const mail = {
  to: "member@example.org",
  subject: "Your Reach message",
  text: "private body with secret-token",
  kind: "verify",
};
let db: DatabaseSync;
const directories: string[] = [];
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REACH_EMAIL_PROVIDER", "smtp");
  vi.stubEnv("SMTP_HOST", "smtp.example.org");
  vi.stubEnv("SMTP_USER", "mailer");
  vi.stubEnv("SMTP_PASSWORD", "synthetic-password");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("SMTP_SECURE", "true");
  vi.stubEnv("SMTP_FROM_EMAIL", "hello@example.org");
  vi.stubEnv("SMTP_FROM_NAME", "Reach");
  vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example.org");
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY)");
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function success() {
  return {
    accepted: [mail.to],
    rejected: [],
    messageId: "<fixture@example.org>",
  };
}
describe("central delivery boundary", () => {
  it("enforces persistent caps atomically inside existing transactions", async () => {
    vi.stubEnv("REACH_EMAIL_HOURLY_LIMIT", "1");
    initializeMailSchema(db);
    const fetcher = vi.fn().mockResolvedValue(success());
    db.exec("BEGIN");
    await deliverMail(db, mail, {
      smtpTransportFactory: () => ({ sendMail: fetcher }),
    });
    db.exec("COMMIT");
    await expect(
      deliverMail(db, mail, {
        smtpTransportFactory: () => ({ sendMail: fetcher }),
      }),
    ).rejects.toMatchObject({ code: "rate_limited", retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps a possibly accepted account link valid if metadata finalization fails", async () => {
    initializeMailSchema(db);
    db.exec(
      "CREATE TRIGGER fail_delivery_update BEFORE UPDATE ON mail_deliveries BEGIN SELECT RAISE(ABORT,'disk full'); END",
    );
    expect(
      (
        await deliverMail(db, mail, {
          smtpTransportFactory: () => ({
            sendMail: vi.fn().mockResolvedValue(success()),
          }),
        })
      ).status,
    ).toBe("uncertain");
  });
  it("rejects header injection before any request", async () => {
    const fetcher = vi.fn();
    await expect(
      deliverMail(
        db,
        { ...mail, subject: "Hello\r\nBcc: thief@example.org" },
        { smtpTransportFactory: () => ({ sendMail: fetcher }) },
      ),
    ).rejects.toBeInstanceOf(MailDeliveryError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sets nullable user metadata to null when the account is deleted", async () => {
    db.prepare("INSERT INTO users VALUES(?)").run("user-1");
    await deliverMail(
      db,
      { ...mail, userId: "user-1" },
      {
        smtpTransportFactory: () => ({
          sendMail: vi.fn().mockResolvedValue(success()),
        }),
      },
    );
    db.prepare("DELETE FROM users WHERE id=?").run("user-1");
    expect(
      db.prepare("SELECT user_id FROM mail_deliveries").get()?.user_id,
    ).toBeNull();
  });
  it("migrates integer provider IDs to text and preserves linked account history", () => {
    db.prepare("INSERT INTO users VALUES(?)").run("legacy-user");
    db.exec(`CREATE TABLE mail_deliveries (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL,
      provider_message_id INTEGER, rfc_message_id TEXT, event_at REAL,
      error_code TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE notification_outbox(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), delivery_id TEXT);`);
    db.prepare(
      "INSERT INTO mail_deliveries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "legacy-delivery",
      "legacy-user",
      "verify",
      "postal",
      "delivered",
      701,
      "legacy-rfc-id",
      1000,
      null,
      1,
      "2024-01-01",
      "2024-01-02",
    );
    db.prepare("INSERT INTO notification_outbox VALUES(?,?,?)").run(
      "outbox-link",
      "legacy-user",
      "legacy-delivery",
    );
    initializeMailSchema(db);
    expect(
      db
        .prepare("PRAGMA table_info(mail_deliveries)")
        .all()
        .find((c) => c.name === "provider_message_id")?.type,
    ).toBe("TEXT");
    expect(
      db
        .prepare(
          "SELECT provider_message_id,provider,status,user_id,rfc_message_id FROM mail_deliveries",
        )
        .get(),
    ).toEqual({
      provider_message_id: "701",
      provider: "postal",
      status: "delivered",
      user_id: "legacy-user",
      rfc_message_id: "legacy-rfc-id",
    });
    expect(
      db
        .prepare(
          "SELECT o.user_id,o.delivery_id,d.status FROM notification_outbox o JOIN mail_deliveries d ON d.id=o.delivery_id WHERE o.id=?",
        )
        .get("outbox-link"),
    ).toEqual({
      user_id: "legacy-user",
      delivery_id: "legacy-delivery",
      status: "delivered",
    });
  });

  it("requires explicit private preview and never enables it in production", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reach-mail-"));
    directories.push(dir);
    vi.stubEnv("REACH_EMAIL_PROVIDER", "preview");
    vi.stubEnv("REACH_EMAIL_PREVIEW_DIR", dir);
    const logger = vi.spyOn(console, "log");
    const result = await deliverMail(db, mail);
    expect(result.status).toBe("preview");
    const file = join(dir, readdirSync(dir)[0]);
    // Windows exposes ACLs rather than POSIX permission bits.
    if (process.platform !== "win32")
      expect(statSync(file).mode & 0o777).toBe(0o600);
    // Windows exposes ACLs rather than POSIX permission bits.
    if (process.platform !== "win32")
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readFileSync(file, "utf8")).toContain("secret-token");
    expect(logger).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "production");
    expect(emailDeliveryMode()).toBe("disabled");
  });
  it("escapes dynamic HTML and validates action and unsubscribe origins", () => {
    const result = renderEmail({
      heading: "<script>alert(1)</script>",
      paragraphs: ["a & b"],
      action: {
        label: "Verify <email>",
        url: "https://reach.example.org/verify?token=a&b=c",
      },
      unsubscribeUrl: "https://reach.example.org/unsubscribe?token=x",
    });
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("token=a&amp;b=c");
    expect(result.text).toContain("Unsubscribe:");
    expect(() =>
      renderEmail({
        heading: "x",
        paragraphs: [],
        action: { label: "x", url: "https://evil.example.org/" },
      }),
    ).toThrow();
  });
});
