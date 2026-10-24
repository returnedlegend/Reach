import { queueNotification } from "./notifications-store";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { foodResources, type Resource } from "../data/resources";
import { realPantries } from "../data/real-pantries";
import type { Pantry, PantryWindow, SourceRef } from "./types";
import type { PantryRecord, PantryInventoryItem } from "./pantry-types";
import { openCommunityDatabase } from "./community";
import { initializeAccountSchema, type AccountActor } from "./account-store";

const initialized = new WeakSet<DatabaseSync>();
export const pantryMigration1 = `
CREATE TABLE pantries(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL,resource_json TEXT NOT NULL CHECK(json_valid(resource_json)),planner_json TEXT NOT NULL CHECK(json_valid(planner_json)),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),website TEXT,last_verified TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX pantry_directory ON pantries(active,name,id);
CREATE TABLE pantry_hours(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,window_id TEXT NOT NULL,position INTEGER NOT NULL,window_json TEXT NOT NULL CHECK(json_valid(window_json)),PRIMARY KEY(pantry_id,window_id));
CREATE TABLE pantry_closures(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,date TEXT NOT NULL,PRIMARY KEY(pantry_id,date));
CREATE TABLE pantry_inventory(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,category TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('available','limited','unavailable','unknown')),quantity INTEGER CHECK(quantity IS NULL OR quantity>=0),source TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(pantry_id,category));
CREATE TABLE pantry_managers(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,PRIMARY KEY(pantry_id,user_id));
CREATE INDEX pantry_manager_user ON pantry_managers(user_id,pantry_id);
CREATE TABLE pantry_favorites(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,pantry_id));
CREATE TABLE pantry_corrections(id TEXT PRIMARY KEY,pantry_id TEXT NOT NULL REFERENCES pantries(id),submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,description TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),created_at TEXT NOT NULL,reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,reviewed_at TEXT,notes TEXT);
CREATE INDEX pantry_correction_queue ON pantry_corrections(status,created_at,id);
CREATE TABLE pantry_history(id INTEGER PRIMARY KEY AUTOINCREMENT,pantry_id TEXT NOT NULL REFERENCES pantries(id),version INTEGER NOT NULL,action TEXT NOT NULL,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),created_at TEXT NOT NULL,UNIQUE(pantry_id,version));
CREATE INDEX pantry_history_listing ON pantry_history(pantry_id,created_at);
CREATE TABLE pantry_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,pantry_id TEXT REFERENCES pantries(id),details_json TEXT NOT NULL CHECK(json_valid(details_json)),created_at TEXT NOT NULL);
CREATE INDEX pantry_audit_recent ON pantry_audit(created_at,id);
`;
export function pantryTransaction<T>(db: DatabaseSync, action: () => T): T {
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
export function openPantryDatabase(path?: string): DatabaseSync {
  const db = openCommunityDatabase(path);
  if (initialized.has(db)) return db;
  initializeAccountSchema(db);
  db.exec(
    "CREATE TABLE IF NOT EXISTS pantry_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)",
  );
  pantryTransaction(db, () => {
    if (
      !db.prepare("SELECT version FROM pantry_migrations WHERE version=1").get()
    ) {
      db.exec(pantryMigration1);
      db.prepare("INSERT INTO pantry_migrations VALUES(1,?)").run(
        new Date().toISOString(),
      );
    }
  });
  importPantries(db);
  applyMaintainedReview(db);
  initialized.add(db);
  return db;
}
export function importPantries(db: DatabaseSync): number {
  return pantryTransaction(db, () => {
    let imported = 0;
    for (const resource of foodResources) {
      const planner = realPantries.find((p) => p.id === resource.id)!;
      const dates = resource.sources
        .flatMap((s) => (s.checkedOn ? [s.checkedOn] : []))
        .sort();
      const verified = dates.at(-1) || null,
        at = verified ? `${verified}T00:00:00.000Z` : new Date().toISOString();
      const result = db
        .prepare(
          "INSERT OR IGNORE INTO pantries(id,name,address,resource_json,planner_json,website,last_verified,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          resource.id,
          resource.name,
          resource.address,
          JSON.stringify(resource),
          JSON.stringify(planner),
          resource.website ?? null,
          verified,
          at,
          at,
        );
      if (Number(result.changes) === 0) continue;
      savePantryHours(db, resource.id, planner.windows, planner.closures || []);
      recordPantryHistory(db, resource.id, "import", null);
      imported++;
    }
    return imported;
  });
}
/** Apply this dated review only to untouched imports. Manager edits/archives win. */
export function applyMaintainedReview(db: DatabaseSync): number {
  return pantryTransaction(db, () => {
    if (db.prepare("SELECT 1 FROM pantry_migrations WHERE version=2").get())
      return 0;
    let changed = 0;
    for (const id of [
      "bedias-food-pantry",
      "grimes-mobile-pantry",
      "madison-mobile-pantry",
    ]) {
      const row = db
        .prepare(
          "SELECT resource_json,planner_json,version,active FROM pantries WHERE id=?",
        )
        .get(id);
      const resource = foodResources.find((p) => p.id === id);
      const planner = realPantries.find((p) => p.id === id);
      if (!row || !resource || !planner || row.version !== 1 || !row.active)
        continue;
      if (
        row.resource_json === JSON.stringify(resource) &&
        row.planner_json === JSON.stringify(planner)
      )
        continue;
      const date =
        resource.sources
          .flatMap((s) => (s.checkedOn ? [s.checkedOn] : []))
          .sort()
          .at(-1) ?? null;
      db.prepare(
        "UPDATE pantries SET resource_json=?,planner_json=?,last_verified=?,version=version+1,updated_at=? WHERE id=? AND version=1 AND active=1",
      ).run(
        JSON.stringify(resource),
        JSON.stringify(planner),
        date,
        new Date().toISOString(),
        id,
      );
      savePantryHours(db, id, planner.windows, planner.closures ?? []);
      recordPantryHistory(db, id, "maintained-review-2026-10-24", null);
      changed++;
    }
    db.prepare("INSERT INTO pantry_migrations VALUES(2,?)").run(
      new Date().toISOString(),
    );
    return changed;
  });
}
export function savePantryHours(
  db: DatabaseSync,
  id: string,
  windows: PantryWindow[],
  closures: string[],
) {
  db.prepare("DELETE FROM pantry_hours WHERE pantry_id=?").run(id);
  const statement = db.prepare("INSERT INTO pantry_hours VALUES(?,?,?,?)");
  windows.forEach((w, i) => statement.run(id, w.id, i, JSON.stringify(w)));
  db.prepare("DELETE FROM pantry_closures WHERE pantry_id=?").run(id);
  for (const date of new Set(closures))
    db.prepare("INSERT INTO pantry_closures VALUES(?,?)").run(id, date);
}
export function getPantryRecord(
  id: string,
  db = openPantryDatabase(),
): PantryRecord | null {
  const row = db.prepare("SELECT * FROM pantries WHERE id=?").get(id);
  if (!row) return null;
  const resource = JSON.parse(String(row.resource_json)) as Resource;
  const original = JSON.parse(String(row.planner_json)) as Pantry;
  const sameSite =
    resource.address === original.address &&
    resource.coordinates?.lat === original.coordinates?.lat &&
    resource.coordinates?.lng === original.coordinates?.lon;
  const record: Omit<PantryRecord, "scheduleSources"> = {
    ...resource,
    pedestrianPickup:
      resource.pedestrianPickup ??
      (sameSite ? original.pedestrianPickup : "unknown") ??
      "unknown",
    // Older imported databases predate the scheduleNotes field. Preserve their
    // source exceptions until an authorized hours or notes update replaces them.
    scheduleNotes: resource.scheduleNotes ?? original.notes ?? resource.notes,
    id: String(row.id),
    name: String(row.name),
    address: String(row.address),
    active: !!row.active,
    version: Number(row.version),
    website: row.website === null ? null : String(row.website),
    lastVerified: row.last_verified === null ? null : String(row.last_verified),
    windows: db
      .prepare(
        "SELECT window_json FROM pantry_hours WHERE pantry_id=? ORDER BY position",
      )
      .all(id)
      .map((w) => JSON.parse(String(w.window_json))),
    closures: db
      .prepare(
        "SELECT date FROM pantry_closures WHERE pantry_id=? ORDER BY date",
      )
      .all(id)
      .map((c) => String(c.date)),
    updatedAt: String(row.updated_at),
  };
  return { ...record, scheduleSources: currentPantrySources(record, original) };
}
/** Derived source references belong in responses, never the mutable resource row. */
export function serializePantryResource(
  resource: Resource & { scheduleSources?: SourceRef[] },
): string {
  const { scheduleSources: _derivedSources, ...stored } = resource;
  return JSON.stringify(stored);
}
export function listPantryResources(db = openPantryDatabase()): Resource[] {
  return db
    .prepare("SELECT id FROM pantries WHERE active=1 ORDER BY rowid")
    .all()
    .map((row) => getPantryRecord(String(row.id), db)!);
}
/** Retain original source identifiers only while their evidence is still listed. */
function currentPantrySources(
  record: Pick<PantryRecord, "id" | "sources">,
  original: Pantry,
): SourceRef[] {
  const sameSource = (a: SourceRef, b: Resource["sources"][number]) =>
    a.url || b.url ? !!a.url && a.url === b.url : a.title === b.title;
  const mapped = original.sources.flatMap((source) => {
    const current = record.sources.find((candidate) =>
      sameSource(source, candidate),
    );
    return current ? [{ ...source, ...current }] : [];
  });
  record.sources.forEach((source) => {
    if (!original.sources.some((candidate) => sameSource(candidate, source))) {
      // Array positions are not identity: replacing/reordering sources must not
      // let an old schedule reference silently attach to different evidence.
      const identity = source.url
        ? `url:${source.url}`
        : `title:${source.title}`;
      const id = `current-${createHash("sha256").update(identity).digest("hex")}`;
      if (!mapped.some((candidate) => candidate.id === id))
        mapped.push({ ...source, id });
    }
  });
  return mapped;
}
export type PantryScheduleEvidence = {
  windows: PantryWindow[];
  closures: string[];
  notes: string;
  scheduleNotes: string;
  sources: SourceRef[];
};
/** Current public schedule evidence; archived pantries have no public evidence. */
export function getPantryScheduleEvidence(
  id: string,
  db = openPantryDatabase(),
): PantryScheduleEvidence | null {
  const record = getPantryRecord(id, db);
  if (!record?.active) return null;
  return {
    windows: record.windows,
    closures: record.closures,
    notes: record.notes,
    scheduleNotes: record.scheduleNotes ?? "",
    sources: record.scheduleSources,
  };
}
export function listPlannerPantries(db = openPantryDatabase()): Pantry[] {
  return db
    .prepare(
      "SELECT id,planner_json FROM pantries WHERE active=1 ORDER BY rowid",
    )
    .all()
    .map((row) => {
      const original = JSON.parse(String(row.planner_json)) as Pantry,
        p = getPantryRecord(String(row.id), db)!;
      const originalPoint = original.coordinates ?? null;
      const currentPoint = p.coordinates;
      const sameCoordinates =
        originalPoint === null
          ? currentPoint === null
          : currentPoint !== null &&
            originalPoint.lat === currentPoint.lat &&
            originalPoint.lon === currentPoint.lng;
      const sameSite = original.address === p.address && sameCoordinates;
      return {
        ...original,
        id: p.id,
        name: p.name,
        address: p.address,
        phone: p.phone,
        pedestrianPickup: p.pedestrianPickup ?? "unknown",
        sources: p.scheduleSources,
        notes: p.notes,
        accessibility: p.accessibility,
        coordinates: p.coordinates
          ? { lat: p.coordinates.lat, lon: p.coordinates.lng }
          : null,
        windows: p.windows,
        closures: p.closures,
        // A reviewed path is evidence for its original destination only.
        // Preserve the snapshot for audit, but stop routing over it after a move.
        walkConnections: sameSite ? original.walkConnections : [],
        directWalks: sameSite ? original.directWalks : [],
        missingInformation: sameSite
          ? original.missingInformation
          : [
              ...(original.missingInformation ?? []),
              "Pickup location changed; previous walking routes require a new review.",
            ],
      };
    });
}
export function getPantryInventory(
  id: string,
  db = openPantryDatabase(),
): PantryInventoryItem[] {
  return db
    .prepare(
      "SELECT category,status,quantity,source,updated_at FROM pantry_inventory WHERE pantry_id=? ORDER BY category",
    )
    .all(id)
    .map((r) => ({
      category: String(r.category),
      status: r.status as PantryInventoryItem["status"],
      quantity: r.quantity === null ? null : Number(r.quantity),
      source: String(r.source),
      updatedAt: String(r.updated_at),
    }));
}
export function canEditPantry(
  db: DatabaseSync,
  actor: AccountActor | null,
  id: string,
): boolean {
  return (
    !!actor &&
    actor.emailVerified &&
    (actor.role === "administrator" ||
      !!db
        .prepare(
          "SELECT 1 FROM pantry_managers WHERE pantry_id=? AND user_id=?",
        )
        .get(id, actor.id))
  );
}
export function pantryAudit(
  db: DatabaseSync,
  actor: string | null,
  action: string,
  id: string | null,
  details: unknown = {},
) {
  db.prepare(
    "INSERT INTO pantry_audit(actor_id,action,pantry_id,details_json,created_at) VALUES(?,?,?,?,?)",
  ).run(actor, action, id, JSON.stringify(details), new Date().toISOString());
}
export function recordPantryHistory(
  db: DatabaseSync,
  id: string,
  action: string,
  actor: string | null,
) {
  const pantry = getPantryRecord(id, db)!;
  const { scheduleSources: _derivedSources, ...historicalPantry } = pantry;
  db.prepare(
    "INSERT INTO pantry_history(pantry_id,version,action,actor_id,snapshot_json,created_at) VALUES(?,?,?,?,?,?)",
  ).run(
    id,
    pantry.version,
    action,
    actor,
    JSON.stringify({
      pantry: historicalPantry,
      inventory: getPantryInventory(id, db),
    }),
    new Date().toISOString(),
  );
  pantryAudit(db, actor, action, id, { version: pantry.version });
  if (actor) {
    const recipients = new Set([
      actor,
      ...db
        .prepare(
          "SELECT user_id FROM pantry_managers WHERE pantry_id=? LIMIT 100",
        )
        .all(id)
        .map((row) => String(row.user_id)),
    ]);
    for (const userId of recipients)
      queueNotification(db, {
        eventKey: `pantry:${id}:${pantry.version}:${action}`,
        userId,
        category: "pantry",
        kind: "pantry-updated",
        resourceType: "pantry",
        resourceId: id,
      });
  }
}
export function createPantry(
  db: DatabaseSync,
  resource: Resource,
  actor: string,
  website: string | null,
  lastVerified: string | null,
) {
  const at = new Date().toISOString(),
    id = resource.id || randomUUID();
  const planner: Pantry = {
    id,
    name: resource.name,
    address: resource.address,
    coordinates: resource.coordinates
      ? { lat: resource.coordinates.lat, lon: resource.coordinates.lng }
      : null,
    windows: [],
    walkConnections: [],
    directWalks: [],
    sources: resource.sources.map((s, i) => ({ ...s, id: `source-${i}` })),
  };
  db.prepare(
    "INSERT INTO pantries(id,name,address,resource_json,planner_json,website,last_verified,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    resource.name,
    resource.address,
    JSON.stringify({ ...resource, id }),
    JSON.stringify(planner),
    website,
    lastVerified,
    at,
    at,
  );
  recordPantryHistory(db, id, "create", actor);
  return getPantryRecord(id, db)!;
}
