import { closeCommunityDatabases } from "../src/lib/community";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { openPantryDatabase } from "../src/lib/pantry-store";
import { accountHash } from "../src/lib/account-store";
import {
  deliverMail,
  emailDeliveryMode,
  initializeMailSchema,
  MailDeliveryError,
} from "../src/lib/mail-delivery";
import { renderEmail } from "../src/lib/email-templates";
import { createResendWebhookHandler } from "../src/lib/resend-webhook";
import { createNotificationsHandler } from "../src/lib/notifications-api";
import {
  createUnsubscribeToken,
  getNotificationPreferences,
  initializeNotifications,
  queueNotification,
  saveNotificationPreferences,
} from "../src/lib/notifications-store";
import { dispatchNotifications } from "../src/lib/notifications-worker";
import { initializeVolunteerSchema } from "../src/lib/volunteer-store";
import { createVolunteerHandler } from "../src/lib/volunteer";

const origin = "https://reach.example";
const address = "private-recipient@example.org";
const secret = "re_testtoken";
const messageId = "00000000-0000-4000-8000-000000000701";
const signingSecret = Buffer.from("svix signing fixture secret").toString(
  "base64",
);
const rawToken = "a".repeat(64);
const mail = {
  to: address,
  subject: "Verify your Reach email",
  text: `${origin}/account#verify=${rawToken}`,
  kind: "verify",
};
let directory: string;
let db: ReturnType<typeof openPantryDatabase>;
let instant: Date;

