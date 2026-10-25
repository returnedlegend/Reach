import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { accountHash } from "../src/lib/account-store";
import {
  closeCommunityDatabases,
  openCommunityDatabase,
} from "../src/lib/community";
import {
  closeSharingDatabases,
  getSharingAdmin,
  getSharingPhoto,
  getSharingTestId,
  postSharingReview,
  postSharingSubmission,
} from "../src/lib/sharing";
import sharp from "sharp";
let dir: string, path: string, moderator: string, regular: string;
function session(role: "moderator" | "resident") {
  const db = openCommunityDatabase(path),
    id = randomUUID(),
    token = randomBytes(32).toString("hex"),
    now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,pantry_role) VALUES(?,?, '', '', ?,1,?,'user')",
  ).run(id, `user_${id.replaceAll("-", "").slice(0, 20)}`, role, now);
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    accountHash(token),
    id,
    new Date(Date.now() + 3600000).toISOString(),
  );
  return `reach_community_session=${token}`;
}
function offer() {
  const start = new Date(Date.now() + 3600000),
    end = new Date(Date.now() + 7200000);
  return {
    title: "Sealed pantry box",
    description: "Shelf stable food",
    pickupAreaId: "bryan",
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    quantity: 2,
    allergens: "Wheat",
    storage: "Cool dry place",
    useBy: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    foodCategory: "canned-groceries",
    labelsIntact: true,
    noExcludedProducts: true,
    sealed: true,
    shelfStable: true,
    notHomemade: true,
    packagingUndamaged: true,
    notRecalled: true,
    privatePickupInstructions: "Use the side entrance at 12 Private St",
    pickupIsPublicPlace: true,
    sharePickupInstructions: false,
  };
}
function submission(
  key = randomUUID(),
  overrides: Record<string, unknown> = {},
) {
  return {
    requestKey: key,
    kind: "offer",
    contactName: "Jamie",
    contactEmail: "jamie@example.test",
    publicContact: { kind: "email", value: "help@example.test" },
    adultConfirmed: true,
    permissionConfirmed: true,
    publicContactConsent: true,
    policyAccepted: true,
    data: offer(),
    ...overrides,
  };
}
function req(cookie?: string) {
  return new Request("https://reach.example/api/sharing/admin", {
    headers: cookie ? { cookie } : {},
  });
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REACH_RELEASE_PROFILE", "extended");
  vi.stubEnv("REACH_ACCOUNT_ENABLED", "true");
  vi.stubEnv("REACH_COMMUNITY_ENABLED", "true");
  dir = mkdtempSync(join(tmpdir(), "reach-sharing-"));
  path = join(dir, "community.sqlite");
  vi.stubEnv("REACH_COMMUNITY_DB", path);
  vi.stubEnv("REACH_SHARING_DB", path);
  openCommunityDatabase(path);
  moderator = session("moderator");
  regular = session("resident");
});
afterEach(() => {
  closeSharingDatabases();
  closeCommunityDatabases();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
describe("account-free sharing moderation", () => {
  it("accepts and approves seven-day pickups but rejects longer windows", async () => {
    const data = offer();
    data.endsAt = new Date(
      Date.parse(data.startsAt) + 7 * 86400000,
    ).toISOString();
    data.useBy = new Date(Date.now() + 10 * 86400000)
      .toISOString()
      .slice(0, 10);
    const send = (value: unknown) =>
      postSharingSubmission(
        new Request("https://reach.example/api/sharing/submissions", {
          method: "POST",
          headers: {
            origin: "https://reach.example",
            "content-type": "application/json",
          },
          body: JSON.stringify(submission(randomUUID(), { data: value })),
        }),
      );
    const response = await send(data);
    expect(response.status).toBe(201);
    const id = (await response.json()).submission.id;
    const review = await postSharingReview(
      new Request("https://reach.example/api/sharing/admin", {
        method: "POST",
        headers: {
          origin: "https://reach.example",
          "content-type": "application/json",
          cookie: moderator,
        },
        body: JSON.stringify({ action: "approve" }),
      }),
      id,
    );
    expect(review.status).toBe(200);
    expect(
      (
        await send({
          ...data,
          endsAt: new Date(Date.parse(data.endsAt) + 1).toISOString(),
        })
      ).status,
    ).toBe(400);
    expect((await send({ ...data, useBy: "2020-01-01" })).status).toBe(400);
  });

  it("accepts the actual local host despite stale config but rejects cross-origin submissions", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REACH_APP_ORIGIN", "https://old-reach.example");
    const send = (origin: string, host = "localhost:3000") =>
      postSharingSubmission(
        new Request("http://127.0.0.1:3000/api/sharing/submissions", {
          method: "POST",
          headers: { host, origin, "content-type": "application/json" },
          body: JSON.stringify(submission()),
        }),
      );
    expect((await send("http://localhost:3000")).status).toBe(201);
    expect((await send("http://127.0.0.1:3000", "127.0.0.1:3000")).status).toBe(
      201,
    );
    expect((await send("http://localhost:3001")).status).toBe(403);
    expect((await send("https://evil.example")).status).toBe(403);
    expect((await send("http://127.0.0.1:3000")).status).toBe(403);
    vi.stubEnv("NODE_ENV", "production");
    expect((await send("http://localhost:3000")).status).toBe(403);
  });

  it("requires separate consent and privately expires or deletes developer test images", async () => {
    const png = `data:image/png;base64,${(
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
      })
        .png()
        .toBuffer()
    ).toString("base64")}`;
    const send = (value: unknown) =>
      postSharingSubmission(
        new Request("https://reach.example/api/sharing/submissions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://reach.example",
          },
          body: JSON.stringify(value),
        }),
      );
    expect((await send(submission(randomUUID(), { testId: png }))).status).toBe(
      400,
    );
    const created = await send(
      submission(randomUUID(), { testId: png, testIdConsent: true }),
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).submission.id as string;
    expect((await getSharingTestId(req(), id)).status).toBe(401);
    expect((await getSharingTestId(req(regular), id)).status).toBe(403);
    const privateImage = await getSharingTestId(req(moderator), id);
    expect(privateImage.status).toBe(200);
    expect(privateImage.headers.get("cache-control")).toBe("private, no-store");
    const db = openCommunityDatabase(path);
    const metadata = db
      .prepare(
        "SELECT test_id,test_id_expires_at,test_id_consent_version,test_id_consented_at FROM sharing_submissions WHERE id=?",
      )
      .get(id) as {
      test_id: Uint8Array;
      test_id_expires_at: string;
      test_id_consent_version: string;
      test_id_consented_at: string;
    };
    expect(metadata.test_id_consent_version).toBe("optional-test-id-v1");
    expect(metadata.test_id_consented_at).toMatch(/^\d{4}-/);
    expect(Date.parse(metadata.test_id_expires_at)).toBeGreaterThan(Date.now());
    db.prepare(
      "UPDATE sharing_submissions SET test_id_expires_at=? WHERE id=?",
    ).run(new Date(Date.now() - 1000).toISOString(), id);
    expect((await getSharingTestId(req(moderator), id)).status).toBe(404);
    expect(
      (
        db
          .prepare("SELECT test_id FROM sharing_submissions WHERE id=?")
          .get(id) as { test_id: Uint8Array | null }
      ).test_id,
    ).toBeNull();
    db.prepare(
      "UPDATE sharing_submissions SET test_id_expires_at=? WHERE id=?",
    ).run(new Date(Date.now() + 60000).toISOString(), id);
    await postSharingReview(
      new Request("https://reach.example/api/sharing/admin", {
        method: "POST",
        headers: {
          cookie: moderator,
          "content-type": "application/json",
          origin: "https://reach.example",
        },
        body: JSON.stringify({ action: "approve" }),
      }),
      id,
    );
    expect(
      (
        db
          .prepare("SELECT test_id FROM sharing_submissions WHERE id=?")
          .get(id) as { test_id: Uint8Array | null }
      ).test_id,
    ).toBeNull();
    expect(
      Number(db.prepare("SELECT count(*) AS n FROM photos").get()?.n),
    ).toBe(0);
  });
  it("requires the explicit consents and applies per-contact daily limits", async () => {
    const missing = await postSharingSubmission(
      new Request("https://reach.example/api/sharing/submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://reach.example",
        },
        body: JSON.stringify(
          submission(randomUUID(), { permissionConfirmed: false }),
        ),
      }),
    );
    expect(missing.status).toBe(400);
    for (let i = 0; i < 3; i++)
      expect(
        (
          await postSharingSubmission(
            new Request("https://reach.example/api/sharing/submissions", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: "https://reach.example",
              },
              body: JSON.stringify(submission()),
            }),
          )
        ).status,
      ).toBe(201);
    expect(
      (
        await postSharingSubmission(
          new Request("https://reach.example/api/sharing/submissions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "https://reach.example",
            },
            body: JSON.stringify(submission()),
          }),
        )
      ).status,
    ).toBe(429);
  });
  it("reuses identical request keys and records which consent text was accepted", async () => {
    const value = submission(),
      send = () =>
        postSharingSubmission(
          new Request("https://reach.example/api/sharing/submissions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "https://reach.example",
            },
            body: JSON.stringify(value),
          }),
        );
    const first = await send(),
      again = await send();
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect((await again.json()).reused).toBe(true);
    const row = openCommunityDatabase(path)
      .prepare("SELECT consent_version,consented_at FROM sharing_submissions")
      .get() as { consent_version: string; consented_at: string };
    expect(row.consent_version).toBe("food-sharing-v1");
    expect(row.consented_at).toMatch(/^\d{4}-/);
  });
  it("keeps review and photos private, and publishes only after a real moderator approves", async () => {
    const created = await postSharingSubmission(
      new Request("https://reach.example/api/sharing/submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://reach.example",
        },
        body: JSON.stringify(submission()),
      }),
    );
    const id = (await created.json()).submission.id as string;
    expect((await getSharingAdmin(req())).status).toBe(401);
    expect((await getSharingAdmin(req(regular))).status).toBe(403);
    expect((await getSharingPhoto(req(regular), id)).status).toBe(403);
    const denied = await postSharingReview(
      new Request("https://reach.example/api/sharing/admin", {
        method: "POST",
        headers: {
          cookie: regular,
          "content-type": "application/json",
          origin: "https://reach.example",
        },
        body: JSON.stringify({ action: "approve" }),
      }),
      id,
    );
    expect(denied.status).toBe(403);
    const approved = await postSharingReview(
      new Request("https://reach.example/api/sharing/admin", {
        method: "POST",
        headers: {
          cookie: moderator,
          "content-type": "application/json",
          origin: "https://reach.example",
        },
        body: JSON.stringify({ action: "approve" }),
      }),
      id,
    );
    expect(approved.status).toBe(200);
    const db = openCommunityDatabase(path),
      record = db
        .prepare(
          "SELECT * FROM records WHERE id=(SELECT record_id FROM sharing_submissions WHERE id=?)",
        )
        .get(id) as { data: string };
    const data = JSON.parse(record.data);
    expect(data.privatePickupInstructions).toBe(
      "Use the side entrance at 12 Private St",
    );
    expect(data.publicContact).toBeUndefined();
    expect(data.description).not.toContain("jamie@example.test");
    expect(
      db
        .prepare("SELECT contact_email FROM sharing_submissions WHERE id=?")
        .get(id)?.contact_email,
    ).toBe("jamie@example.test");
  });
});

