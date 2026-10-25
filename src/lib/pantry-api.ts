import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import type { Resource } from "../data/resources";
import {
  AccountError,
  accountRate,
  getAccountActor,
  requireAccountActor,
  type AccountActor,
} from "./account-store";
import {
  canEditPantry,
  createPantry,
  getPantryInventory,
  getPantryRecord,
  openPantryDatabase,
  pantryAudit,
  pantryTransaction,
  recordPantryHistory,
  savePantryHours,
  serializePantryResource,
} from "./pantry-store";
import {
  describePantryWindows,
  pantryDateSchema,
  pantryHoursSchema,
} from "./pantry-schedule";
import type { PantryRecord } from "./pantry-types";
import { accountRequestOrigin } from "./auth-origin";
const text = (max: number) => z.string().trim().min(1).max(max);
const plain = (max: number) => z.string().trim().max(max);
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((v) => {
    const u = new URL(v);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Use an HTTP or HTTPS website.");
const source = z
  .object({
    title: text(200),
    url: httpUrl.optional(),
    checkedOn: pantryDateSchema.optional(),
  })
  .strict();
const fields = {
  name: text(200),
  address: text(500),
  coordinates: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .strict()
    .nullable(),
  phone: plain(80).regex(/^[\d +().#xXextEXT-]*$/, "Use a telephone number."),
  website: httpUrl.nullable(),
  hours: plain(2000),
  eligibility: plain(2000),
  notes: plain(4000),
  offering: plain(2000),
  pedestrianPickup: z.enum(["allowed", "not-allowed", "unknown"]),
  accessibility: plain(2000),
  verificationStatus: z.enum(["confirmed-site", "needs-confirmation"]),
  detailsNeedConfirmation: z.boolean(),
  sources: z.array(source).max(30),
  lastVerified: pantryDateSchema.nullable(),
};
export const pantryPatchSchema = z
  .object(fields)
  .partial()
  .extend({ version: z.number().int().positive() })
  .strict()
  .refine(
    (v) => Object.keys(v).length > 1,
    "Supply at least one changed field.",
  );
const createSchema = z
  .object({
    ...fields,
    name: fields.name,
    address: fields.address,
    coordinates: fields.coordinates.default(null),
    phone: fields.phone.optional(),
    website: fields.website.default(null),
    hours: fields.hours.default("Distribution hours not verified."),
    eligibility: fields.eligibility.default("Eligibility not verified."),
    notes: fields.notes.default(""),
    offering: fields.offering.optional(),
    pedestrianPickup: fields.pedestrianPickup.default("unknown"),
    accessibility: fields.accessibility.optional(),
    verificationStatus: fields.verificationStatus.default("needs-confirmation"),
    detailsNeedConfirmation: fields.detailsNeedConfirmation.default(true),
    sources: fields.sources.default([]),
    lastVerified: fields.lastVerified.default(null),
  })
  .strict();
const inventorySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            category: text(100),
            status: z.enum(["available", "limited", "unavailable", "unknown"]),
            quantity: z.number().int().min(0).max(10000000).nullable(),
            source: text(300),
            updatedAt: z.string().datetime({ offset: true }).optional(),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (v) =>
          new Set(v.map((i) => i.category.toLowerCase())).size === v.length,
        "Food categories must be unique.",
      ),
    version: z.number().int().positive(),
  })
  .strict();
const reply = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
function fail(status: number, message: string): never {
  throw new AccountError(status, message);
}
async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail(415, "Send JSON data.");
  const max = 65536;
  if (Number(request.headers.get("content-length") || 0) > max)
    fail(413, "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Send a JSON body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      fail(413, "The request is too large.");
    }
    chunks.push(value);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "Send valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    fail(400, parsed.error.issues[0]?.message || "Invalid data.");
  return parsed.data;
}
function pagination(url: URL) {
  const p = url.searchParams.get("page") || "1",
    s = url.searchParams.get("pageSize") || "50";
  if (!/^\d+$/.test(p) || !/^\d+$/.test(s)) fail(400, "Invalid page.");
  const page = Number(p),
    size = Number(s);
  if (page < 1 || page > 100000 || size < 1 || size > 100)
    fail(400, "Invalid page.");
  return { page, size, offset: (page - 1) * size };
}
function admin(actor: AccountActor | null) {
  if (!actor) fail(401, "Sign in to continue.");
  if (actor.role !== "administrator" || !actor.emailVerified)
    fail(403, "An administrator account with a verified email is required.");
  return actor;
}
function editable(db: DatabaseSync, actor: AccountActor, id: string) {
  if (!canEditPantry(db, actor, id))
    fail(403, "You can only edit a pantry assigned to you.");
}
function pantry(db: DatabaseSync, id: string, actor: AccountActor | null) {
  const p = getPantryRecord(id, db);
  if (!p || (!p.active && !canEditPantry(db, actor, id)))
    fail(404, "Pantry not found.");
  return p;
}
function version(p: PantryRecord, v: number) {
  if (p.version !== v)
    fail(409, "This pantry changed. Refresh it before saving.");
}
function bump(db: DatabaseSync, id: string) {
  db.prepare(
    "UPDATE pantries SET version=version+1,updated_at=? WHERE id=?",
  ).run(new Date().toISOString(), id);
}
function applyPatch(
  db: DatabaseSync,
  id: string,
  data: z.infer<typeof pantryPatchSchema>,
  actor: string,
  action = "update",
) {
  const p = getPantryRecord(id, db) || fail(404, "Pantry not found.");
  version(p, data.version);
  const { version: _, ...changes } = data,
    merged = { ...p, ...changes };
  const moved =
    merged.address !== p.address ||
    JSON.stringify(merged.coordinates) !== JSON.stringify(p.coordinates);
  if (moved && changes.pedestrianPickup === undefined)
    merged.pedestrianPickup = "unknown";
  if (changes.hours !== undefined && changes.hours !== p.hours) {
    // Human-readable hours cannot safely stand in for a recurrence rule.
    // Keep recorded closures, and require a structured hours save before routing.
    savePantryHours(db, id, [], p.closures);
    merged.windows = [];
    merged.scheduleNotes = `${changes.hours} ${merged.notes}`.trim();
  } else if (changes.notes !== undefined) {
    merged.scheduleNotes = `${merged.hours} ${changes.notes}`.trim();
  }
  db.prepare(
    "UPDATE pantries SET name=?,address=?,resource_json=?,website=?,last_verified=?,version=version+1,updated_at=? WHERE id=?",
  ).run(
    merged.name,
    merged.address,
    serializePantryResource(merged),
    merged.website,
    merged.lastVerified,
    new Date().toISOString(),
    id,
  );
  recordPantryHistory(db, id, action, actor);
}
function corrections(db: DatabaseSync, limit: number, offset: number) {
  return db
    .prepare(
      "SELECT c.*,p.name pantry_name FROM pantry_corrections c JOIN pantries p ON p.id=c.pantry_id ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END,c.created_at DESC,c.id LIMIT ? OFFSET ?",
    )
    .all(limit, offset)
    .map((c) => ({
      id: c.id,
      pantryId: c.pantry_id,
      pantryName: c.pantry_name,
      description: c.description,
      status: c.status,
      createdAt: c.created_at,
      reviewedAt: c.reviewed_at,
      notes: c.notes,
    }));
}
/** Request handlers accept an explicit database path for isolated integration tests. */
export function createPantryHandler(databasePath?: string) {
  return async (request: Request, parts: string[] = []): Promise<Response> => {
    try {
      const db = openPantryDatabase(databasePath),
        url = new URL(request.url),
        method = request.method,
        actor = getAccountActor(db, request),
        [id, action, target] = parts;
      if (parts.length > 3 || parts.some((v) => !v || v.length > 200))
        fail(404, "Not found.");
      const { page, size, offset } = pagination(url);
      if (method === "GET") {
        if (!parts.length || id === "management") {
          const management = id === "management",
            includeArchived =
              management || url.searchParams.get("includeArchived") === "true";
          if (parts.length > 1) fail(404, "Not found.");
          if (includeArchived && !actor) fail(401, "Sign in to continue.");
          if (includeArchived && !actor?.emailVerified)
            fail(403, "Verify your email to manage pantries.");
          const q =
            url.searchParams.get("query") || url.searchParams.get("q") || "";
          if (q.length > 200) fail(400, "Search is too long.");
          const all = db
            .prepare("SELECT id FROM pantries ORDER BY name,id")
            .all()
            .map((r) => getPantryRecord(String(r.id), db)!)
            .filter(
              (p) =>
                (includeArchived ? canEditPantry(db, actor, p.id) : p.active) &&
                (!management || canEditPantry(db, actor, p.id)) &&
                `${p.name} ${p.address}`
                  .toLowerCase()
                  .includes(q.toLowerCase()),
            );
          if (
            includeArchived &&
            actor?.role !== "administrator" &&
            !db
              .prepare("SELECT 1 FROM pantry_managers WHERE user_id=?")
              .get(actor!.id)
          )
            fail(403, "Pantry management permissions are required.");
          return reply({
            pantries: all.slice(offset, offset + size),
            page,
            total: all.length,
          });
        }
        if (id === "favorites" && parts.length === 1) {
          const u = requireAccountActor(db, request);
          const rows = db
            .prepare(
              "SELECT pantry_id FROM pantry_favorites f JOIN pantries p ON p.id=f.pantry_id WHERE f.user_id=? AND p.active=1 ORDER BY f.created_at DESC",
            )
            .all(u.id);
          return reply({
            favorites: rows.map((r) => String(r.pantry_id)),
            pantries: rows.map((r) => getPantryRecord(String(r.pantry_id), db)),
          });
        }
        if (id === "assignments" && parts.length === 1) {
          admin(actor);
          const total = Number(
            db.prepare("SELECT count(*) n FROM pantry_managers").get()!.n,
          );
          return reply({
            assignments: db
              .prepare(
                "SELECT m.pantry_id pantryId,m.user_id userId,u.email,u.name FROM pantry_managers m JOIN users u ON u.id=m.user_id ORDER BY m.pantry_id,u.email LIMIT ? OFFSET ?",
              )
              .all(size, offset),
            page,
            total,
          });
        }
        if (id === "corrections" && parts.length === 1) {
          admin(actor);
          return reply({
            corrections: corrections(db, size, offset),
            page,
            total: Number(
              db.prepare("SELECT count(*) n FROM pantry_corrections").get()!.n,
            ),
          });
        }
        if (id === "audit" && parts.length === 1) {
          admin(actor);
          return reply({
            audit: db
              .prepare(
                "SELECT a.*,u.name actor_name,u.email actor_email,p.name pantry_name FROM pantry_audit a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN pantries p ON p.id=a.pantry_id ORDER BY a.id DESC LIMIT ? OFFSET ?",
              )
              .all(size, offset)
              .map((r) => ({
                id: r.id,
                actorId: r.actor_id,
                actorName: r.actor_name,
                actorEmail: r.actor_email,
                pantryName: r.pantry_name,
                action: r.action,
                pantryId: r.pantry_id,
                details: JSON.parse(String(r.details_json)),
                createdAt: r.created_at,
              })),
            page,
            total: Number(
              db.prepare("SELECT count(*) n FROM pantry_audit").get()!.n,
            ),
          });
        }
        if (parts.length === 1) {
          const p = pantry(db, id, actor);
          return reply({
            pantry: p,
            inventory: getPantryInventory(id, db),
            permissions: {
              canEdit: canEditPantry(db, actor, id),
              isAdmin: actor?.role === "administrator" && actor.emailVerified,
            },
          });
        }
        fail(404, "Not found.");
      }
      if (!["POST", "PATCH", "PUT", "DELETE"].includes(method))
        fail(405, "Method not allowed.");
      const origin = request.headers.get("origin");
      if (
        origin !== accountRequestOrigin(request) ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        fail(403, "A same-origin request is required.");
      const u = requireAccountActor(db, request);
      accountRate(db, `pantry-write:${u.id}`, 60, 60);
      if (
        id === "favorites" &&
        parts.length === 1 &&
        ["POST", "DELETE"].includes(method)
      ) {
        const data = await body(request, z.object({ id: text(200) }).strict());
        requireAccountActor(db, request);
        const p = pantry(db, data.id, u);
        if (!p.active) fail(404, "Pantry not found.");
        if (method === "POST")
          db.prepare(
            "INSERT OR IGNORE INTO pantry_favorites VALUES(?,?,?)",
          ).run(u.id, data.id, new Date().toISOString());
        else
          db.prepare(
            "DELETE FROM pantry_favorites WHERE user_id=? AND pantry_id=?",
          ).run(u.id, data.id);
        return reply({ ok: true });
      }
      if (!u.emailVerified) fail(403, "Verify your email address to continue.");
      if (!parts.length && method === "POST") {
        admin(u);
        const data = await body(request, createSchema),
          { website, lastVerified, ...resource } = data;
        const p = pantryTransaction(db, () => {
          admin(requireAccountActor(db, request));
          return createPantry(
            db,
            { ...resource, id: randomUUID() } as Resource,
            u.id,
            website,
            lastVerified,
          );
        });
        return reply({ pantry: p }, 201);
      }
      if (id === "assignments" && parts.length === 1 && method === "POST") {
        admin(u);
        const data = await body(
          request,
          z
            .object({
              pantryId: text(200),
              email: z.string().trim().toLowerCase().email().max(254),
              assign: z.boolean(),
            })
            .strict(),
        );
        pantryTransaction(db, () => {
          admin(requireAccountActor(db, request));
          pantry(db, data.pantryId, u);
          const manager =
            db
              .prepare(
                "SELECT id FROM users WHERE email=? COLLATE NOCASE AND email_verified_at IS NOT NULL",
              )
              .get(data.email) ||
            fail(400, "Choose an existing account with a verified email.");
          if (data.assign)
            db.prepare(
              "INSERT OR IGNORE INTO pantry_managers VALUES(?,?,?,?)",
            ).run(
              data.pantryId,
              String(manager.id),
              u.id,
              new Date().toISOString(),
            );
          else
            db.prepare(
              "DELETE FROM pantry_managers WHERE pantry_id=? AND user_id=?",
            ).run(data.pantryId, String(manager.id));
          pantryAudit(
            db,
            u.id,
            data.assign ? "assign-manager" : "remove-manager",
            data.pantryId,
            { userId: manager.id },
          );
        });
        return reply({ ok: true });
      }
      if (
        id === "corrections" &&
        parts.length === 3 &&
        target === "review" &&
        method === "POST"
      ) {
        admin(u);
        const data = await body(
          request,
          z
            .object({
              decision: z.enum(["approve", "reject"]),
              notes: plain(1000),
              changes: pantryPatchSchema.optional(),
            })
            .strict(),
        );
        if (data.decision === "approve" && !data.changes)
          fail(400, "Review and supply the pantry changes before approving.");
        if (data.decision === "reject" && data.changes)
          fail(400, "Rejected corrections cannot change a pantry.");
        pantryTransaction(db, () => {
          admin(requireAccountActor(db, request));
          const correction =
            db
              .prepare("SELECT * FROM pantry_corrections WHERE id=?")
              .get(action) || fail(404, "Correction not found.");
          if (correction.status !== "pending")
            fail(409, "This correction has already been reviewed.");
          if (data.changes)
            applyPatch(
              db,
              String(correction.pantry_id),
              data.changes,
              u.id,
              "approve-correction",
            );
          db.prepare(
            "UPDATE pantry_corrections SET status=?,reviewed_by=?,reviewed_at=?,notes=? WHERE id=?",
          ).run(
            data.decision === "approve" ? "approved" : "rejected",
            u.id,
            new Date().toISOString(),
            data.notes,
            action,
          );
          pantryAudit(
            db,
            u.id,
            `${data.decision}-correction`,
            String(correction.pantry_id),
            { correctionId: action, notes: data.notes },
          );
        });
        return reply({ ok: true });
      }
      const p = pantry(db, id, u);
      if (parts.length === 2 && action === "corrections" && method === "POST") {
        accountRate(db, `pantry-correction:${u.id}`, 5, 3600);
        if (!p.active) fail(404, "Pantry not found.");
        const data = await body(
            request,
            z.object({ description: text(2000) }).strict(),
          ),
          cid = randomUUID();
        pantryTransaction(db, () => {
          requireAccountActor(db, request, { verified: true });
          if (!pantry(db, id, u).active) fail(404, "Pantry not found.");
          db.prepare(
            "INSERT INTO pantry_corrections(id,pantry_id,submitted_by,description,status,created_at) VALUES(?,?,?,?,'pending',?)",
          ).run(cid, id, u.id, data.description, new Date().toISOString());
          pantryAudit(db, u.id, "submit-correction", id, { correctionId: cid });
        });
        return reply({ id: cid, status: "pending" }, 201);
      }
      editable(db, u, id);
      if (parts.length === 1 && method === "PATCH") {
        const data = await body(request, pantryPatchSchema);
        pantryTransaction(db, () => {
          editable(
            db,
            requireAccountActor(db, request, { verified: true }),
            id,
          );
          applyPatch(db, id, data, u.id);
        });
        return reply({ pantry: getPantryRecord(id, db) });
      }
      if (
        parts.length === 2 &&
        ["archive", "restore"].includes(action) &&
        method === "POST"
      ) {
        admin(u);
        const data = await body(
          request,
          z.object({ confirmation: text(200) }).strict(),
        );
        pantryTransaction(db, () => {
          admin(requireAccountActor(db, request));
          const current = getPantryRecord(id, db)!;
          if (data.confirmation !== current.name)
            fail(400, "Enter the pantry name to confirm.");
          if (current.active === (action === "restore"))
            fail(409, "The pantry already has this status.");
          const affectedRuns =
            action === "archive" &&
            db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='volunteer_runs'",
              )
              .get()
              ? db
                  .prepare(
                    "SELECT id FROM volunteer_runs WHERE pantry_id=? AND status IN ('pending','open','assigned')",
                  )
                  .all(id)
              : [];
          db.prepare("UPDATE pantries SET active=? WHERE id=?").run(
            action === "restore" ? 1 : 0,
            id,
          );
          bump(db, id);
          recordPantryHistory(db, id, action, u.id);
        });
        return reply({ pantry: getPantryRecord(id, db) });
      }
      if (parts.length === 2 && action === "hours" && method === "PUT") {
        const data = await body(request, pantryHoursSchema);
        pantryTransaction(db, () => {
          editable(
            db,
            requireAccountActor(db, request, { verified: true }),
            id,
          );
          const current = getPantryRecord(id, db)!;
          version(current, data.version);
          savePantryHours(db, id, data.windows, data.closures);
          db.prepare("UPDATE pantries SET resource_json=? WHERE id=?").run(
            serializePantryResource({
              ...current,
              hours: describePantryWindows(data.windows, data.closures),
              // This save replaces the schedule, including old seed exceptions.
              scheduleNotes: describePantryWindows(data.windows, data.closures),
            }),
            id,
          );
          bump(db, id);
          recordPantryHistory(db, id, "hours", u.id);
        });
        return reply({ pantry: getPantryRecord(id, db) });
      }
      if (parts.length === 2 && action === "inventory" && method === "PUT") {
        const data = await body(request, inventorySchema);
        pantryTransaction(db, () => {
          editable(
            db,
            requireAccountActor(db, request, { verified: true }),
            id,
          );
          version(getPantryRecord(id, db)!, data.version);
          db.prepare("DELETE FROM pantry_inventory WHERE pantry_id=?").run(id);
          for (const item of data.items)
            db.prepare("INSERT INTO pantry_inventory VALUES(?,?,?,?,?,?)").run(
              id,
              item.category,
              item.status,
              item.quantity,
              item.source,
              new Date().toISOString(),
            );
          bump(db, id);
          recordPantryHistory(db, id, "inventory", u.id);
        });
        return reply({
          pantry: getPantryRecord(id, db),
          inventory: getPantryInventory(id, db),
        });
      }
      fail(404, "Not found.");
    } catch (error) {
      return error instanceof AccountError
        ? reply({ error: error.message }, error.status)
        : reply(
            { error: "The pantry service could not complete this request." },
            500,
          );
    }
  };
}
