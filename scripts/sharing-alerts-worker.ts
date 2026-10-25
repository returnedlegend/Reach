import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
import { openCommunityDatabase } from "../src/lib/community";
import { dispatchSharingAlerts } from "../src/lib/sharing-alerts-worker";

const args = process.argv.slice(2);
if (
  args.length > 1 ||
  args.some((value) => !["--once", "--watch"].includes(value))
)
  throw new Error("Use --once or --watch.");
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
  });

do {
  const result = await dispatchSharingAlerts(openCommunityDatabase());
  console.log(JSON.stringify({ event: "sharing-alert-dispatch", ...result }));
  if (result.unavailable && args[0] !== "--watch") process.exitCode = 1;
  if (args[0] === "--watch" && !stopped)
    await new Promise((resolve) => setTimeout(resolve, 5000));
} while (args[0] === "--watch" && !stopped);
