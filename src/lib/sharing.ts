import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { getAccountActor } from "./account-store";
import {
  openCommunityDatabase,
  communityRequestOrigin,
  hotspotSchema,
  offerSchema,
} from "./community";
import { sanitizeCommunityPhoto } from "./community-photo";
import { isDate } from "./time";
import { initializeSharingAlerts, queueSharingAlert } from "./sharing-alerts";
import { featureEnabled } from "./release-features";
import { emailDeliveryMode } from "./mail-delivery";
export { dispatchSharingAlerts } from "./sharing-alerts-worker";

export function closeSharingDatabases() {
  /* sharing records use the community database connection */
}
type Row = Record<string, string | number | Uint8Array | null>;
const inputSchema = z
  .object({
    requestKey: z.string().uuid(),
    kind: z.enum(["hotspot", "offer"]),
    contactName: z.string().trim().min(1).max(100),
    contactEmail: z.string().trim().email().max(254),
    publicContact: z
      .object({
        kind: z.enum(["email", "phone"]),
        value: z.string().trim().min(3).max(200),
      })
      .strict(),
    adultConfirmed: z.literal(true),
    permissionConfirmed: z.literal(true),
    publicContactConsent: z.literal(true),
    policyAccepted: z.literal(true),
    data: z.record(z.string(), z.unknown()),
    photo: z.string().max(2_800_000).optional(),
    testId: z.string().max(2_800_000).optional(),
    testIdConsent: z.literal(true).optional(),
  })
  .strict();
const reviewSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
// Version covers adult confirmation, authority to share, explicit public-contact consent, and the food-sharing policy acceptance.
const CONSENT_VERSION = "food-sharing-v1";
function dbFor() {
  const db = openCommunityDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS sharing_submissions(id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('hotspot','offer')),contact_name TEXT NOT NULL,contact_email TEXT NOT NULL,public_contact TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),photo BLOB,photo_mime TEXT,submitted_at TEXT NOT NULL,reviewed_at TEXT,reviewer_id TEXT,reason TEXT,record_id TEXT);
    CREATE INDEX IF NOT EXISTS sharing_contact_day ON sharing_submissions(contact_email,submitted_at);
    CREATE INDEX IF NOT EXISTS sharing_status_date ON sharing_submissions(status,submitted_at);`);
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(sharing_submissions)").all() as {
        name: string;
      }[]
    ).map((c) => c.name),
  );
  if (!columns.has("consent_version"))
    db.exec(
      "ALTER TABLE sharing_submissions ADD COLUMN consent_version TEXT NOT NULL DEFAULT 'food-sharing-v1'",
    );
  if (!columns.has("consented_at"))
    db.exec(
      "ALTER TABLE sharing_submissions ADD COLUMN consented_at TEXT NOT NULL DEFAULT ''",
    );
  if (!columns.has("test_id"))
    db.exec("ALTER TABLE sharing_submissions ADD COLUMN test_id BLOB");
  if (!columns.has("test_id_mime"))
    db.exec("ALTER TABLE sharing_submissions ADD COLUMN test_id_mime TEXT");
  if (!columns.has("test_id_expires_at"))
    db.exec(
      "ALTER TABLE sharing_submissions ADD COLUMN test_id_expires_at TEXT",
    );
  if (!columns.has("test_id_consent_version"))
    db.exec(
      "ALTER TABLE sharing_submissions ADD COLUMN test_id_consent_version TEXT",
    );
  if (!columns.has("test_id_consented_at"))
    db.exec(
      "ALTER TABLE sharing_submissions ADD COLUMN test_id_consented_at TEXT",
    );
  db.exec(
    "UPDATE sharing_submissions SET test_id=NULL,test_id_mime=NULL WHERE test_id_expires_at IS NOT NULL AND datetime(test_id_expires_at)<=datetime('now')",
  );
  return db;
}
function hash(v: string) {
  return createHash("sha256").update(v).digest("hex");
}
function get(db: DatabaseSync, sql: string, ...args: (string | number)[]) {
  return db.prepare(sql).get(...args) as Row | undefined;
}
function all(db: DatabaseSync, sql: string, ...args: (string | number)[]) {
  return db.prepare(sql).all(...args) as Row[];
}
function json(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
function dayStart() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
function validatedData(
  kind: "hotspot" | "offer",
  raw: Record<string, unknown>,
) {
  const parsed = (kind === "hotspot" ? hotspotSchema : offerSchema).safeParse(
    raw,
  );
  if (!parsed.success)
    throw Object.assign(new Error("Submission details are invalid."), {
      status: 400,
    });
  const data = parsed.data as Record<string, unknown>,
    start = Date.parse(String(data.startsAt)),
    end = Date.parse(String(data.endsAt));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= Date.now() ||
    end <= Date.now() ||
    end <= start ||
    end - start > 86400000
  )
    throw Object.assign(
      new Error("Choose a future pickup window lasting at most 24 hours."),
      { status: 400 },
    );
  if (start > Date.now() + 30 * 86400000)
    throw Object.assign(new Error("Choose a pickup window within 30 days."), {
      status: 400,
    });
  if (data.useBy) {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(end));
    if (!isDate(String(data.useBy)) || day > data.useBy)
      throw Object.assign(
        new Error("Food must remain within its use-by date throughout pickup."),
        { status: 400 },
      );
  }
  return data;
}
function approvedData(kind: "hotspot" | "offer", raw: Record<string, unknown>) {
  const parsed = (kind === "hotspot" ? hotspotSchema : offerSchema).safeParse(
    raw,
  );
  if (!parsed.success)
    throw Object.assign(new Error("Submission details are invalid."), {
      status: 400,
    });
  const data = parsed.data as Record<string, unknown>,
    start = Date.parse(String(data.startsAt)),
    end = Date.parse(String(data.endsAt));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= Date.now() ||
    end <= start ||
    end - start > 86400000
  )
    throw Object.assign(new Error("Pickup window has ended or is invalid."), {
      status: 409,
    });
  if (data.useBy) {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(end));
    if (!isDate(String(data.useBy)) || day > String(data.useBy))
      throw Object.assign(
        new Error("Food is past its use-by date for pickup."),
        { status: 409 },
      );
  }
  return data;
}
async function readJson(req: Request) {
  if (req.headers.get("origin") !== communityRequestOrigin(req))
    throw Object.assign(new Error("A same-origin request is required."), {
      status: 403,
    });
  if (
    req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw Object.assign(new Error("Send application/json."), { status: 415 });
  const reader = req.body?.getReader();
  if (!reader)
    throw Object.assign(new Error("A JSON body is required."), { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 6_000_000) {
      await reader.cancel();
      throw Object.assign(new Error("Submission is too large."), {
        status: 413,
      });
    }
    chunks.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  }
}
function moderator(req: Request) {
  if (!featureEnabled("community"))
    throw Object.assign(new Error("Community submissions are unavailable."), {
      status: 404,
    });
  const db = openCommunityDatabase();
  const actor = getAccountActor(db, req);
  if (!actor)
    throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  const user = get(db, "SELECT role FROM users WHERE id=?", actor.id);
  if (user?.role !== "moderator")
    throw Object.assign(new Error("Moderator access required."), {
      status: 403,
    });
  return { db, actor };
}
function serialize(row: Row) {
  return {
    id: String(row.id),
    kind: row.kind,
    status: row.status,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    publicContact: JSON.parse(String(row.public_contact)),
    data: JSON.parse(String(row.data)),
    ...(row.photo ? { photoUrl: `/api/sharing/admin/${row.id}/photo` } : {}),
    hasTestId: Boolean(row.test_id),
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reason: row.reason,
    recordId: row.record_id,
  };
}
export async function postSharingSubmission(req: Request) {
  try {
    if (!featureEnabled("community"))
      return json(404, { error: "Community submissions are unavailable." });
    const parsed = inputSchema.safeParse(await readJson(req));
    if (!parsed.success)
      return json(400, {
        error: "Submission details or required consents are invalid.",
      });
    const body = parsed.data,
      data = validatedData(body.kind, body.data);
    if (body.testId && body.testIdConsent !== true)
      return json(400, { error: "Separate test ID consent is required." });
    if (!body.testId && body.testIdConsent)
      return json(400, { error: "Test ID consent requires a selected image." });
    if (
      body.publicContact.kind === "email" &&
      !z.string().email().safeParse(body.publicContact.value).success
    )
      return json(400, { error: "Enter a valid public email address." });
    if (
      body.publicContact.kind === "phone" &&
      (!/^[+()0-9 .-]{7,30}$/.test(body.publicContact.value) ||
        !/^\d{7,15}$/.test(body.publicContact.value.replace(/\D/g, "")))
    )
      return json(400, { error: "Enter a valid public phone number." });
    let photo: Awaited<ReturnType<typeof sanitizeCommunityPhoto>> | null = null;
    let testId: Awaited<ReturnType<typeof sanitizeCommunityPhoto>> | null =
      null;
    if (body.photo) {
      try {
        photo = await sanitizeCommunityPhoto(body.photo);
      } catch {
        return json(400, {
          error:
            "Choose a readable JPEG, PNG or WebP under 2 MB and 8 megapixels.",
        });
      }
    }
    if (body.testId) {
      try {
        testId = await sanitizeCommunityPhoto(body.testId);
      } catch {
        return json(400, {
          error: "Choose a readable JPEG, PNG or WebP under 2 MB.",
        });
      }
    }
    const canonical = JSON.stringify({
      kind: body.kind,
      contactName: body.contactName,
      contactEmail: body.contactEmail.toLowerCase(),
      publicContact: body.publicContact,
      data,
      photo: photo ? hash(Buffer.from(photo.bytes).toString("base64")) : null,
      testId: testId
        ? hash(Buffer.from(testId.bytes).toString("base64"))
        : null,
    });
    const fingerprint = hash(canonical),
      db = dbFor();
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = get(
        db,
        "SELECT * FROM sharing_submissions WHERE request_key=?",
        body.requestKey,
      );
      if (prior) {
        db.exec("COMMIT");
        return prior.fingerprint === fingerprint
          ? json(200, {
              submission: { id: String(prior.id), status: prior.status },
              reused: true,
            })
          : json(409, {
              error:
                "That request key was already used for different submission details.",
            });
      }
      const email = body.contactEmail.toLowerCase(),
        day = dayStart();
      if (
        Number(
          get(
            db,
            "SELECT count(*) AS n FROM sharing_submissions WHERE contact_email=? AND submitted_at>=?",
            email,
            day,
          )?.n || 0,
        ) >= 3 ||
        Number(
          get(
            db,
            "SELECT count(*) AS n FROM sharing_submissions WHERE submitted_at>=?",
            day,
          )?.n || 0,
        ) >= 50
      ) {
        db.exec("COMMIT");
        return json(429, { error: "Daily submission limit reached." });
      }
      const id = randomUUID(),
        at = new Date().toISOString();
      db.prepare(
        "INSERT INTO sharing_submissions(id,request_key,fingerprint,kind,contact_name,contact_email,public_contact,data,status,photo,photo_mime,submitted_at,consent_version,consented_at,test_id,test_id_mime,test_id_expires_at,test_id_consent_version,test_id_consented_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        body.requestKey,
        fingerprint,
        body.kind,
        body.contactName,
        email,
        JSON.stringify(body.publicContact),
        JSON.stringify(data),
        photo ? Buffer.from(photo.bytes) : null,
        photo?.mime || null,
        at,
        CONSENT_VERSION,
        at,
        testId ? Buffer.from(testId.bytes) : null,
        testId?.mime || null,
        testId ? new Date(Date.now() + 86400000).toISOString() : null,
        testId ? "optional-test-id-v1" : null,
        testId ? at : null,
      );
      queueSharingAlert(db, id, "submission");
      db.exec("COMMIT");
      return json(201, { submission: { id, status: "pending" } });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    const x = e as Error & { status?: number };
    return json(x.status || 500, {
      error: x.status
        ? x.message
        : "Could not save submission. Please try again.",
    });
  }
}
export function getSharingAdmin(req: Request) {
  try {
    moderator(req);
    const db = dbFor();
    initializeSharingAlerts(db);
    const rows = all(
        db,
        "SELECT id,kind,status,contact_name,contact_email,public_contact,data,CASE WHEN photo IS NULL THEN NULL ELSE 1 END AS photo,CASE WHEN test_id IS NULL OR test_id_expires_at<=? THEN NULL ELSE 1 END AS test_id,submitted_at,reviewed_at,reason,record_id FROM sharing_submissions ORDER BY (status='pending') DESC,submitted_at DESC LIMIT 200",
        new Date().toISOString(),
      ),
      pending = Number(
        get(
          db,
          "SELECT count(*) AS n FROM sharing_alert_outbox WHERE status='queued'",
        )?.n || 0,
      );
    return json(200, {
      submissions: rows.map(serialize),
      notification: { mode: emailDeliveryMode(), pending },
    });
  } catch (e) {
    const x = e as Error & { status?: number };
    return json(x.status || 500, {
      error: x.status
        ? x.message
        : "The review service is temporarily unavailable.",
    });
  }
}
export function getSharingPhoto(req: Request, id: string) {
  try {
    moderator(req);
    const row = get(
      dbFor(),
      "SELECT photo,photo_mime FROM sharing_submissions WHERE id=?",
      id,
    );
    if (!row?.photo) return json(404, { error: "Photo not found." });
    return new Response(Buffer.from(row.photo as Uint8Array), {
      headers: {
        "content-type": String(row.photo_mime),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    const x = e as Error & { status?: number };
    return json(x.status || 500, {
      error: x.status
        ? x.message
        : "The review service is temporarily unavailable.",
    });
  }
}
export function getSharingTestId(req: Request, id: string) {
  try {
    moderator(req);
    const row = get(
      dbFor(),
      "SELECT test_id,test_id_mime,test_id_expires_at,status FROM sharing_submissions WHERE id=?",
      id,
    );
    if (
      !row?.test_id ||
      row.status !== "pending" ||
      !row.test_id_expires_at ||
      !Number.isFinite(Date.parse(String(row.test_id_expires_at))) ||
      Date.parse(String(row.test_id_expires_at)) <= Date.now()
    )
      return json(404, { error: "Test ID is unavailable or expired." });
    return new Response(Buffer.from(row.test_id as Uint8Array), {
      headers: {
        "content-type": String(row.test_id_mime),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    const x = e as Error & { status?: number };
    return json(x.status || 500, {
      error: x.status
        ? x.message
        : "The review service is temporarily unavailable.",
    });
  }
}
export async function postSharingReview(req: Request, id: string) {
  try {
    const { db, actor } = moderator(req),
      parsed = reviewSchema.safeParse(await readJson(req));
    if (!parsed.success)
      return json(400, { error: "Review action is invalid." });
    dbFor();
    const review = parsed.data,
      row = get(db, "SELECT * FROM sharing_submissions WHERE id=?", id);
    if (!row) return json(404, { error: "Submission not found." });
    if (row.status !== "pending")
      return json(409, { error: "Submission has already been reviewed." });
    const at = new Date().toISOString();
    let recordId: string | null = null;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (
        get(
          db,
          "SELECT id FROM users WHERE id=? AND role='moderator'",
          actor.id,
        ) == null
      ) {
        db.exec("ROLLBACK");
        return json(403, { error: "Moderator access required." });
      }
      if (
        get(
          db,
          "SELECT id FROM sharing_submissions WHERE id=? AND status='pending'",
          id,
        ) == null
      ) {
        db.exec("ROLLBACK");
        return json(409, { error: "Submission has already been reviewed." });
      }
      if (review.action === "approve") {
        const data = approvedData(
            String(row.kind) as "hotspot" | "offer",
            JSON.parse(String(row.data)),
          ),
          pub = JSON.parse(String(row.public_contact)) as {
            kind: string;
            value: string;
          };
        const publicValue = `${pub.kind === "email" ? "Email" : "Phone"}: ${pub.value}`;
        if (row.kind === "hotspot") data.contact = publicValue;
        // Offer contacts are joined into the public response from this private table.
        const ownerId = `sharing:${id}`;
        recordId = randomUUID();
        db.prepare(
          "INSERT OR IGNORE INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at,name,pantry_role,preferences,password_version) VALUES(?,?, '', '', 'organizer',1,?,?,'user','{}',0)",
        ).run(
          ownerId,
          `sharing_${String(id).replaceAll("-", "").slice(0, 20)}`,
          at,
          "Community food submitter",
        );
        db.prepare(
          "INSERT INTO records VALUES(?,?,?,'approved',?,?,?,?,?,NULL)",
        ).run(
          recordId,
          String(row.kind),
          ownerId,
          JSON.stringify(data),
          String(data.startsAt),
          String(data.endsAt),
          at,
          at,
        );
        if (row.photo)
          db.prepare(
            "INSERT INTO photos(record_id,bytes,mime) VALUES(?,?,?)",
          ).run(recordId, row.photo, row.photo_mime);
      }
      db.prepare(
        "UPDATE sharing_submissions SET status=?,reviewed_at=?,reviewer_id=?,reason=?,record_id=?,test_id=NULL,test_id_mime=NULL WHERE id=?",
      ).run(
        review.action === "approve" ? "approved" : "rejected",
        at,
        actor.id,
        review.reason || null,
        recordId,
        id,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return json(200, {
      submission: {
        id,
        status: review.action === "approve" ? "approved" : "rejected",
        recordId,
      },
    });
  } catch (e) {
    const x = e as Error & { status?: number };
    return json(x.status || 500, {
      error: x.status
        ? x.message
        : "The review service is temporarily unavailable.",
    });
  }
}