function accepted(_id = 701) {
  return Response.json({ id: messageId });
}
function actor(verified = true) {
  const id = randomUUID(),
    token = randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,email,email_verified_at) VALUES(?,?,?,'','resident',1,?,?,?)",
  ).run(
    id,
    id,
    "not-a-password",
    instant.toISOString(),
    `${id}@example.org`,
    verified ? instant.toISOString() : null,
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    id,
    new Date(+instant + 3600000).toISOString(),
  );
  return { id, cookie: `reach_community_session=${token}` };
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-mail-independent-"));
  db = openPantryDatabase(join(directory, "community.sqlite"));
  instant = new Date();
  vi.stubEnv("REACH_APP_ORIGIN", origin);
  vi.stubEnv("REACH_EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", secret);
  vi.stubEnv("RESEND_FROM_EMAIL", "Reach <reach@example.org>");
  initializeMailSchema(db);
  initializeNotifications(db);
});
afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe("independent Resend transport security", () => {
  it("sends one private recipient server-side and stores only delivery metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    const result = await deliverMail(db, mail, { fetch: fetcher });
    expect(result.status).toBe("accepted");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${secret}`,
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: "Reach <reach@example.org>",
      to: [address],
      subject: mail.subject,
      text: mail.text,
    });
    const record = JSON.stringify(
      db.prepare("SELECT * FROM mail_deliveries").all(),
    );
    for (const privateValue of [
      address,
      secret,
      rawToken,
      "private-provider-token",
      mail.subject,
    ])
      expect(record).not.toContain(privateValue);
  });

  it("retries a definite throttle but never retries an ambiguous network outcome", async () => {
    const retry = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            statusCode: 429,
            name: "rate_limit_exceeded",
            message: "try later",
          },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(accepted());
    expect((await deliverMail(db, mail, { fetch: retry })).status).toBe(
      "accepted",
    );
    expect(retry).toHaveBeenCalledTimes(2);
    const ambiguous = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`timeout ${secret} ${rawToken}`));
    expect((await deliverMail(db, mail, { fetch: ambiguous })).status).toBe(
      "uncertain",
    );
    expect(ambiguous).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare(
          "SELECT status,error_code,attempts FROM mail_deliveries WHERE status='uncertain'",
        )
        .get(),
    ).toMatchObject({
      status: "uncertain",
      error_code: "ambiguous",
      attempts: 1,
    });
  });

  it("treats provider 5xx and malformed success as ambiguous without resending", async () => {
    for (const response of [
      new Response("private details", { status: 503 }),
      Response.json({ id: "malformed-id" }),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect((await deliverMail(db, mail, { fetch: fetcher })).status).toBe(
        "uncertain",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("recognizes HTTP and application-level invalid credentials without retry or private error leakage", async () => {
    for (const response of [
      new Response(secret, { status: 401 }),
      new Response(secret, { status: 403 }),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        deliverMail(db, mail, { fetch: fetcher }),
      ).rejects.toMatchObject({ code: "authentication", retryable: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const stored = JSON.stringify(
      db.prepare("SELECT * FROM mail_deliveries").all(),
    );
    for (const value of [secret, address, rawToken])
      expect(stored).not.toContain(value);
  });

  it("fails closed on unconfigured transport and header injection before network access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      deliverMail(
        db,
        { ...mail, subject: "Hello\r\nBcc: attacker@example.org" },
        { fetch: fetcher },
      ),
    ).rejects.toMatchObject({ code: "invalid_message" });
    await expect(
      deliverMail(
        db,
        { ...mail, to: "a@example.org,b@example.org" },
        { fetch: fetcher },
      ),
    ).rejects.toMatchObject({ code: "invalid_message" });
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    expect(emailDeliveryMode()).toBe("disabled");
    await expect(
      deliverMail(db, mail, { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("enforces persistent send limits before sending", async () => {
    vi.stubEnv("REACH_EMAIL_HOURLY_LIMIT", "1");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(accepted());
    await deliverMail(db, mail, { fetch: fetcher });
    await expect(
      deliverMail(db, mail, { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("labels private development capture as preview and disables it in production", async () => {
    const preview = join(directory, "preview");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    vi.stubEnv("REACH_EMAIL_PROVIDER", "preview");
    vi.stubEnv("REACH_EMAIL_PREVIEW_DIR", preview);
    vi.stubEnv("NODE_ENV", "development");
    const fetcher = vi.fn<typeof fetch>();
    expect((await deliverMail(db, mail, { fetch: fetcher })).status).toBe(
      "preview",
    );
    const filename = join(preview, readdirSync(preview)[0]);
    // Windows exposes ACLs rather than POSIX permission bits.
    if (process.platform !== "win32")
      expect(statSync(filename).mode & 0o777).toBe(0o600);
    // Windows exposes ACLs rather than POSIX permission bits.
    if (process.platform !== "win32")
      expect(statSync(preview).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(filename, "utf8")).text).toBe(mail.text);
    vi.stubEnv("NODE_ENV", "production");
    expect(emailDeliveryMode()).toBe("disabled");
    await expect(
      deliverMail(db, mail, { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("escapes dynamic HTML and refuses off-origin or script action links", () => {
    const rendered = renderEmail({
      heading: '<img src=x onerror="alert(1)">',
      paragraphs: ["<script>alert(1)</script>"],
      action: { label: "<Click>", url: `${origin}/account#verify=${rawToken}` },
    });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).toContain("&lt;Click&gt;");
    expect(rendered.text).toContain(mail.text);
    for (const url of [
      "javascript:alert(1)",
      "https://attacker.example/path",
      `${origin}/\r\nLocation:x`,
    ])
      expect(() =>
        renderEmail({
          heading: "Reach",
          paragraphs: [],
          action: { label: "Open", url },
        }),
      ).toThrow();
  });
});

