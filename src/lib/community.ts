import { featureEnabled } from "./release-features";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  initializeAccountSchema,
  getAccountActor,
  accountSessionTokens,
} from "./account-store";
import {
  hashAccountPassword,
  hashAccountPasswordSync,
  verifyAccountPassword,
} from "./auth-password";
import { isDate } from "./time";
import { offerHasVolunteerRun } from "./volunteer-store";
import {
  initializeNotifications,
  queueNotification,
} from "./notifications-store";
import { sanitizeCommunityPhoto } from "./community-photo";
import {
  COMMUNITY_PICKUP_AREAS,
  type CommunityRecord,
  type CommunityUser,
} from "./community-types";

const COOKIE = "reach_community_session";
const SESSION_SECONDS = 7 * 24 * 3600;
const MAX_BODY = 8192;
const databases = new Map<string, DatabaseSync>();

/** Release cached SQLite handles before a worker exits or an isolated store is removed. */
export function closeCommunityDatabases(): void {
  for (const [filename, db] of databases) {
    if (db.isOpen) db.close();
    databases.delete(filename);
  }
}
type Row = Record<string, string | number | null>;
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}
const text = (max: number) => z.string().trim().min(1).max(max);
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
const windowFields = {
  title: text(100),
  description: text(500),
  startsAt: instant,
  endsAt: instant,
};
const hotspotSchema = z
  .object({
    ...windowFields,
    organizerName: text(100),
    address: text(200),
    lat: z.number().min(30.4).max(30.9),
    lng: z.number().min(-96.7).max(-96.1),
    foodCategory: text(100),
    quantityText: text(100).optional(),
    eligibility: text(300),
    accessibility: text(300),
    contact: text(200),
    pickupInstructions: text(500),
  })
  .strict();
const offerSchema = z
  .object({
    ...windowFields,
    pickupAreaId: z.enum(["bryan", "college-station"]),
    quantity: z.number().int().min(1).max(20),
    allergens: text(300),
    storage: text(300),
    useBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    foodCategory: z.enum([
      "canned-groceries",
      "dry-groceries",
      "sealed-snacks",
    ]),
    labelsIntact: z.literal(true),
    noExcludedProducts: z.literal(true),
    sealed: z.literal(true),
    shelfStable: z.literal(true),
    notHomemade: z.literal(true),
    packagingUndamaged: z.literal(true),
    notRecalled: z.literal(true),
    privatePickupInstructions: text(500),
    pickupIsPublicPlace: z.literal(true),
    sharePickupInstructions: z.boolean(),
  })
  .strict();
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/);
const passwordSchema = z.string().min(12).max(128);
const loginSchema = z
  .object({ username: usernameSchema, password: passwordSchema })
  .strict();
