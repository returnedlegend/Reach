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
import { accountHash } from "../src/lib/account-store";
import { createAccountHandler } from "../src/lib/account";
import { openCommunityDatabase } from "../src/lib/community";
import { deliverMail } from "../src/lib/mail-delivery";
import { dispatchNotifications } from "../src/lib/notifications-worker";

const origin = "https://reach.example";
const password = "reach-verification-password-123";
let directory: string;
let database: string;
let previewDirectory: string;
let handle: ReturnType<typeof createAccountHandler>;
let db: ReturnType<typeof openCommunityDatabase>;

async function call(route: string, data: unknown) {
  return handle(
    new Request(`${origin}/api/account/${route}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
  );
}

function previews() {
  const files = readdirSync(previewDirectory).filter((file) =>
    file.endsWith(".json"),
  );
  expect(files.length).toBeGreaterThan(0);
  return files.map(
    (file) =>
      JSON.parse(readFileSync(join(previewDirectory, file), "utf8")) as {
        to: string;
        subject: string;
        text: string;
      },
  );
}

function previewFor(subject: string) {
  const preview = previews().find((mail) => mail.subject === subject);
  expect(preview).toBeDefined();
  return preview!;
}

function token(purpose: "verify" | "reset") {
  const match = previews()
    .map((mail) => mail.text.match(new RegExp(`#${purpose}=([a-f0-9]{64})`)))
    .find(Boolean);
  expect(match).not.toBeNull();
  return match![1];
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "reach-account-mail-flow-"));
  database = join(directory, "community.sqlite");
  previewDirectory = join(directory, "private-mail-preview");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REACH_APP_ORIGIN", origin);
  vi.stubEnv("REACH_EMAIL_PROVIDER", "preview");
  vi.stubEnv("REACH_EMAIL_PREVIEW_DIR", previewDirectory);
  db = openCommunityDatabase(database);
  handle = createAccountHandler(database, {
    allowRegistration: true,
    sendMail: async (mail) => {
      await deliverMail(db, mail);
    },
  });
});

afterEach(() => {
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("account mail verification in private preview", () => {
  it("verifies and resets an account, then dispatches security notices without live delivery", async () => {
    const signup = await call("signup", {
      email: "member@example.org",
      name: "Reach Member",
      password,
      adultConfirmed: true,
    });
    expect(signup.status).toBe(202);
    expect(await signup.json()).toMatchObject({
      message:
        "If this request is eligible, a development email preview was saved locally. No email was sent.",
    });

    const verification = previewFor("Verify your Reach email");
    expect(verification.to).toBe("member@example.org");
    expect(verification.subject).toBe("Verify your Reach email");
    // Windows exposes ACLs rather than POSIX permission bits.
    if (process.platform !== "win32") {
      expect(
        statSync(join(previewDirectory, readdirSync(previewDirectory)[0]))
          .mode & 0o777,
      ).toBe(0o600);
    }
    expect(
      db
        .prepare("SELECT token_hash FROM account_tokens WHERE purpose='verify'")
        .get()?.token_hash,
    ).toBe(accountHash(token("verify")));
    expect(
      (await call("verify-email", { token: token("verify") })).status,
    ).toBe(200);
    expect(
      (await call("verify-email", { token: token("verify") })).status,
    ).toBe(400);

    const welcome = await dispatchNotifications(db);
    expect(welcome).toMatchObject({ processed: 1, preview: 1, uncertain: 0 });
    const welcomePreview = previewFor("Welcome to Reach");
    expect(welcomePreview.subject).toBe("Welcome to Reach");
    expect(welcomePreview.text).toContain("choose any optional notifications");
    expect(welcomePreview.text).not.toContain("Unsubscribe:");

    expect(
      (await call("forgot-password", { email: "member@example.org" })).status,
    ).toBe(202);
    const reset = token("reset");
    expect(
      db
        .prepare("SELECT token_hash FROM account_tokens WHERE purpose='reset'")
        .get()?.token_hash,
    ).toBe(accountHash(reset));
    const replacement = "reach-replacement-password-456";
    expect(
      (await call("reset-password", { token: reset, password: replacement }))
        .status,
    ).toBe(200);
    expect(
      (await call("reset-password", { token: reset, password: replacement }))
        .status,
    ).toBe(400);

    const security = await dispatchNotifications(db);
    expect(security).toMatchObject({ processed: 1, preview: 1, uncertain: 0 });
    expect(previewFor("Your Reach password changed").subject).toBe(
      "Your Reach password changed",
    );
    expect(
      db
        .prepare(
          "SELECT status FROM notification_outbox ORDER BY created_at DESC LIMIT 1",
        )
        .get()?.status,
    ).toBe("preview");
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM mail_deliveries WHERE provider='preview' AND status='preview'",
        )
        .get()?.count,
    ).toBe(4);
  });
});
