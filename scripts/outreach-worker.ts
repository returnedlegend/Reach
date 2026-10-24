import { openPantryDatabase } from "../src/lib/pantry-store";
import { dispatchOutreach } from "../src/lib/outreach-worker";
const args = process.argv.slice(2);
if (args.length > 1 || args.some((v) => !["--once", "--watch"].includes(v)))
  throw new Error("Use --once or --watch.");
let stopped = false;
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    stopped = true;
  });
do {
  const result = await dispatchOutreach(openPantryDatabase());
  console.log(JSON.stringify({ event: "outreach-dispatch", ...result }));
  if (result.unavailable && args[0] !== "--watch") process.exitCode = 1;
  if (args[0] === "--watch" && !stopped)
    await new Promise((resolve) => setTimeout(resolve, 5000));
} while (args[0] === "--watch" && !stopped);
