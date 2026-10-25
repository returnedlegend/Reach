import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeSharingAlerts,
  queueSharingAlert,
} from "../src/lib/sharing-alerts";
import { dispatchSharingAlerts } from "../src/lib/sharing-alerts-worker";
import { MailDeliveryError } from "../src/lib/mail-delivery";
import type { deliverMail } from "../src/lib/mail-delivery";

const BASE = new Date();
type Send = NonNullable<
  NonNullable<Parameters<typeof dispatchSharingAlerts>[1]>["send"]
>;

function fixture() {
  const db = new DatabaseSync(":memory:");
  initializeSharingAlerts(db);
  queueSharingAlert(db, "submission-1", "submission");
  db.prepare("UPDATE sharing_alert_outbox SET available_at=?").run(
    BASE.toISOString(),
  );
  return db;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REACH_EMAIL_PROVIDER", "preview");
  vi.stubEnv("REACH_APP_ORIGIN", "https://reach.example.org");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sharing submission alerts", () => {
  it("queues one alert per submission and sends generic mail to the fixed support address", async () => {
    const db = fixture();
    try {
      queueSharingAlert(db, "submission-1", "submission");
      queueSharingAlert(db, "submission-2", "submission");
      db.prepare(
        "UPDATE sharing_alert_outbox SET available_at=? WHERE submission_id='submission-2'",
      ).run(BASE.toISOString());
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM sharing_alert_outbox").get()
          ?.count,
      ).toBe(2);
      const send = vi
        .fn<Send>()
        .mockResolvedValue({ id: "mail-1", status: "accepted" });
      const result = await dispatchSharingAlerts(db, { now: () => BASE, send });
      expect(result.accepted).toBe(2);
      expect(send).toHaveBeenCalledTimes(2);
      const mail = send.mock.calls.map((call) => call[1]).find((mail) => mail.text.includes("request=submission-1"))!;
      expect(mail).toBeDefined();
      expect(mail.to).toBe("reachpantrysupport@gmail.com");
      expect(mail.kind).toBe("sharing_alert");
      expect(mail.text).toContain("sharing submission");
      expect(mail.text).toContain(
        "https://reach.example.org/admin?request=submission-1",
      );
      expect(mail.text).not.toMatch(/contact|photo|email address|@example/i);
      expect(
        db
          .prepare(
            "SELECT status FROM sharing_alert_outbox WHERE submission_id='submission-1'",
          )
          .get()?.status,
      ).toBe("accepted");
    } finally {
      db.close();
    }
  });

  it("keeps preview distinct from acceptance", async () => {
    const db = fixture();
    try {
      const send = vi
        .fn<Send>()
        .mockResolvedValue({ id: "preview-1", status: "preview" });
      const result = await dispatchSharingAlerts(db, { now: () => BASE, send });
      expect(result.preview).toBe(1);
      expect(
        db.prepare("SELECT status FROM sharing_alert_outbox").get()?.status,
      ).toBe("preview");
      expect(
        (await dispatchSharingAlerts(db, { now: () => BASE, send })).processed,
      ).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("retries only a definitive retryable failure and never resends an uncertain attempt", async () => {
    const db = fixture();
    try {
      const fail = vi
        .fn<Send>()
        .mockRejectedValue(new MailDeliveryError("temporary", true, 1000));
      const first = await dispatchSharingAlerts(db, {
        now: () => BASE,
        send: fail,
      });
      expect(first.retried).toBe(1);
      expect(
        db.prepare("SELECT status FROM sharing_alert_outbox").get()?.status,
      ).toBe("queued");
      const retry = vi
        .fn<Send>()
        .mockResolvedValue({ id: "mail-2", status: "accepted" });
      expect(
        (
          await dispatchSharingAlerts(db, {
            now: () => new Date(+BASE + 2000),
            send: retry,
          })
        ).accepted,
      ).toBe(1);

      queueSharingAlert(db, "submission-2", "submission");
      const ambiguous = vi
        .fn<Send>()
        .mockRejectedValue(new Error("connection lost after send"));
      expect(
        (
          await dispatchSharingAlerts(db, {
            now: () => new Date(+BASE + 3000),
            send: ambiguous,
          })
        ).uncertain,
      ).toBe(1);
      const later = vi
        .fn<Send>()
        .mockResolvedValue({ id: "mail-3", status: "accepted" });
      expect(
        (
          await dispatchSharingAlerts(db, {
            now: () => new Date(+BASE + 4000),
            send: later,
          })
        ).processed,
      ).toBe(0);
      expect(later).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("marks a stale in-flight claim uncertain instead of resending it", async () => {
    const db = fixture();
    try {
      db.prepare(
        "UPDATE sharing_alert_outbox SET status='sending',updated_at=?",
      ).run(new Date(+BASE - 180000).toISOString());
      const send = vi
        .fn<Send>()
        .mockResolvedValue({ id: "mail-1", status: "accepted" });
      const result = await dispatchSharingAlerts(db, { now: () => BASE, send });
      expect(result.processed).toBe(0);
      expect(
        db.prepare("SELECT status FROM sharing_alert_outbox").get()?.status,
      ).toBe("uncertain");
      expect(send).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