describe("independent notification consent and privacy", () => {
  it("defaults optional mail off, requires verification, and deduplicates metadata-only queue entries", () => {
    const user = actor(),
      unverified = actor(false);
    expect(getNotificationPreferences(db, user.id)).toEqual({
      pantry: false,
      volunteer: false,
      pickup: false,
      volunteerParticipation: false,
    });
    const event = {
      userId: user.id,
      eventKey: "pantry:change:1",
      category: "pantry" as const,
      kind: "pantry-updated" as const,
      resourceType: "pantry" as const,
      resourceId: "fixture-pantry",
    };
    queueNotification(db, event);
    expect(
      db.prepare("SELECT count(*) n FROM notification_outbox").get()!.n,
    ).toBe(0);
    const optIn = {
      pantry: true,
      volunteer: true,
      pickup: true,
      volunteerParticipation: true,
    };
    saveNotificationPreferences(db, user.id, optIn);
    saveNotificationPreferences(db, unverified.id, optIn);
    queueNotification(db, event);
    queueNotification(db, event);
    queueNotification(db, { ...event, userId: unverified.id });
    expect(
      db.prepare("SELECT count(*) n FROM notification_outbox").get()!.n,
    ).toBe(1);
    const record = JSON.stringify(
      db.prepare("SELECT * FROM notification_outbox").all(),
    );
    expect(record).not.toContain("@example.org");
    expect(record).not.toContain(rawToken);
  });

  it("keeps preference writes same-origin and self-owned and rejects unverified opt-in", async () => {
    const handle = createNotificationsHandler(db),
      user = actor(),
      other = actor(),
      unverified = actor(false);
    const prefs = {
      pantry: true,
      volunteer: true,
      pickup: true,
      volunteerParticipation: true,
    };
    const request = (cookie: string, body: unknown, from = origin) =>
      new Request(`${origin}/api/notifications`, {
        method: "PUT",
        headers: { cookie, origin: from, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect(
      (await handle(request(user.cookie, prefs, "https://evil.example")))
        .status,
    ).toBe(403);
    expect((await handle(request(unverified.cookie, prefs))).status).toBe(403);
    expect(
      (await handle(request(user.cookie, { ...prefs, userId: other.id })))
        .status,
    ).toBe(400);
    expect((await handle(request(user.cookie, prefs))).status).toBe(200);
    expect(getNotificationPreferences(db, other.id).pantry).toBe(false);
  });

  it("stores unsubscribe hashes only, requires POST, hides token validity and preserves essential messages", async () => {
    const user = actor(),
      handle = createNotificationsHandler(db);
    saveNotificationPreferences(db, user.id, {
      pantry: true,
      volunteer: true,
      pickup: true,
      volunteerParticipation: true,
    });
    queueNotification(db, {
      userId: user.id,
      eventKey: "optional",
      category: "pantry",
      kind: "pantry-updated",
    });
    queueNotification(db, {
      userId: user.id,
      eventKey: "security",
      category: "security",
      kind: "password-changed",
    });
    const token = createUnsubscribeToken(db, user.id);
    expect(
      JSON.stringify(
        db.prepare("SELECT * FROM notification_unsubscribe").all(),
      ),
    ).not.toContain(token);
    expect(
      (
        await handle(
          new Request(`${origin}/api/notifications/unsubscribe?token=${token}`),
          ["unsubscribe"],
        )
      ).status,
    ).not.toBe(200);
    expect(getNotificationPreferences(db, user.id).pantry).toBe(true);
    const post = (value: string) =>
      handle(
        new Request(`${origin}/api/notifications/unsubscribe`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ token: value }),
        }),
        ["unsubscribe"],
      );
    const valid = await post(token),
      replay = await post(token),
      missing = await post("b".repeat(64));
    expect(await valid.json()).toEqual(await replay.json());
    expect(await missing.json()).toEqual({
      message:
        "If this link is current, optional email notifications are now off. You can also review preferences in your account.",
    });
    expect(getNotificationPreferences(db, user.id)).toMatchObject({
      pantry: false,
      volunteer: false,
      pickup: false,
      volunteerParticipation: true,
    });
    expect(
      db
        .prepare(
          "SELECT status FROM notification_outbox WHERE event_key='optional'",
        )
        .get()!.status,
    ).toBe("suppressed");
    expect(
      db
        .prepare(
          "SELECT status FROM notification_outbox WHERE event_key='security'",
        )
        .get()!.status,
    ).toBe("queued");
  });
});

