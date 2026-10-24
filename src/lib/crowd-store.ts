import { createHmac, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  accountFail,
  accountRate,
  accountTransaction,
  getAccountActor,
} from "./account-store";
import { aggregateCrowd, chicagoParts, type CrowdObservation } from "./crowd";
import type { BusySummary } from "./crowd-types";
import { getPantryScheduleEvidence } from "./pantry-store";
import { matchesRule } from "./recurrence";
import { isDate, parseTime } from "./time";

type Row = Record<string, string | number | null>;
const MAX_AGE = 90 * 86400000;
export function initializeCrowdSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS crowd_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crowd_buckets(pantry_id TEXT NOT NULL REFERENCES pantries(id) ON DELETE CASCADE,slot_start TEXT NOT NULL,local_date TEXT NOT NULL,weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),reports INTEGER NOT NULL CHECK(reports>0),level_sum INTEGER NOT NULL,wait_sum INTEGER NOT NULL DEFAULT 0,wait_count INTEGER NOT NULL DEFAULT 0,staff_reports INTEGER NOT NULL DEFAULT 0,last_updated TEXT NOT NULL,PRIMARY KEY(pantry_id,slot_start));
    CREATE INDEX IF NOT EXISTS crowd_bucket_history ON crowd_buckets(pantry_id,slot_start);
    CREATE TABLE IF NOT EXISTS crowd_dedup(dedupe_hash TEXT PRIMARY KEY,expires_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS crowd_dedup_expiry ON crowd_dedup(expires_at);`);
  if (
    !db
      .prepare("SELECT value FROM crowd_metadata WHERE key='dedup_secret'")
      .get()
  ) {
    db.prepare(
      "INSERT OR IGNORE INTO crowd_metadata(key,value) VALUES('dedup_secret',?)",
    ).run(randomBytes(32).toString("hex"));
  }
}
export function pruneCrowdData(db: DatabaseSync, now = new Date()) {
  initializeCrowdSchema(db);
  const dedupCutoff = now.toISOString();
  const bucketCutoff = new Date(now.getTime() - MAX_AGE).toISOString();
  return accountTransaction(db, () => {
    const dedup = db
      .prepare("DELETE FROM crowd_dedup WHERE expires_at<=?")
      .run(dedupCutoff);
    const buckets = db
      .prepare("DELETE FROM crowd_buckets WHERE slot_start<?")
      .run(bucketCutoff);
    return {
      dedupHashes: Number(dedup.changes),
      buckets: Number(buckets.changes),
    };
  });
}
function secret(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT value FROM crowd_metadata WHERE key='dedup_secret'")
    .get() as Row | undefined;
  if (!row?.value) throw new Error("Crowd deduplication secret is unavailable");
  return String(row.value);
}
function manager(db: DatabaseSync, pantryId: string, actorId: string): boolean {
  try {
    return !!db
      .prepare("SELECT 1 FROM pantry_managers WHERE pantry_id=? AND user_id=?")
      .get(pantryId, actorId);
  } catch {
    return false;
  }
}
function pantryActive(db: DatabaseSync, pantryId: string): boolean {
  try {
    return !!db
      .prepare("SELECT 1 FROM pantries WHERE id=? AND active=1")
      .get(pantryId);
  } catch {
    return false;
  }
}
function observation(row: Row): CrowdObservation {
  return {
    weekday: Number(row.weekday),
    hour: Number(row.hour),
    localDate: String(row.local_date),
    level: Number(row.level_sum) / Number(row.reports),
    waitMinutes: Number(row.wait_count)
      ? Number(row.wait_sum) / Number(row.wait_count)
      : null,
    waitReports: Number(row.wait_count),
    observedAt: String(row.first_observed_at ?? row.slot_start),
    updatedAt: String(row.last_updated),
    reports: Number(row.reports),
  };
}
function verifiedFutureDistributionHours(
  db: DatabaseSync,
  pantryId: string,
  at: Date,
) {
  const evidence = getPantryScheduleEvidence(pantryId, db);
  if (
    !evidence?.windows.length ||
    evidence.closures.some((date) => !isDate(date)) ||
    /programmed closures?|closure dates?|except game days|game-day/i.test(
      evidence.scheduleNotes,
    )
  )
    return null;
  const local = chicagoParts(at);
  if (evidence.closures.includes(local.localDate)) return null;
  const matching = evidence.windows.filter((window) =>
    matchesRule(window.rule, local.localDate),
  );
  if (!matching.length) return null;
  const sourceIds = new Set(
    evidence.sources
      .filter((source) => source.fictional !== true)
      .map((source) => source.id),
  );
  const normalized: {
    opens: number;
    registrationOpens: number;
    registrationCutoff: number | null;
    distributionCutoff: number;
  }[] = [];
  try {
    for (const window of matching) {
      if (
        !window.policyKnown ||
        window.conflictingSources ||
        window.appointmentRequired !== false ||
        !window.sourceIds.length ||
        !window.sourceIds.every((id) => sourceIds.has(id))
      )
        return null;
      const opens = parseTime(window.opens);
      normalized.push({
        opens,
        registrationOpens: window.registrationOpens
          ? parseTime(window.registrationOpens)
          : opens,
        registrationCutoff: window.registrationCutoff
          ? parseTime(window.registrationCutoff)
          : null,
        distributionCutoff: parseTime(
          window.distributionCutoff ?? window.closes,
          true,
        ),
      });
    }
  } catch {
    return null;
  }
  const hours: { weekday: number; hour: number }[] = [];
  for (let hour = local.hour + 1; hour < 24; hour++) {
    const start = hour * 60,
      end = start + 60;
    if (
      normalized.some(
        (window) =>
          window.opens <= start &&
          window.registrationOpens <= start &&
          (window.registrationCutoff === null ||
            end <= window.registrationCutoff) &&
          window.distributionCutoff >= end,
      )
    )
      hours.push({ weekday: local.weekday, hour });
  }
  return hours;
}
export function getCrowdSummary(
  db: DatabaseSync,
  pantryId: string,
  at = new Date(),
): BusySummary | null {
  initializeCrowdSchema(db);
  pruneCrowdData(db, at);
  if (!pantryActive(db, pantryId)) return null;
  const cutoff = new Date(at.getTime() - MAX_AGE).toISOString();
  const rows = db
    .prepare(
      "SELECT local_date,weekday,hour,SUM(reports) reports,SUM(level_sum) level_sum,SUM(wait_sum) wait_sum,SUM(wait_count) wait_count,MAX(last_updated) last_updated,MIN(slot_start) first_observed_at FROM crowd_buckets WHERE pantry_id=? AND slot_start>=? AND slot_start<=? GROUP BY local_date,weekday,hour",
    )
    .all(pantryId, cutoff, at.toISOString()) as Row[];
  const recentRows = db
    .prepare(
      "SELECT local_date,weekday,hour,reports,level_sum,wait_sum,wait_count,last_updated,slot_start FROM crowd_buckets WHERE pantry_id=? AND slot_start>=? AND slot_start<=?",
    )
    .all(
      pantryId,
      new Date(at.getTime() - 60 * 60000).toISOString(),
      at.toISOString(),
    ) as Row[];
  return aggregateCrowd({
    pantryId,
    observations: rows.map(observation),
    recent: recentRows.map(observation),
    now: at,
    verifiedHourRestriction: verifiedFutureDistributionHours(db, pantryId, at),
  });
}
export function submitCrowdReport(
  db: DatabaseSync,
  request: Request,
  pantryId: string,
  body: { level: number; waitMinutes?: number },
  at = new Date(),
): { ok: true } {
  initializeCrowdSchema(db);
  const actor = getAccountActor(db, request);
  if (!actor) accountFail(401, "Sign in to submit a report.");
  if (!actor.emailVerified)
    accountFail(403, "Verify your email address to submit a report.");
  if (!pantryActive(db, pantryId)) accountFail(404, "Pantry not found.");
  pruneCrowdData(db, at);
  accountRate(db, `crowd:account:${actor.id}`, 5, 3600, at.getTime());
  accountRate(db, "crowd:global", 600, 60, at.getTime());
  const local = chicagoParts(at);
  const dayExpiry = new Date(
    Date.UTC(
      Number(local.localDate.slice(0, 4)),
      Number(local.localDate.slice(5, 7)) - 1,
      Number(local.localDate.slice(8)) + 2,
    ),
  ).toISOString();
  const dedupe = createHmac("sha256", secret(db))
    .update(`${local.localDate}\0${actor.id}\0${pantryId}`)
    .digest("hex");
  const staff =
    actor.role === "administrator" || manager(db, pantryId, actor.id);
  accountTransaction(db, () => {
    try {
      db.prepare(
        "INSERT INTO crowd_dedup(dedupe_hash,expires_at) VALUES(?,?)",
      ).run(dedupe, dayExpiry);
    } catch {
      accountFail(429, "You already reported for this pantry today.");
    }
    const bucketStart = new Date(
      Math.floor(at.getTime() / 300000) * 300000,
    ).toISOString();
    const wait = body.waitMinutes ?? null;
    db.prepare(
      `INSERT INTO crowd_buckets(pantry_id,slot_start,local_date,weekday,hour,reports,level_sum,wait_sum,wait_count,staff_reports,last_updated)
      VALUES(?,?,?,?,?,1,?,?,?, ?,?) ON CONFLICT(pantry_id,slot_start) DO UPDATE SET reports=reports+1,level_sum=level_sum+excluded.level_sum,wait_sum=wait_sum+excluded.wait_sum,wait_count=wait_count+excluded.wait_count,staff_reports=staff_reports+excluded.staff_reports,last_updated=excluded.last_updated`,
    ).run(
      pantryId,
      bucketStart,
      local.localDate,
      local.weekday,
      local.hour,
      body.level,
      wait ?? 0,
      wait === null ? 0 : 1,
      staff ? 1 : 0,
      at.toISOString(),
    );
  });
  return { ok: true };
}