it("rejects cross-origin, oversized, and mismatched duplicate submissions while ignoring the legacy disabled flag", async () => {
  const value = submission();
  const send = (payload: unknown, origin = "https://reach.example") =>
    postSharingSubmission(
      new Request("https://reach.example/api/sharing/submissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(payload),
      }),
    );
  expect((await send(value, "https://evil.example")).status).toBe(403);
  expect((await send({ ...value, photo: "x".repeat(6_000_001) })).status).toBe(
    413,
  );
  expect((await send(value)).status).toBe(201);
  expect((await send({ ...value, contactName: "Changed" })).status).toBe(409);
  expect(
    openCommunityDatabase(path)
      .prepare("SELECT count(*) AS n FROM sharing_alert_outbox")
      .get()?.n,
  ).toBe(1);
  vi.stubEnv("REACH_COMMUNITY_ENABLED", "false");
  expect((await send(submission())).status).toBe(201);
});

it("publishes a hotspot once, exposes only consented contact, and supports rejection", async () => {
  const data = {
    title: "Synthetic pickup",
    description: "Fixture only",
    organizerName: "Public organizer",
    address: "Public venue",
    lat: 30.67,
    lng: -96.37,
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    endsAt: new Date(Date.now() + 7200000).toISOString(),
    foodCategory: "Groceries",
    eligibility: "Unknown",
    accessibility: "Unknown",
    contact: "Public",
    pickupInstructions: "Ask at desk",
  };
  const post = async (payload: unknown) =>
    postSharingSubmission(
      new Request("https://reach.example/api/sharing/submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://reach.example",
        },
        body: JSON.stringify(payload),
      }),
    );
  const response = await post(
    submission(randomUUID(), { kind: "hotspot", data }),
  );
  const payload = await response.json();
  expect(JSON.stringify(payload)).not.toContain("jamie@example.test");
  const review = (id: string, action: string) =>
    postSharingReview(
      new Request("https://reach.example/api/sharing/admin", {
        method: "POST",
        headers: {
          cookie: moderator,
          "content-type": "application/json",
          origin: "https://reach.example",
        },
        body: JSON.stringify({ action }),
      }),
      id,
    );
  expect((await review(payload.submission.id, "approve")).status).toBe(200);
  expect((await review(payload.submission.id, "approve")).status).toBe(409);
  const { createCommunityHandler } = await import("../src/lib/community");
  const visible = await createCommunityHandler(path)(
    new Request("https://reach.example/api/community/discovery"),
    ["discovery"],
  );
  const publicData = await visible.json();
  expect(publicData.hotspots[0].contact).toBe("Email: help@example.test");
  expect(JSON.stringify(publicData)).not.toContain("jamie@example.test");
  expect(JSON.stringify(publicData)).not.toContain("Jamie");
  const second = await (await post(submission())).json();
  expect((await review(second.submission.id, "reject")).status).toBe(200);
  expect((await review(second.submission.id, "approve")).status).toBe(409);
});