describe("independent authenticated Resend webhook", () => {
  let webhookId = 0;
  function event(type = "email.delivered", emailId = messageId) {
    return {
      type,
      created_at: instant.toISOString(),
      data: {
        email_id: emailId,
        to: [address],
        subject: rawToken,
        private_payload: `${secret} ${rawToken}`,
      },
    };
  }
  function signed(
    body: unknown,
    options: {
      bodyOverride?: string;
      id?: string;
      timestamp?: string;
      signature?: string;
    } = {},
  ) {
    const raw = JSON.stringify(body);
    const id = options.id ?? `msg-${++webhookId}`;
    const timestamp = options.timestamp ?? String(Math.floor(+instant / 1000));
    const digest = createHmac("sha256", Buffer.from(signingSecret, "base64"))
      .update(`${id}.${timestamp}.${raw}`)
      .digest("base64");
    return new Request(`${origin}/api/email/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": options.signature ?? `v1,${digest}`,
      },
      body: options.bodyOverride ?? raw,
    });
  }
  async function setup() {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${signingSecret}`);
    await deliverMail(db, mail, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(accepted()),
    });
    return createResendWebhookHandler(db, { now: () => instant });
  }
  const state = () =>
    db
      .prepare("SELECT status FROM mail_deliveries WHERE provider_message_id=?")
      .get(messageId)!.status;

  it("authenticates exact raw bytes before changing state and stores no payload", async () => {
    const handle = await setup();
    const body = event();
    expect(
      (await handle(signed(body, { bodyOverride: JSON.stringify(body) + " " })))
        .status,
    ).toBe(401);
    expect(
      (await handle(signed(body, { signature: "v1,invalid" }))).status,
    ).toBe(401);
    expect(state()).toBe("accepted");
    expect(
      db.prepare("SELECT count(*) n FROM mail_webhook_events").get()!.n,
    ).toBe(0);
    expect((await handle(signed(body))).status).toBe(200);
    expect(state()).toBe("delivered");
    const records =
      JSON.stringify(db.prepare("SELECT * FROM mail_deliveries").all()) +
      JSON.stringify(db.prepare("SELECT * FROM mail_webhook_events").all());
    for (const value of [address, secret, rawToken])
      expect(records).not.toContain(value);
  });

  it("rejects stale timestamps and unknown email IDs without poisoning dedupe", async () => {
    const handle = await setup();
    expect(
      (
        await handle(
          signed(event(), {
            timestamp: String(Math.floor(+instant / 1000) - 301),
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handle(
          signed(
            event("email.delivered", "00000000-0000-4000-8000-000000009999"),
          ),
        )
      ).status,
    ).toBe(503);
    expect(state()).toBe("accepted");
    expect(
      db.prepare("SELECT count(*) n FROM mail_webhook_events").get()!.n,
    ).toBe(0);
  });

  it("deduplicates Svix IDs and prevents out-of-order status regression", async () => {
    const handle = await setup();
    const retryId = "duplicate-event-id";
    expect(
      (await handle(signed(event("email.delivery_delayed"), { id: retryId })))
        .status,
    ).toBe(200);
    expect(
      (await handle(signed(event("email.delivered"), { id: retryId }))).status,
    ).toBe(200);
    expect(state()).toBe("delayed");
    await handle(signed(event("email.delivered")));
    expect(state()).toBe("delivered");
    await handle(signed(event("email.delivery_delayed")));
    expect(state()).toBe("delivered");
    await handle(signed(event("email.bounced")));
    expect(state()).toBe("bounced");
    await handle(signed(event("email.delivered")));
    expect(state()).toBe("bounced");
  });

  it("maps sent, failed, suppressed and complaint events while ignoring tracking", async () => {
    const handle = await setup();
    expect((await handle(signed(event("email.sent")))).status).toBe(200);
    expect(state()).toBe("accepted");
    expect((await handle(signed(event("email.failed")))).status).toBe(200);
    expect(state()).toBe("failed");
    expect((await handle(signed(event("email.suppressed")))).status).toBe(200);
    expect(state()).toBe("failed");
    expect((await handle(signed(event("email.opened")))).status).toBe(200);
    expect(state()).toBe("failed");
    expect((await handle(signed(event("email.complained")))).status).toBe(200);
    expect(state()).toBe("bounced");
  });

  it("rejects unsigned, malformed and oversized requests", async () => {
    const handle = await setup();
    expect(
      (
        await handle(
          new Request(`${origin}/api/email/webhook`, {
            method: "POST",
            body: JSON.stringify(event()),
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (await handle(signed({ ...event(), padding: "x".repeat(65536) }))).status,
    ).toBe(400);
    expect(
      (await handle(signed({ type: "email.delivered", data: {} }))).status,
    ).toBe(400);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect((await handle(signed(event()))).status).toBe(503);
    expect(state()).toBe("accepted");
  });
});

describe("independent durable notification dispatch", () => {
  function fixture() {
    initializeVolunteerSchema(db);
    const donor = actor(),
      volunteer = actor();
    const pantry = String(
      db.prepare("SELECT id FROM pantries WHERE active=1 LIMIT 1").get()!.id,
    );
    const id = randomUUID(),
      offerId = randomUUID(),
      stamp = instant.toISOString();
    db.prepare(
      "INSERT INTO records VALUES(?,'offer',?,'approved',?,?,?,?,?,NULL)",
    ).run(
      offerId,
      donor.id,
      JSON.stringify({
        title: "Private recipient surplus",
        privatePickupInstructions: "Private library meeting point",
        sharePickupInstructions: true,
      }),
      new Date(+instant - 60000).toISOString(),
      new Date(+instant + 3600000).toISOString(),
      stamp,
      stamp,
    );
    db.prepare(
      "INSERT INTO volunteer_runs(id,offer_id,pantry_id,donor_id,status,created_at,updated_at) VALUES(?,?,?,?,'open',?,?)",
    ).run(id, offerId, pantry, donor.id, stamp, stamp);
    saveNotificationPreferences(db, volunteer.id, {
      pantry: false,
      volunteer: true,
      pickup: true,
      volunteerParticipation: true,
    });
    const queue = () =>
      queueNotification(
        db,
        {
          userId: volunteer.id,
          eventKey: `run:${id}:open`,
          category: "volunteer",
          kind: "new-opportunity",
          resourceType: "run",
          resourceId: id,
        },
        instant,
      );
    return { donor, volunteer, id, offerId, pantry, queue };
  }
  it("delivers authorized opportunities with generic content and never includes pickup instructions or other recipients", async () => {
    const f = fixture();
    f.queue();
    const send = vi
      .fn<
        NonNullable<Parameters<typeof dispatchNotifications>[1]>["send"] & {}
      >()
      .mockResolvedValue({ id: "injected-delivery", status: "accepted" });
    const result = await dispatchNotifications(db, {
      now: () => instant,
      send,
    });
    expect(result.accepted).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][1];
    expect(payload.to).toBe(`${f.volunteer.id}@example.org`);
    expect(payload.text).toContain("/unsubscribe#token=");
    for (const value of [
      "Private library",
      `${f.donor.id}@example.org`,
      "Private recipient surplus",
    ])
      expect(payload.text + payload.html).not.toContain(value);
    expect(
      (await dispatchNotifications(db, { now: () => instant, send })).processed,
    ).toBe(0);
  });
  it("rechecks blocks, current run availability and consent immediately before dispatch", async () => {
    const f = fixture();
    f.queue();
    db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(
      f.donor.id,
      f.volunteer.id,
      instant.toISOString(),
    );
    const send = vi.fn<
      NonNullable<Parameters<typeof dispatchNotifications>[1]>["send"] & {}
    >();
    expect(
      (await dispatchNotifications(db, { now: () => instant, send }))
        .suppressed,
    ).toBe(1);
    expect(send).not.toHaveBeenCalled();
    db.prepare("DELETE FROM blocks").run();
    db.prepare("UPDATE notification_outbox SET status='queued'").run();
    db.prepare("UPDATE volunteer_runs SET status='cancelled' WHERE id=?").run(
      f.id,
    );
    expect(
      (await dispatchNotifications(db, { now: () => instant, send }))
        .suppressed,
    ).toBe(1);
    db.prepare("UPDATE notification_outbox SET status='queued'").run();
    db.prepare("UPDATE volunteer_runs SET status='open' WHERE id=?").run(f.id);
    db.prepare(
      "UPDATE notification_preferences SET volunteer=0 WHERE user_id=?",
    ).run(f.volunteer.id);
    expect(
      (await dispatchNotifications(db, { now: () => instant, send }))
        .suppressed,
    ).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("backs off definite failures and never retries ambiguous or interrupted delivery", async () => {
    const user = actor();
    queueNotification(
      db,
      {
        userId: user.id,
        eventKey: "password:1",
        category: "security",
        kind: "password-changed",
      },
      instant,
    );
    const send = vi
      .fn<
        NonNullable<Parameters<typeof dispatchNotifications>[1]>["send"] & {}
      >()
      .mockRejectedValueOnce(new MailDeliveryError("throttled", true))
      .mockResolvedValueOnce({ id: "uncertain-id", status: "uncertain" });
    expect(
      (await dispatchNotifications(db, { now: () => instant, send })).retried,
    ).toBe(1);
    expect(
      (await dispatchNotifications(db, { now: () => instant, send })).processed,
    ).toBe(0);
    instant = new Date(+instant + 61000);
    expect(
      (await dispatchNotifications(db, { now: () => instant, send })).uncertain,
    ).toBe(1);
    instant = new Date(+instant + 3600000);
    expect(
      (await dispatchNotifications(db, { now: () => instant, send })).processed,
    ).toBe(0);
    queueNotification(
      db,
      {
        userId: user.id,
        eventKey: "password:2",
        category: "security",
        kind: "password-changed",
      },
      instant,
    );
    db.prepare(
      "UPDATE notification_outbox SET status='sending',updated_at=? WHERE event_key='password:2'",
    ).run(new Date(+instant - 121000).toISOString());
    expect(
      (await dispatchNotifications(db, { now: () => instant, send })).processed,
    ).toBe(0);
    expect(
      db
        .prepare(
          "SELECT status,error_code FROM notification_outbox WHERE event_key='password:2'",
        )
        .get(),
    ).toMatchObject({ status: "uncertain", error_code: "interrupted" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("suppresses obsolete assignment messages and opportunities after a recipient becomes a manager", async () => {
    const f = fixture();
    f.queue();
    db.prepare("INSERT INTO pantry_managers VALUES(?,?,?,?)").run(
      f.pantry,
      f.volunteer.id,
      f.donor.id,
      instant.toISOString(),
    );
    const send = vi.fn<
      NonNullable<Parameters<typeof dispatchNotifications>[1]>["send"] & {}
    >();
    expect(
      (await dispatchNotifications(db, { now: () => instant, send }))
        .suppressed,
    ).toBe(1);
    db.prepare("DELETE FROM pantry_managers WHERE user_id=?").run(
      f.volunteer.id,
    );
    db.prepare(
      "UPDATE volunteer_runs SET volunteer_id=?,pickup_consent=1,status='assigned' WHERE id=?",
    ).run(f.volunteer.id, f.id);
    queueNotification(
      db,
      {
        userId: f.volunteer.id,
        eventKey: "assignment:old",
        category: "pickup",
        kind: "assignment-confirmed",
        resourceType: "run",
        resourceId: f.id,
      },
      instant,
    );
    db.prepare(
      "UPDATE volunteer_runs SET volunteer_id=NULL,pickup_consent=0,status='open' WHERE id=?",
    ).run(f.id);
    expect(
      (await dispatchNotifications(db, { now: () => instant, send }))
        .suppressed,
    ).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("respects a new block from an assigned pantry manager before emailing an opportunity", async () => {
    const f = fixture(),
      manager = actor();
    f.queue();
    db.prepare("INSERT INTO pantry_managers VALUES(?,?,?,?)").run(
      f.pantry,
      manager.id,
      f.donor.id,
      instant.toISOString(),
    );
    db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(
      manager.id,
      f.volunteer.id,
      instant.toISOString(),
    );
    const send = vi.fn<
      NonNullable<Parameters<typeof dispatchNotifications>[1]>["send"] & {}
    >();
    expect(
      (await dispatchNotifications(db, { now: () => instant, send }))
        .suppressed,
    ).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("leases each job once when workers run concurrently", async () => {
    const user = actor();
    queueNotification(
      db,
      {
        userId: user.id,
        eventKey: "password:1",
        category: "security",
        kind: "password-changed",
      },
      instant,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi
      .fn<
        NonNullable<Parameters<typeof dispatchNotifications>[1]>["send"] & {}
      >()
      .mockImplementation(async () => {
        await gate;
        return { id: "single-delivery", status: "accepted" };
      });
    const first = dispatchNotifications(db, { now: () => instant, send });
    expect(
      (await dispatchNotifications(db, { now: () => instant, send })).processed,
    ).toBe(0);
    release();
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rechecks the live session after reading a donation mutation body", async () => {
    const f = fixture();
    db.prepare("DELETE FROM volunteer_runs WHERE id=?").run(f.id);
    vi.stubEnv("REACH_COMMUNITY_ENABLED", "true");
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      pull() {
        started();
      },
    });
    const request = new Request(`${origin}/api/volunteer`, {
      method: "POST",
      headers: {
        origin,
        cookie: f.donor.cookie,
        "content-type": "application/json",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const handle = createVolunteerHandler(join(directory, "community.sqlite"));
    const pending = handle(request);
    await reading;
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(f.donor.id);
    controller.enqueue(
      new TextEncoder().encode(
        JSON.stringify({ offerId: f.offerId, pantryId: f.pantry }),
      ),
    );
    controller.close();
    expect((await pending).status).toBe(401);
    expect(db.prepare("SELECT count(*) n FROM volunteer_runs").get()!.n).toBe(
      0,
    );
  });
});
