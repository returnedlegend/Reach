import { featureEnabled } from "./release-features";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  AccountError,
  accountFail as fail,
  accountRate,
  getAccountActor,
  requireAccountActor,
  type AccountActor,
} from "./account-store";
import { accountRequestOrigin } from "./auth-origin";
import {
  openPantryDatabase,
  pantryTransaction,
  canEditPantry,
} from "./pantry-store";
import {
  initializeVolunteerSchema,
  offerHasVolunteerRun,
} from "./volunteer-store";
import { initializeNotifications } from "./notifications-store";
import { COMMUNITY_PICKUP_AREAS } from "./community-types";
import type { ManagedVolunteerRun, VolunteerRun } from "./volunteer-types";

type Row = Record<string, string | number | null>;
const empty = z.object({}).strict();
const create = z
  .object({
    offerId: z.string().min(1).max(64),
    pantryId: z.string().min(1).max(128),
  })
  .strict();
const claim = z.object({ pickupConsent: z.literal(true) }).strict();
const at = () => new Date().toISOString();
const get = (db: DatabaseSync, sql: string, ...args: (string | number)[]) =>
  db.prepare(sql).get(...args) as Row | undefined;
const rows = (db: DatabaseSync, sql: string, ...args: (string | number)[]) =>
  db.prepare(sql).all(...args) as Row[];
