import { openPantryDatabase } from "../src/lib/pantry-store";
import { dispatchNotifications } from "../src/lib/notifications-worker";
import { dispatchOutreach } from "../src/lib/outreach-worker";
const args = process.argv.slice(2);
if (args.some((arg) => !["--once", "--watch"].includes(arg)) || args.length > 1)
  throw new Error("Use npm run mail:worker -- --once or --watch.");
const watch = args[0] === "--watch";
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
do {
  const db = openPantryDatabase();
  const result = await dispatchNotifications(db);
  const outreach = await dispatchOutreach(db);
  console.log(
    JSON.stringify({ event: "notification_dispatch", ...result, outreach }),
  );
  if (result.unavailable && !watch) process.exitCode = 1;
  if (watch && !stopped)
    await new Promise((resolve) => setTimeout(resolve, 5000));
} while (watch && !stopped);
