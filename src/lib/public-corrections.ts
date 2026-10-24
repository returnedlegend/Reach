import { z } from "zod";
import { randomUUID } from "node:crypto";
import { openPantryDatabase } from "./pantry-store";
import { accountRate, AccountError } from "./account-store";
import {
  requireSameOrigin,
  readPrivateJson,
  privateResponse,
  accessFailure,
} from "./access-http";

/** Reports are private suggestions. They never update authoritative records. */
export function createPublicCorrectionHandler(
  databasePath?: string,
  now = () => new Date(),
) {
  return async (request: Request, pantryId: string) => {
    try {
      requireSameOrigin(request);
      const { description } = await readPrivateJson(
        request,
        z.object({ description: z.string().trim().min(10).max(2000) }).strict(),
      );
      const db = openPantryDatabase(databasePath);
      if (
        !/^[a-zA-Z0-9_-]{1,100}$/.test(pantryId) ||
        !db
          .prepare("SELECT 1 FROM pantries WHERE id=? AND active=1")
          .get(pantryId)
      )
        throw new AccountError(404, "Pantry not found.");
      const at = now();
      prunePublicCorrections(db, at);
      accountRate(db, "public-correction:all", 30, 3600, +at);
      accountRate(db, `public-correction:${pantryId}`, 5, 3600, +at);
      const duplicate = db
        .prepare(
          "SELECT 1 FROM pantry_corrections WHERE pantry_id=? AND description=? AND submitted_by IS NULL AND created_at>?",
        )
        .get(pantryId, description, new Date(+at - 86400000).toISOString());
      if (!duplicate)
        db.prepare(
          "INSERT INTO pantry_corrections(id,pantry_id,submitted_by,description,status,created_at) VALUES(?,?,NULL,?,'pending',?)",
        ).run(randomUUID(), pantryId, description, at.toISOString());
      return privateResponse(
        {
          message:
            "Report recorded for review. It does not change the listing or guarantee a response. Contact the organization before travel.",
        },
        202,
      );
    } catch (error) {
      return accessFailure(error);
    }
  };
}
export function prunePublicCorrections(
  db: ReturnType<typeof openPantryDatabase>,
  now = new Date(),
) {
  return Number(
    db
      .prepare(
        "DELETE FROM pantry_corrections WHERE submitted_by IS NULL AND created_at<?",
      )
      .run(new Date(+now - 90 * 86400000).toISOString()).changes,
  );
}