const reply = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
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
function participant(db: DatabaseSync, userId: string) {
  return !!get(
    db,
    "SELECT 1 FROM notification_preferences WHERE user_id=? AND volunteer_participation=1",
    userId,
  );
}
function run(db: DatabaseSync, id: string) {
  return (
    get(
      db,
      "SELECT v.*,r.data,r.starts_at,r.ends_at,r.status offer_status,p.name pantry_name,p.active pantry_active FROM volunteer_runs v JOIN records r ON r.id=v.offer_id JOIN pantries p ON p.id=v.pantry_id WHERE v.id=?",
      id,
    ) || fail(404, "Donation run not found.")
  );
}
function active(row: Row) {
  return (
    row.offer_status === "approved" &&
    !!row.pantry_active &&
    String(row.ends_at) > at()
  );
}
function manager(db: DatabaseSync, actor: AccountActor, row: Row) {
  return canEditPantry(db, actor, String(row.pantry_id));
}
function allowed(db: DatabaseSync, actor: AccountActor, row: Row) {
  return (
    actor.id === row.donor_id ||
    actor.id === row.volunteer_id ||
    manager(db, actor, row)
  );
}
function assertUnblocked(db: DatabaseSync, actor: AccountActor, row: Row) {
  const ids = [row.donor_id, row.volunteer_id].filter(
    (id): id is string => typeof id === "string" && id !== actor.id,
  );
  if (
    ids.some((id) => blocked(db, actor.id, id)) ||
    (actor.id !== row.donor_id &&
      !manager(db, actor, row) &&
      get(
        db,
        "SELECT 1 FROM pantry_managers m JOIN blocks b ON (b.user_id=m.user_id AND b.blocked_id=?) OR (b.blocked_id=m.user_id AND b.user_id=?) WHERE m.pantry_id=?",
        actor.id,
        actor.id,
        String(row.pantry_id),
      ))
  )
    fail(403, "This donation run is not available.");
}
function serialize(row: Row): VolunteerRun {
  const data = JSON.parse(String(row.data));
  return {
    id: String(row.id),
    offerId: String(row.offer_id),
    pantryId: String(row.pantry_id),
    pantryName: String(row.pantry_name),
    offerTitle: data.title,
    pickupAreaId: data.pickupAreaId,
    quantity: data.quantity,
    foodCategory: data.foodCategory,
    allergens: data.allergens,
    storage: data.storage,
    useBy: data.useBy,
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    status: row.status as VolunteerRun["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function managed(
  db: DatabaseSync,
  actor: AccountActor,
  row: Row,
): ManagedVolunteerRun {
  const own = actor.id === row.donor_id,
    edit = manager(db, actor, row),
    assigned = actor.id === row.volunteer_id && row.status === "assigned",
    live = active(row),
    activeStatus = ["pending", "open", "assigned"].includes(String(row.status));
  const sharing = !!JSON.parse(String(row.data)).sharePickupInstructions;
  let unblocked = true;
  try {
    assertUnblocked(db, actor, row);
  } catch {
    unblocked = false;
  }
  return {
    ...serialize(row),
    donorId: String(row.donor_id),
    volunteerId: row.volunteer_id === null ? null : String(row.volunteer_id),
    canApprove: edit && !own && row.status === "pending" && live && unblocked,
    canCancel: activeStatus && (own || edit || assigned),
    canComplete:
      live &&
      unblocked &&
      row.status === "assigned" &&
      (own || edit) &&
      String(row.starts_at) <= at(),
    canRelease: assigned,
    canViewPickup:
      live &&
      unblocked &&
      activeStatus &&
      (own ||
        (assigned &&
          actor.emailVerified &&
          participant(db, actor.id) &&
          !!row.pickup_consent &&
          sharing)),
  };
}
async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (request.headers.get("origin") !== accountRequestOrigin(request))
    fail(403, "A same-origin request is required.");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail(415, "Send application/json.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Send a JSON body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      fail(413, "Request is too large.");
    }
    chunks.push(part.value);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "Send valid JSON.");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    fail(400, "Check the required fields and pickup consent.");
  return parsed.data;
}
export function createVolunteerHandler(databasePath?: string) {
  return async (
    request: Request,
    suppliedParts?: string[],
  ): Promise<Response> => {
    try {
      if (!featureEnabled("volunteering"))
        fail(404, "Volunteer coordination is not enabled.");
      const db = openPantryDatabase(databasePath);
      initializeVolunteerSchema(db);
      initializeNotifications(db);
      const parts =
        suppliedParts ||
        new URL(request.url).pathname
          .replace(/^\/api\/volunteer\/?/, "")
          .split("/")
          .filter(Boolean);
      if (
        parts.length > 2 ||
        !parts.every((p) => /^[a-zA-Z0-9_-]{1,128}$/.test(p))
      )
        fail(404, "Not found.");
      const [id, action] = parts,
        actor = getAccountActor(db, request);
      if (request.method === "GET") {
        if (parts.length === 0) {
          const found = rows(
            db,
            "SELECT v.id FROM volunteer_runs v JOIN records r ON r.id=v.offer_id JOIN pantries p ON p.id=v.pantry_id WHERE v.status='open' AND r.status='approved' AND r.ends_at>? AND p.active=1 ORDER BY r.ends_at,v.id LIMIT 100",
            at(),
          );
          return reply({
            runs: found
              .map((r) => run(db, String(r.id)))
              .filter((r) => {
                if (!actor) return true;
                try {
                  assertUnblocked(db, actor, r);
                  return true;
                } catch {
                  return false;
                }
              })
              .map(serialize),
          });
        }
        const user = requireAccountActor(db, request);
        if (id === "mine" && parts.length === 1) {
          const found = rows(
            db,
            "SELECT v.id FROM volunteer_runs v WHERE v.donor_id=? OR v.volunteer_id=? OR EXISTS(SELECT 1 FROM pantry_managers m WHERE m.pantry_id=v.pantry_id AND m.user_id=?) OR ?='administrator' ORDER BY v.updated_at DESC,v.id LIMIT 200",
            user.id,
            user.id,
            user.emailVerified ? user.id : "",
            user.emailVerified ? user.role : "user",
          );
          return reply({
            runs: found
              .map((r) => run(db, String(r.id)))
              .map((r) => managed(db, user, r)),
            participationEnabled: participant(db, user.id),
            emailVerified: user.emailVerified,
          });
        }
        if (id === "eligible-offers" && parts.length === 1) {
          if (!user.emailVerified)
            fail(403, "Verify your email address to continue.");
          const found = rows(
            db,
            "SELECT r.* FROM records r WHERE r.owner_id=? AND r.kind='offer' AND r.status='approved' AND r.ends_at>? AND NOT EXISTS(SELECT 1 FROM requests q WHERE q.offer_id=r.id AND q.status IN ('requested','accepted')) ORDER BY r.ends_at LIMIT 100",
            user.id,
            at(),
          ).filter((r) => !offerHasVolunteerRun(db, String(r.id)));
          return reply({
            offers: found.map((r) => {
              const d = JSON.parse(String(r.data));
              return {
                offerId: r.id,
                offerTitle: d.title,
                startsAt: r.starts_at,
                endsAt: r.ends_at,
                quantity: d.quantity,
                pickupAreaId: d.pickupAreaId,
              };
            }),
          });
        }
        if (action === "pickup") {
          const row = run(db, id);
          assertUnblocked(db, user, row);
          if (!allowed(db, user, row) || !managed(db, user, row).canViewPickup)
            fail(
              403,
              "Pickup details require an active assignment and mutual consent.",
            );
          if (
            user.id !== row.donor_id &&
            (!user.emailVerified || !participant(db, user.id))
          )
            fail(403, "Verified volunteer participation is required.");
          const data = JSON.parse(String(row.data));
          return reply({
            instructions: data.privatePickupInstructions,
            area: COMMUNITY_PICKUP_AREAS.find(
              (a) => a.id === data.pickupAreaId,
            ),
          });
        }
        fail(404, "Not found.");
      }
      if (request.method !== "POST") fail(405, "Method not allowed.");
      let user = requireAccountActor(db, request, { verified: true });
      const data = await body(
        request,
        parts.length === 0 ? create : action === "claim" ? claim : empty,
      );
      const refreshActor = () => {
        const current = requireAccountActor(db, request, { verified: true });
        if (current.id !== user.id) fail(401, "Sign in again to continue.");
        user = current;
      };
      accountRate(db, `volunteer:${user.id}`, 60, 3600);
      if (parts.length === 0) {
        const payload = create.parse(data);
        const newId = randomUUID();
        pantryTransaction(db, () => {
          refreshActor();
          const offer =
            get(db, "SELECT * FROM records WHERE id=?", payload.offerId) ||
            fail(404, "Offer not found.");
          if (offer.owner_id !== user.id)
            fail(403, "Only the donor can offer a donation run.");
          if (
            offer.kind !== "offer" ||
            offer.status !== "approved" ||
            String(offer.ends_at) <= at()
          )
            fail(409, "Choose an approved, active food offer.");
          if (
            !get(
              db,
              "SELECT 1 FROM pantries WHERE id=? AND active=1",
              payload.pantryId,
            )
          )
            fail(404, "Choose an active pantry.");
          if (
            offerHasVolunteerRun(db, payload.offerId) ||
            get(
              db,
              "SELECT 1 FROM requests WHERE offer_id=? AND status IN ('requested','accepted')",
              payload.offerId,
            )
          )
            fail(409, "This offer already has a food request or donation run.");
          const stamp = at();
          db.prepare(
            "INSERT INTO volunteer_runs(id,offer_id,pantry_id,donor_id,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)",
          ).run(
            newId,
            payload.offerId,
            payload.pantryId,
            user.id,
            stamp,
            stamp,
          );
        });
        return reply({ run: managed(db, user, run(db, newId)) }, 201);
      }
      if (
        parts.length !== 2 ||
        ![
          "approve",
          "decline",
          "claim",
          "cancel",
          "release",
          "complete",
        ].includes(action)
      )
        fail(404, "Not found.");
      pantryTransaction(db, () => {
        refreshActor();
        const row = run(db, id),
          edit = manager(db, user, row),
          own = row.donor_id === user.id,
          assigned = row.volunteer_id === user.id && row.status === "assigned";
        if (action !== "cancel" && action !== "release")
          assertUnblocked(db, user, row);
        let status = String(row.status),
          volunteer = row.volunteer_id,
          consent = Number(row.pickup_consent),
          kind:
            | "assignment-confirmed"
            | "pickup-completed"
            | "pickup-cancelled"
            | "donation-changed" = "donation-changed";
        if (action === "approve" || action === "decline") {
          if (!edit || own)
            fail(
              403,
              "A separate assigned pantry manager or administrator must review this donation.",
            );
          if (row.status !== "pending" || !active(row))
            fail(409, "This donation is no longer awaiting review.");
          status = action === "approve" ? "open" : "cancelled";
          kind = action === "decline" ? "pickup-cancelled" : "donation-changed";
        } else if (action === "claim") {
          if (!participant(db, user.id))
            fail(
              403,
              "Enable volunteer participation in account preferences before claiming.",
            );
          if (own || edit)
            fail(
              403,
              "You cannot claim your own donation or a run for a pantry you manage.",
            );
          if (row.status !== "open" || !active(row))
            fail(409, "This donation run is no longer available.");
          if (
            get(
              db,
              "SELECT 1 FROM requests WHERE offer_id=? AND status IN ('requested','accepted')",
              String(row.offer_id),
            )
          )
            fail(409, "This food already has a recipient request.");
          if (
            get(
              db,
              "SELECT 1 FROM volunteer_runs WHERE volunteer_id=? AND status='assigned'",
              user.id,
            )
          )
            fail(409, "Complete or release your current assignment first.");
          status = "assigned";
          volunteer = user.id;
          consent = 1;
          kind = "assignment-confirmed";
        } else if (action === "complete") {
          if (!own && !edit)
            fail(
              403,
              "The donor or assigned pantry manager must confirm completion.",
            );
          if (
            row.status !== "assigned" ||
            !active(row) ||
            String(row.starts_at) > at()
          )
            fail(
              409,
              "Completion requires an active assignment after the pickup window starts.",
            );
          status = "completed";
          kind = "pickup-completed";
        } else {
          if (!own && !edit && !assigned)
            fail(403, "This donation run is private.");
          if (!["pending", "open", "assigned"].includes(status))
            fail(409, "This donation run is already closed.");
          if (action === "release" && !assigned)
            fail(403, "Only the assigned volunteer may release the run.");
          if (assigned && !own && !edit) {
            status = active(row) ? "open" : "cancelled";
            volunteer = null;
            consent = 0;
          } else status = "cancelled";
          kind = "pickup-cancelled";
        }
        db.prepare(
          "UPDATE volunteer_runs SET status=?,volunteer_id=?,pickup_consent=?,revision=revision+1,updated_at=? WHERE id=?",
        ).run(status, volunteer, consent, at(), id);
        if (action === "complete")
          db.prepare(
            "UPDATE records SET status='ended',updated_at=? WHERE id=?",
          ).run(at(), String(row.offer_id));
      });
      return reply({ run: managed(db, user, run(db, id)) });
    } catch (error) {
      if (error instanceof AccountError)
        return reply({ error: error.message }, error.status);
      console.error(
        "Volunteer API failure",
        error instanceof Error ? error.name : "unknown",
      );
      return reply({ error: "Unable to process this donation run." }, 500);
    }
  };
}