const signupSchema = loginSchema.extend({ adultConfirmed: z.literal(true) });
const emptySchema = z.object({}).strict();
const reasonSchema = z.object({ reason: text(500).optional() }).strict();
function now() {
  return new Date().toISOString();
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function openCommunityDatabase(
  path = process.env.REACH_COMMUNITY_DB || ".local/community.sqlite",
) {
  // Runtime-only persistent data: never trace the configured private database into build assets.
  const filename = resolve(/* turbopackIgnore: true */ path);
  const existing = databases.get(filename);
  if (existing?.isOpen) return existing;
  databases.delete(filename);
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  closeSync(openSync(/* turbopackIgnore: true */ filename, "a", 0o600));
  chmodSync(filename, 0o600);
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,salt TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('resident','organizer','moderator')),adult_confirmed INTEGER NOT NULL CHECK(adult_confirmed=1),created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('hotspot','offer')),owner_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('draft','pending','approved','rejected','cancelled','ended')),data TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,moderation_reason TEXT);
    CREATE TABLE IF NOT EXISTS photos(record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,bytes BLOB NOT NULL,mime TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS record_discovery ON records(kind,status,ends_at);
    CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,offer_id TEXT NOT NULL REFERENCES records(id),requester_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('requested','accepted','declined','cancelled','collected')),pickup_consent INTEGER NOT NULL CHECK(pickup_consent=1),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(offer_id,requester_id));
    CREATE UNIQUE INDEX IF NOT EXISTS one_reservation ON requests(offer_id) WHERE status='accepted';
    CREATE TABLE IF NOT EXISTS blocks(user_id TEXT NOT NULL REFERENCES users(id),blocked_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,PRIMARY KEY(user_id,blocked_id));
    CREATE TABLE IF NOT EXISTS organizer_requests(user_id TEXT PRIMARY KEY REFERENCES users(id),status TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),target_type TEXT NOT NULL,target_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL,reason TEXT);
    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);`);
  if (
    !(db.prepare("PRAGMA table_info(audit)").all() as { name: string }[]).some(
      (c) => c.name === "reason",
    )
  )
    db.exec("ALTER TABLE audit ADD COLUMN reason TEXT");
  if (
    !(
      db.prepare("PRAGMA table_info(reports)").all() as { name: string }[]
    ).some((c) => c.name === "resolved_at")
  )
    db.exec("ALTER TABLE reports ADD COLUMN resolved_at TEXT");
  initializeAccountSchema(db);
  initializeNotifications(db);
  databases.set(filename, db);
  return db;
}
function get(db: DatabaseSync, sql: string, ...params: (string | number)[]) {
  return db.prepare(sql).get(...params) as Row | undefined;
}
function all(db: DatabaseSync, sql: string, ...params: (string | number)[]) {
  return db.prepare(sql).all(...params) as Row[];
}
function audit(
  db: DatabaseSync,
  actor: string | null,
  action: string,
  target: string,
  reason: string | null = null,
) {
  db.prepare(
    "INSERT INTO audit(actor_id,action,target_id,created_at,reason) VALUES(?,?,?,?,?)",
  ).run(actor, action, target, now(), reason);
  db.exec(
    "DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 1000)",
  );
}
function rate(db: DatabaseSync, key: string, limit: number, seconds: number) {
  const at = Date.now();
  transaction(db, () => {
    db.prepare("DELETE FROM rate_limits WHERE reset_at < ?").run(at);
    const entry = get(db, "SELECT * FROM rate_limits WHERE key=?", key);
    if (entry && Number(entry.count) >= limit)
      fail(429, "Too many attempts. Try again later.");
    db.prepare(
      "INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    ).run(key, at + seconds * 1000);
  });
}
function userFrom(row: Row): CommunityUser {
  return {
    id: String(row.id),
    username: String(row.username),
    role: row.role as CommunityUser["role"],
  };
}
function currentUser(db: DatabaseSync, request: Request) {
  const actor = getAccountActor(db, request);
  if (!actor) return null;
  const row = get(db, "SELECT * FROM users WHERE id=?", actor.id);
  return row ? userFrom(row) : null;
}
function requireUser(user: CommunityUser | null): CommunityUser {
  return user || fail(401, "Sign in to continue.");
}
function requireModerator(user: CommunityUser | null) {
  const u = requireUser(user);
  if (u.role !== "moderator") fail(403, "Moderator access required.");
  return u;
}
function blocked(db: DatabaseSync, a: string, b: string) {
  return !!get(
    db,
    "SELECT 1 FROM blocks WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)",
    a,
    b,
    b,
    a,
  );
}
function notifyPickupRequest(db: DatabaseSync, id: string, status: string) {
  const row = get(
    db,
    "SELECT q.requester_id,r.owner_id FROM requests q JOIN records r ON r.id=q.offer_id WHERE q.id=?",
    id,
  );
  if (!row || blocked(db, String(row.owner_id), String(row.requester_id)))
    return;
  const kind =
    status === "collected"
      ? "pickup-completed"
      : status === "cancelled" || status === "declined"
        ? "pickup-cancelled"
        : status === "accepted"
          ? "assignment-confirmed"
          : "volunteer-interest";
  for (const userId of new Set([
    String(row.owner_id),
    String(row.requester_id),
  ]))
    queueNotification(db, {
      eventKey: `request:${id}:${status}`,
      userId,
      category: "pickup",
      kind,
      resourceId: id,
      resourceType: "request",
    });
}
function activeDonationRunIds(db: DatabaseSync, offerId: string): string[] {
  if (!offerHasVolunteerRun(db, offerId)) return [];
  return all(
    db,
    "SELECT id FROM volunteer_runs WHERE offer_id=? AND status IN ('pending','open','assigned')",
    offerId,
  ).map((row) => String(row.id));
}
function notifyClosedDonationRuns(db: DatabaseSync, runIds: string[]) {
  for (const id of runIds) {
    const run = get(
      db,
      "SELECT * FROM volunteer_runs WHERE id=? AND status='cancelled'",
      id,
    );
    if (!run) continue;
    for (const userId of new Set(
      [run.donor_id, run.volunteer_id].filter(
        (v): v is string => typeof v === "string",
      ),
    ))
      queueNotification(db, {
        eventKey: `run:${run.id}:${run.revision}:pickup-cancelled`,
        userId,
        category: "pickup",
        kind: "pickup-cancelled",
        resourceId: String(run.id),
        resourceType: "run",
      });
    for (const manager of all(
      db,
      "SELECT DISTINCT u.id FROM users u LEFT JOIN pantry_managers m ON m.user_id=u.id AND m.pantry_id=? WHERE u.email_verified_at IS NOT NULL AND (m.user_id IS NOT NULL OR u.pantry_role='administrator') LIMIT 100",
      String(run.pantry_id),
    ))
      queueNotification(db, {
        eventKey: `run:${run.id}:${run.revision}:pickup-cancelled`,
        userId: String(manager.id),
        category: "pantry",
        kind: "pickup-cancelled",
        resourceId: String(run.id),
        resourceType: "run",
      });
  }
}
function record(db: DatabaseSync, id: string) {
  return (
    get(db, "SELECT * FROM records WHERE id=?", id) ||
    fail(404, "Record not found.")
  );
}
function active(row: Row) {
  return row.status === "approved" && String(row.ends_at) > now();
}
function serialize(
  row: Row,
  privateView = false,
  db?: DatabaseSync,
): CommunityRecord {
  const data = JSON.parse(String(row.data));
  if (!privateView) {
    delete data.privatePickupInstructions;
    delete data.sharePickupInstructions;
  }
  return {
    ...data,
    ...(db && get(db, "SELECT 1 FROM photos WHERE record_id=?", String(row.id))
      ? { photoUrl: `/api/community/media/${row.id}` }
      : {}),
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    status:
      ["approved", "pending"].includes(String(row.status)) &&
      String(row.ends_at) <= now()
        ? "expired"
        : row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(privateView && row.moderation_reason
      ? { moderationReason: row.moderation_reason }
      : {}),
    ...(row.status === "approved"
      ? { availability: String(row.starts_at) > now() ? "scheduled" : "active" }
      : {}),
  };
}
function validateWindow(data: Record<string, unknown>) {
  const start = Date.parse(String(data.startsAt)),
    end = Date.parse(String(data.endsAt));
  if (
    end <= start ||
    end <= Date.now() ||
    start > Date.now() + 30 * 86400000 ||
    end - start > 86400000
  )
    fail(
      400,
      "Use a future pickup window within 30 days, lasting at most 24 hours.",
    );
  if (data.useBy) {
    const date = String(data.useBy);
    const pickupDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(end));
    if (!isDate(date) || pickupDate > date)
      fail(
        400,
        "The food must remain within its use-by date throughout pickup in America/Chicago.",
      );
  }
}
function requestOrigin(request: Request) {
  const configured =
    process.env.REACH_APP_ORIGIN || process.env.REACH_COMMUNITY_ORIGIN;
  if (configured) {
    const canonical = new URL(configured);
    if (
      !["http:", "https:"].includes(canonical.protocol) ||
      canonical.origin !== configured ||
      (process.env.NODE_ENV === "production" && canonical.protocol !== "https:")
    )
      fail(503, "Community origin configuration is invalid.");
    return canonical.origin;
  }
  if (process.env.NODE_ENV === "production")
    fail(503, "Community origin is not configured.");
  const url = new URL(request.url),
    host = request.headers.get("host");
  // Next may rewrite request.url to the bind address. Browser Host remains the
  // actual authority; cross-origin JavaScript cannot choose the Host header.
  // Forwarded headers are deliberately ignored. TLS proxies must set the explicit origin.
  if (host) {
    if (!/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::[0-9]{1,5})?$/.test(host))
      fail(400, "Invalid request host.");
    return new URL(`${url.protocol}//${host}`).origin;
  }
  return url.origin;
}
async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = MAX_BODY,
): Promise<T> {
  if (request.headers.get("origin") !== requestOrigin(request))
    fail(403, "A same-origin request is required.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail(415, "Send application/json.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "A JSON body is required.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      fail(413, "Request is too large.");
    }
    chunks.push(part.value);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "Invalid JSON.");
  }
  const result = schema.safeParse(value);
  if (!result.success)
    fail(400, "Please check the required fields and safety confirmations.");
  return result.data;
}
function response(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (cookie) {
    headers.append("Set-Cookie", cookie);
    headers.append(
      "Set-Cookie",
      `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/community; Max-Age=0${cookie.includes("; Secure") ? "; Secure" : ""}`,
    );
  }
  return Response.json(data, { status, headers });
}
function cookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${requestOrigin(request).startsWith("https:") ? "; Secure" : ""}`;
}
function session(db: DatabaseSync, userId: string, request: Request) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now());
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    hash(token),
    userId,
    new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
  );
  return cookie(request, token);
}
export function createModerator(
  username: string,
  password: string,
  path?: string,
) {
  const parsed = loginSchema.safeParse({ username, password });
  if (!parsed.success)
    throw new Error(
      "Username must use 3–32 lowercase letters, numbers or underscores; password must have 12–128 characters.",
    );
  const db = openCommunityDatabase(path),
    id = randomUUID(),
    salt = randomBytes(16).toString("hex");
  transaction(db, () => {
    if (get(db, "SELECT id FROM users WHERE username=?", parsed.data.username))
      throw new Error("Username already exists.");
    db.prepare(
      "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?,?,?,?,1,?)",
    ).run(
      id,
      parsed.data.username,
      hashAccountPasswordSync(password),
      salt,
      "moderator",
      now(),
    );
    audit(db, id, "moderator-created", id);
  });
}

/** The optional database path makes real HTTP handlers testable against isolated databases. */
export function createCommunityHandler(databasePath?: string) {
  return async function handle(
    request: Request,
    path?: string[],
  ): Promise<Response> {
    if (!featureEnabled("community"))
      return response(
        {
          code: "community_disabled",
          error:
            "Community sharing is disabled. Food resources and trip planning remain available.",
        },
        503,
      );
    try {
      const db = openCommunityDatabase(databasePath);
      rate(db, "global:requests", 600, 60);
      const parts =
        path ||
        new URL(request.url).pathname
          .replace(/^\/api\/community\/?/, "")
          .split("/")
          .filter(Boolean);
      const [resource, id, action] = parts;
      if (
        parts.length > 4 ||
        !parts.every((v) => /^[a-zA-Z0-9_-]{1,64}$/.test(v))
      )
        fail(404, "Not found.");
      const user = currentUser(db, request);
      if (request.method === "GET") {
        if (resource === "media" && parts.length === 2) {
          const row = record(db, id),
            owner = user?.id === row.owner_id,
            moderator = user?.role === "moderator";
          const visible =
            active(row) &&
            (!user || !blocked(db, user.id, String(row.owner_id))) &&
            (row.kind !== "offer" ||
              !get(
                db,
                "SELECT 1 FROM requests WHERE offer_id=? AND status='accepted'",
                id,
              ));
          if (
            !owner &&
            !moderator &&
            (!visible || (row.kind === "offer" && offerHasVolunteerRun(db, id)))
          )
            fail(404, "Photo not found.");
          const photo = db
            .prepare("SELECT bytes,mime FROM photos WHERE record_id=?")
            .get(id);
          if (!photo) fail(404, "Photo not found.");
          return new Response(new Uint8Array(photo.bytes as Uint8Array), {
            headers: {
              "Content-Type": String(photo.mime),
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'",
            },
          });
        }
        if (resource === "me" && parts.length === 1)
          return response({
            user,
            organizerRequested: user
              ? get(
                  db,
                  "SELECT status FROM organizer_requests WHERE user_id=?",
                  user.id,
                )?.status || null
              : null,
          });
        if (resource === "discovery" && parts.length === 1) {
          const rows = all(
            db,
            "SELECT * FROM records WHERE status='approved' AND ends_at>? ORDER BY starts_at LIMIT 200",
            now(),
          )
            .filter(
              (r) =>
                r.kind !== "offer" || !offerHasVolunteerRun(db, String(r.id)),
            )
            .filter((r) => !user || !blocked(db, user.id, String(r.owner_id)))
            .filter(
              (r) =>
                r.kind !== "offer" ||
                !get(
                  db,
                  "SELECT id FROM requests WHERE offer_id=? AND status='accepted'",
                  String(r.id),
                ),
            );
          return response({
            mode: "development",
            pickupAreas: COMMUNITY_PICKUP_AREAS,
            hotspots: rows
              .filter((r) => r.kind === "hotspot")
              .map((r) => serialize(r, false, db)),
            offers: rows
              .filter((r) => r.kind === "offer")
              .map((r) => serialize(r, false, db)),
          });
        }
        if (resource === "mine" && parts.length === 1) {
          const u = requireUser(user),
            rows = all(
              db,
              "SELECT * FROM records WHERE owner_id=? ORDER BY created_at DESC LIMIT 200",
              u.id,
            );
          const requests = all(
            db,
            "SELECT requests.*,records.owner_id,records.data FROM requests JOIN records ON records.id=requests.offer_id WHERE requests.requester_id=? OR records.owner_id=? ORDER BY requests.created_at DESC LIMIT 200",
            u.id,
            u.id,
          ).map((r) => ({
            id: r.id,
            offerId: r.offer_id,
            requesterId: r.requester_id,
            ownerId: r.owner_id,
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            offerTitle: JSON.parse(String(r.data)).title,
          }));
          return response({
            hotspots: rows
              .filter((r) => r.kind === "hotspot")
              .map((r) => serialize(r, true, db)),
            offers: rows
              .filter((r) => r.kind === "offer")
              .map((r) => serialize(r, true, db)),
            requests,
            organizerRequested:
              get(
                db,
                "SELECT status FROM organizer_requests WHERE user_id=?",
                u.id,
              )?.status || null,
          });
        }
        if (
          resource === "requests" &&
          action === "pickup" &&
          parts.length === 3
        ) {
          const u = requireUser(user),
            req =
              get(db, "SELECT * FROM requests WHERE id=?", id) ||
              fail(404, "Request not found."),
            offer = record(db, String(req.offer_id)),
            data = JSON.parse(String(offer.data));
          if (
            u.id !== offer.owner_id &&
            (u.id !== req.requester_id ||
              req.status !== "accepted" ||
              !req.pickup_consent ||
              !data.sharePickupInstructions ||
              blocked(db, u.id, String(offer.owner_id)) ||
              !active(offer))
          )
            fail(
              403,
              "Pickup details are available only with mutual consent on an active accepted request.",
            );
          return response({
            instructions: data.privatePickupInstructions,
            area: COMMUNITY_PICKUP_AREAS.find(
              (a) => a.id === data.pickupAreaId,
            ),
          });
        }
        if (resource === "moderation" && parts.length === 1) {
          requireModerator(user);
          const rows = all(
            db,
            "SELECT * FROM records WHERE status='pending' ORDER BY created_at LIMIT 200",
          );
          return response({
            hotspots: rows
              .filter((r) => r.kind === "hotspot")
              .map((r) => serialize(r, false, db)),
            offers: rows
              .filter((r) => r.kind === "offer")
              .map((r) => serialize(r, false, db)),
            organizers: all(
              db,
              "SELECT users.id,users.username,organizer_requests.created_at FROM organizer_requests JOIN users ON users.id=organizer_requests.user_id WHERE organizer_requests.status='pending' LIMIT 200",
            ).map((r) => ({
              id: r.id,
              username: r.username,
              createdAt: r.created_at,
            })),
            reports: all(
              db,
              "SELECT * FROM reports WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 200",
            ).map((r) => ({
              id: r.id,
              targetType: r.target_type,
              targetId: r.target_id,
              reason: r.reason,
              createdAt: r.created_at,
            })),
            audit: all(
              db,
              "SELECT * FROM audit ORDER BY id DESC LIMIT 100",
            ).map((r) => ({
              actorId: r.actor_id,
              action: r.action,
              targetId: r.target_id,
              createdAt: r.created_at,
              reason: r.reason,
            })),
          });
        }
        fail(404, "Not found.");
      }
      if (!["POST", "PATCH"].includes(request.method))
        fail(405, "Method not allowed.");
      rate(db, "global:mutations", 120, 60);
      if (
        resource === "auth" &&
        ["signup", "login"].includes(id) &&
        request.method === "POST" &&
        parts.length === 2
      ) {
        rate(db, "auth:global", 50, 900);
        const data = await body(
          request,
          id === "signup" ? signupSchema : loginSchema,
        );
        rate(db, `auth:${data.username}`, 10, 900);
        if (id === "signup") {
          const salt = randomBytes(16).toString("hex"),
            uid = randomUUID(),
            passwordHash = await hashAccountPassword(data.password);
          transaction(db, () => {
            if (get(db, "SELECT id FROM users WHERE username=?", data.username))
              fail(409, "This username is unavailable.");
            db.prepare(
              "INSERT INTO users(id,username,password_hash,salt,role,adult_confirmed,created_at) VALUES(?,?,?,?,?,1,?)",
            ).run(uid, data.username, passwordHash, salt, "resident", now());
            audit(db, uid, "signup", uid);
          });
          return response(
            { user: { id: uid, username: data.username, role: "resident" } },
            201,
            session(db, uid, request),
          );
        }
        const row = get(
          db,
          "SELECT * FROM users WHERE username=?",
          data.username,
        );
        if (
          !(await verifyAccountPassword(
            data.password,
            row as { password_hash: unknown; salt: unknown } | undefined,
          )) ||
          !row
        )
          fail(401, "Username or password is incorrect.");
        const upgrade = String(row.password_hash).startsWith("$argon2id$")
          ? null
          : await hashAccountPassword(data.password);
        const live = get(
          db,
          "SELECT password_version FROM users WHERE id=?",
          String(row.id),
        );
        if (!live || live.password_version !== row.password_version)
          fail(401, "Username or password is incorrect.");
        if (upgrade)
          db.prepare("UPDATE users SET password_hash=?,salt='' WHERE id=?").run(
            upgrade,
            String(row.id),
          );
        audit(db, String(row.id), "login", String(row.id));
        return response(
          { user: userFrom(row) },
          200,
          session(db, String(row.id), request),
        );
      }
      if (
        resource === "auth" &&
        id === "logout" &&
        request.method === "POST" &&
        parts.length === 2
      ) {
        await body(request, emptySchema);
        for (const token of accountSessionTokens(request))
          db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
            hash(token),
          );
        return response({ ok: true }, 200, cookie(request, "", 0));
      }
      const u = requireUser(user);
      rate(db, `user:${u.id}`, 40, 60);
      if (
        resource === "organizer-request" &&
        parts.length === 1 &&
        request.method === "POST"
      ) {
        await body(request, emptySchema);
        if (u.role !== "resident")
          fail(409, "This account already has organizer permissions.");
        transaction(db, () => {
          db.prepare(
            "INSERT INTO organizer_requests VALUES(?,'pending',?) ON CONFLICT(user_id) DO UPDATE SET status='pending',created_at=excluded.created_at",
          ).run(u.id, now());
          audit(db, u.id, "organizer-request", u.id);
        });
        return response({ ok: true });
      }
      if (["hotspots", "offers"].includes(resource)) {
        const kind = resource === "hotspots" ? "hotspot" : "offer";
        if (
          parts.length === 3 &&
          action === "photo" &&
          request.method === "POST"
        ) {
          const old = record(db, id);
          if (old.owner_id !== u.id || old.kind !== kind)
            fail(403, "Only the owner can attach a photo.");
          if (!["draft", "rejected"].includes(String(old.status)))
            fail(
              409,
              "Photos can only be changed on drafts or rejected records.",
            );
          const data = await body(
            request,
            z.object({ dataUrl: z.string().max(2900000) }).strict(),
            3 * 1024 * 1024,
          );
          let photo;
          try {
            photo = await sanitizeCommunityPhoto(data.dataUrl);
          } catch {
            fail(400, "Use a supported image up to 2 MB and 8 megapixels.");
          }
          transaction(db, () => {
            const current = record(db, id);
            if (
              current.owner_id !== u.id ||
              !["draft", "rejected"].includes(String(current.status))
            )
              fail(409, "The record is no longer an editable draft.");
            db.prepare(
              "INSERT INTO photos VALUES(?,?,?) ON CONFLICT(record_id) DO UPDATE SET bytes=excluded.bytes,mime=excluded.mime",
            ).run(id, photo.bytes, photo.mime);
            db.prepare(
              "UPDATE records SET status='draft',updated_at=? WHERE id=?",
            ).run(now(), id);
            audit(db, u.id, "photo", id);
          });
          return response({ record: serialize(record(db, id), true, db) });
        }
        if (
          (parts.length === 1 && request.method === "POST") ||
          (parts.length === 2 && request.method === "PATCH")
        ) {
          if (
            kind === "hotspot" &&
            !["organizer", "moderator"].includes(u.role)
          )
            fail(403, "An approved organizer account is required.");
          const data =
            kind === "hotspot"
              ? await body(request, hotspotSchema)
              : await body(request, offerSchema);
          validateWindow(data);
          const recordId = id || randomUUID(),
            at = now();
          transaction(db, () => {
            if (id) {
              const old = record(db, id);
              if (old.owner_id !== u.id || old.kind !== kind)
                fail(403, "Only the owner can edit this record.");
              if (!["draft", "rejected"].includes(String(old.status)))
                fail(409, "Only drafts or rejected records can be edited.");
              db.prepare(
                "UPDATE records SET data=?,starts_at=?,ends_at=?,status='draft',updated_at=?,moderation_reason=NULL WHERE id=?",
              ).run(JSON.stringify(data), data.startsAt, data.endsAt, at, id);
            } else {
              db.prepare(
                "INSERT INTO records VALUES(?,?,?,'draft',?,?,?,?,?,NULL)",
              ).run(
                recordId,
                kind,
                u.id,
                JSON.stringify(data),
                data.startsAt,
                data.endsAt,
                at,
                at,
              );
            }
            audit(db, u.id, id ? "edit-draft" : "create-draft", recordId);
          });
          return response(
            { record: serialize(record(db, recordId), true, db) },
            id ? 200 : 201,
          );
        }
        if (
          parts.length === 3 &&
          request.method === "POST" &&
          ["submit", "cancel", "end"].includes(action)
        ) {
          await body(request, emptySchema);
          transaction(db, () => {
            const old = record(db, id);
            const closingRuns =
              action === "submit" ? [] : activeDonationRunIds(db, id);
            if (old.owner_id !== u.id || old.kind !== kind)
              fail(403, "Only the owner can change this record.");
            if (action === "submit") {
              if (!["draft", "rejected"].includes(String(old.status)))
                fail(409, "Only a draft can be submitted.");
              validateWindow(JSON.parse(String(old.data)));
            } else if (["cancelled", "ended"].includes(String(old.status)))
              fail(409, "This record has already ended.");
            db.prepare(
              "UPDATE records SET status=?,updated_at=? WHERE id=?",
            ).run(
              action === "submit"
                ? "pending"
                : action === "cancel"
                  ? "cancelled"
                  : "ended",
              now(),
              id,
            );
            if (action !== "submit") {
              for (const pending of all(
                db,
                "SELECT id FROM requests WHERE offer_id=? AND status IN ('requested','accepted')",
                id,
              ))
                notifyPickupRequest(db, String(pending.id), "cancelled");
              db.prepare(
                "UPDATE requests SET status='cancelled',updated_at=? WHERE offer_id=? AND status IN ('requested','accepted')",
              ).run(now(), id);
              notifyClosedDonationRuns(db, closingRuns);
            }
            audit(db, u.id, action, id);
          });
          return response({ record: serialize(record(db, id), true, db) });
        }
        if (
          kind === "offer" &&
          action === "request" &&
          parts.length === 3 &&
          request.method === "POST"
        ) {
          await body(
            request,
            z.object({ pickupConsent: z.literal(true) }).strict(),
          );
          const rid = randomUUID();
          transaction(db, () => {
            const offer = record(db, id);
            if (
              offer.kind !== "offer" ||
              !active(offer) ||
              offerHasVolunteerRun(db, id)
            )
              fail(409, "This offer is no longer available.");
            if (
              offer.owner_id === u.id ||
              blocked(db, u.id, String(offer.owner_id))
            )
              fail(403, "This request is not permitted.");
            if (
              get(
                db,
                "SELECT id FROM requests WHERE offer_id=? AND status='accepted'",
                id,
              )
            )
              fail(409, "This offer is already reserved.");
            if (
              get(
                db,
                "SELECT id FROM requests WHERE offer_id=? AND requester_id=?",
                id,
                u.id,
              )
            )
              fail(409, "You already have a request for this offer.");
            db.prepare(
              "INSERT INTO requests VALUES(?,?,?,'requested',1,?,?)",
            ).run(rid, id, u.id, now(), now());
            notifyPickupRequest(db, rid, "requested");
            audit(db, u.id, "request", rid);
          });
          return response({ id: rid, status: "requested" }, 201);
        }
      }
      if (
        resource === "requests" &&
        parts.length === 3 &&
        ["accept", "decline", "cancel", "collect"].includes(action) &&
        request.method === "POST"
      ) {
        await body(request, emptySchema);
        transaction(db, () => {
          const req =
              get(db, "SELECT * FROM requests WHERE id=?", id) ||
              fail(404, "Request not found."),
            offer = record(db, String(req.offer_id)),
            isOwner = offer.owner_id === u.id,
            isRequester = req.requester_id === u.id;
          if (action === "cancel") {
            if (!isRequester && !isOwner) fail(403, "This request is private.");
            if (!["requested", "accepted"].includes(String(req.status)))
              fail(409, "This request is already closed.");
          } else {
            if (!(isOwner || (action === "collect" && isRequester)))
              fail(
                403,
                "Only the offer owner can manage this request; an accepted recipient may confirm collection.",
              );
            if (!active(offer) || blocked(db, u.id, String(req.requester_id)))
              fail(409, "This offer is no longer available.");
            if (
              action === "collect"
                ? req.status !== "accepted"
                : req.status !== "requested"
            )
              fail(409, "This request cannot make that transition.");
          }
          if (action === "accept" && offerHasVolunteerRun(db, String(offer.id)))
            fail(409, "This offer is reserved for a pantry donation run.");
          if (action === "collect" && String(offer.starts_at) > now())
            fail(409, "Collection is available when the pickup window starts.");
          if (
            action === "accept" &&
            get(
              db,
              "SELECT id FROM requests WHERE offer_id=? AND status='accepted'",
              String(offer.id),
            )
          )
            fail(409, "This offer is already reserved.");
          const status = (
            {
              accept: "accepted",
              decline: "declined",
              cancel: "cancelled",
              collect: "collected",
            } as const
          )[action as "accept" | "decline" | "cancel" | "collect"];
          db.prepare(
            "UPDATE requests SET status=?,updated_at=? WHERE id=?",
          ).run(status, now(), id);
          if (action === "collect") {
            db.prepare(
              "UPDATE records SET status='ended',updated_at=? WHERE id=?",
            ).run(now(), String(offer.id));
            for (const declined of all(
              db,
              "SELECT id FROM requests WHERE offer_id=? AND status='requested'",
              String(offer.id),
            ))
              notifyPickupRequest(db, String(declined.id), "declined");
            db.prepare(
              "UPDATE requests SET status='declined',updated_at=? WHERE offer_id=? AND status='requested'",
            ).run(now(), String(offer.id));
          }
          notifyPickupRequest(db, id, status);
          audit(db, u.id, action, id);
        });
        return response({ ok: true });
      }
      if (
        resource === "moderation" &&
        parts.length === 4 &&
        ["hotspots", "offers"].includes(id) &&
        parts[3] === "remove" &&
        request.method === "POST"
      ) {
        requireModerator(u);
        const data = await body(
          request,
          z.object({ reason: text(500) }).strict(),
        );
        transaction(db, () => {
          const old = record(db, parts[2]);
          const closingRuns = activeDonationRunIds(db, parts[2]);
          if (old.kind !== (id === "hotspots" ? "hotspot" : "offer"))
            fail(404, "Record not found.");
          db.prepare(
            "UPDATE records SET status='ended',updated_at=?,moderation_reason=? WHERE id=?",
          ).run(now(), data.reason, parts[2]);
          db.prepare(
            "UPDATE requests SET status='cancelled',updated_at=? WHERE offer_id=? AND status IN ('requested','accepted')",
          ).run(now(), parts[2]);
          for (const cancelled of all(
            db,
            "SELECT id FROM requests WHERE offer_id=? AND status='cancelled'",
            parts[2],
          ))
            notifyPickupRequest(db, String(cancelled.id), "cancelled");
          notifyClosedDonationRuns(db, closingRuns);
          audit(db, u.id, "moderator-remove", parts[2], data.reason);
        });
        return response({ ok: true });
      }
      if (
        resource === "moderation" &&
        parts.length === 4 &&
        id === "reports" &&
        parts[3] === "resolve" &&
        request.method === "POST"
      ) {
        requireModerator(u);
        const data = await body(request, reasonSchema);
        transaction(db, () => {
          if (!get(db, "SELECT id FROM reports WHERE id=?", parts[2]))
            fail(404, "Report not found.");
          db.prepare("UPDATE reports SET resolved_at=? WHERE id=?").run(
            now(),
            parts[2],
          );
          db.exec(
            "DELETE FROM reports WHERE resolved_at IS NOT NULL AND id NOT IN (SELECT id FROM reports WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 1000)",
          );
          audit(db, u.id, "resolve-report", parts[2], data.reason || null);
        });
        return response({ ok: true });
      }
      if (
        resource === "moderation" &&
        parts.length === 4 &&
        ["hotspots", "offers", "organizers"].includes(id) &&
        ["approve", "reject"].includes(parts[3]) &&
        request.method === "POST"
      ) {
        requireModerator(u);
        const data = await body(request, reasonSchema),
          target = parts[2],
          decision = parts[3];
        transaction(db, () => {
          if (id === "organizers") {
            const application = get(
              db,
              "SELECT * FROM organizer_requests WHERE user_id=?",
              target,
            );
            if (!application || application.status !== "pending")
              fail(409, "No pending organizer application.");
            if (target === u.id)
              fail(403, "You cannot approve your own application.");
            db.prepare(
              "UPDATE organizer_requests SET status=? WHERE user_id=?",
            ).run(decision === "approve" ? "approved" : "rejected", target);
            if (decision === "approve")
              db.prepare(
                "UPDATE users SET role='organizer' WHERE id=? AND role='resident'",
              ).run(target);
          } else {
            const old = record(db, target);
            if (
              old.kind !== (id === "hotspots" ? "hotspot" : "offer") ||
              old.status !== "pending"
            )
              fail(409, "No pending record.");
            if (old.owner_id === u.id)
              fail(403, "Another moderator must review your submission.");
            if (decision === "approve")
              validateWindow(JSON.parse(String(old.data)));
            db.prepare(
              "UPDATE records SET status=?,updated_at=?,moderation_reason=? WHERE id=?",
            ).run(
              decision === "approve" ? "approved" : "rejected",
              now(),
              data.reason || null,
              target,
            );
          }
          audit(db, u.id, `${decision}-${id}`, target, data.reason || null);
        });
        return response({ ok: true });
      }
      if (
        resource === "reports" &&
        parts.length === 1 &&
        request.method === "POST"
      ) {
        const data = await body(
          request,
          z
            .object({
              targetType: z.enum(["hotspot", "offer", "user"]),
              targetId: z.string().uuid(),
              reason: text(500),
            })
            .strict(),
        );
        const rid = randomUUID();
        transaction(db, () => {
          if (data.targetType === "user") {
            if (!get(db, "SELECT id FROM users WHERE id=?", data.targetId))
              fail(404, "Account not found.");
          } else if (record(db, data.targetId).kind !== data.targetType)
            fail(404, "Record not found.");
          db.prepare(
            "INSERT INTO reports(id,reporter_id,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?,?)",
          ).run(rid, u.id, data.targetType, data.targetId, data.reason, now());
          audit(db, u.id, "report", data.targetId);
        });
        return response({ ok: true }, 201);
      }
      if (
        resource === "blocks" &&
        parts.length === 1 &&
        request.method === "POST"
      ) {
        const data = await body(
          request,
          z.object({ userId: z.string().uuid() }).strict(),
        );
        if (data.userId === u.id) fail(400, "You cannot block yourself.");
        transaction(db, () => {
          if (!get(db, "SELECT id FROM users WHERE id=?", data.userId))
            fail(404, "Account not found.");
          db.prepare("INSERT OR IGNORE INTO blocks VALUES(?,?,?)").run(
            u.id,
            data.userId,
            now(),
          );
          db.prepare(
            "UPDATE requests SET status='cancelled',updated_at=? WHERE status IN ('requested','accepted') AND ((requester_id=? AND offer_id IN (SELECT id FROM records WHERE owner_id=?)) OR (requester_id=? AND offer_id IN (SELECT id FROM records WHERE owner_id=?)))",
          ).run(now(), u.id, data.userId, data.userId, u.id);
          audit(db, u.id, "block", data.userId);
        });
        return response({ ok: true });
      }
      fail(404, "Not found.");
    } catch (error) {
      return error instanceof ApiError
        ? response({ error: error.message }, error.status)
        : response(
            { error: "The community service could not complete this request." },
            500,
          );
    }
  };
}
