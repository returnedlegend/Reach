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
  vi.stubEnv("REACH_EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "re_testtoken");
  vi.stubEnv("RESEND_FROM_EMAIL", "Reach <hello@example.org>");
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
function success(id = "00000000-0000-4000-8000-000000000123") {
  return Response.json({ id });
}
describe("central delivery boundary", () => {
  it("uses the fixed Resend endpoint and stores only opaque metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(success());
    const result = await deliverMail(db, mail, { fetch: fetcher });
    expect(result.status).toBe("accepted");
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer re_testtoken",
    );
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: "Reach <hello@example.org>",
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
    });
    expect(new Headers(request?.headers).get("idempotency-key")).toBeTruthy();
    const stored = JSON.stringify(
      db.prepare("SELECT * FROM mail_deliveries").all(),
    );
    for (const secret of [
      mail.to,
      mail.text,
      "secret-token",
      "server-secret",
      "re_testtoken",
    ])
      expect(stored).not.toContain(secret);
    expect(
      db
        .prepare(
          "SELECT status,provider_message_id,attempts FROM mail_deliveries",
        )
        .get(),
    ).toMatchObject({
      status: "accepted",
      provider_message_id: "00000000-0000-4000-8000-000000000123",
      attempts: 1,
    });
  });
  it("handles Resend authentication errors without copying echoed credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 401,
          name: "validation_error",
          message: "server-secret",
        }),
        { status: 401 },
      ),
    );
    await expect(
      deliverMail(db, mail, { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "authentication", retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(db.prepare("SELECT * FROM mail_deliveries").all()),
    ).not.toContain("server-secret");
  });
  it("keeps concurrent idempotent sends uncertain without retrying or logging provider details", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_BASE_URL", "https://untrusted.example.org");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          name: "concurrent_idempotent_requests",
          message: "private-provider-detail secret-token re_testtoken",
        },
        { status: 409 },
      ),
    );
    expect((await deliverMail(db, mail, { fetch: fetcher })).status).toBe(
      "uncertain",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
    expect(log).not.toHaveBeenCalled();
    expect(
      JSON.stringify(db.prepare("SELECT * FROM mail_deliveries").all()),
    ).not.toContain("private-provider-detail");
  });
  it("retries an explicit HTTP429 but does not resend an ambiguous network failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            statusCode: 429,
            name: "rate_limit_exceeded",
            message: "slow down",
          },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(success());
    expect((await deliverMail(db, mail, { fetch: fetcher })).status).toBe(
      "accepted",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetcher.mock.calls[0][1]?.headers).get("idempotency-key"),
    ).toBe(
      new Headers(fetcher.mock.calls[1][1]?.headers).get("idempotency-key"),
    );
    const lost = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("secret-token transport detail"));
    expect((await deliverMail(db, mail, { fetch: lost })).status).toBe(
      "uncertain",
    );
    expect(lost).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(db.prepare("SELECT * FROM mail_deliveries").all()),
    ).not.toContain("secret-token");
  });
  it("does not retry quota exhaustion and classifies permanent rejection", async () => {
    for (const [response, code] of [
      [
        Response.json(
          { statusCode: 429, name: "daily_quota_exceeded", message: "quota" },
          { status: 429 },
        ),
        "quota",
      ],
      [
        Response.json(
          {
            statusCode: 422,
            name: "validation_error",
            message: "invalid sender",
          },
          { status: 422 },
        ),
        "rejected",
      ],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        deliverMail(db, mail, { fetch: fetcher }),
      ).rejects.toMatchObject({
        code,
        retryable: false,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("enforces persistent caps atomically inside existing transactions", async () => {
    vi.stubEnv("REACH_EMAIL_HOURLY_LIMIT", "1");
    initializeMailSchema(db);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(success());
    db.exec("BEGIN");
    await deliverMail(db, mail, { fetch: fetcher });
    db.exec("COMMIT");
    await expect(
      deliverMail(db, mail, { fetch: fetcher }),
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
          fetch: vi.fn<typeof fetch>().mockResolvedValue(success()),
        })
      ).status,
    ).toBe("uncertain");
  });
  it("rejects header injection before any request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      deliverMail(
        db,
        { ...mail, subject: "Hello\r\nBcc: thief@example.org" },
        { fetch: fetcher },
      ),
    ).rejects.toBeInstanceOf(MailDeliveryError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sets nullable user metadata to null when the account is deleted", async () => {
    db.prepare("INSERT INTO users VALUES(?)").run("user-1");
    await deliverMail(
      db,
      { ...mail, userId: "user-1" },
      { fetch: vi.fn<typeof fetch>().mockResolvedValue(success()) },
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
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
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
