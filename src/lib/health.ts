import { openPantryDatabase } from "./pantry-store";

/** Database readiness only. Never reveals configuration, private counts or errors. */
export function databaseHealth(databasePath?: string): Response {
  let ready = false;
  try {
    openPantryDatabase(databasePath).prepare("SELECT 1").get();
    ready = true;
  } catch {
    // Optional remote providers are deliberately outside this readiness check.
  }
  return Response.json(
    { status: ready ? "ok" : "unavailable" },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