it("refuses expired approval and closes public username registration", async () => {
  const response = await postSharingSubmission(
    new Request("https://reach.example/api/sharing/submissions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://reach.example",
      },
      body: JSON.stringify(submission()),
    }),
  );
  const id = (await response.json()).submission.id;
  const db = openCommunityDatabase(path);
  const data = JSON.parse(
    String(
      db.prepare("SELECT data FROM sharing_submissions WHERE id=?").get(id)
        ?.data,
    ),
  );
  data.endsAt = new Date(Date.now() - 1000).toISOString();
  db.prepare("UPDATE sharing_submissions SET data=? WHERE id=?").run(
    JSON.stringify(data),
    id,
  );
  const result = await postSharingReview(
    new Request("https://reach.example/api/sharing/admin", {
      method: "POST",
      headers: {
        cookie: moderator,
        "content-type": "application/json",
        origin: "https://reach.example",
      },
      body: JSON.stringify({ action: "approve" }),
    }),
    id,
  );
  expect(result.status).toBe(409);
  expect(db.prepare("SELECT count(*) AS n FROM records").get()?.n).toBe(0);
  const { createCommunityHandler } = await import("../src/lib/community");
  const signup = await createCommunityHandler(path)(
    new Request("https://reach.example/api/community/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://reach.example",
      },
      body: JSON.stringify({
        username: "newperson",
        password: "valid-password-123!",
        adultConfirmed: true,
      }),
    }),
    ["auth", "signup"],
  );
  expect(signup.status).toBe(403);
});

it("rejects a phone contact containing no usable number", async () => {
  const result = await postSharingSubmission(
    new Request("https://reach.example/api/sharing/submissions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://reach.example",
      },
      body: JSON.stringify(
        submission(randomUUID(), {
          publicContact: { kind: "phone", value: "........" },
        }),
      ),
    }),
  );
  expect(result.status).toBe(400);
});
