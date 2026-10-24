import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Loopback-only development entry point. Publication needs a separate review.
const next = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);
// Community is opt-in. Normal development respects Next's environment settings.
const args = process.argv.slice(2);
const enableCommunity = args.includes("--community");
const nextArgs = args.filter((arg) => arg !== "--community");
const child = spawn(
  process.execPath,
  [
    next,
    "dev",
    // Stable private-file preview workflow; Turbopack currently reloads continuously.
    ...(nextArgs.includes("--webpack") ||
    nextArgs.includes("--turbopack") ||
    nextArgs.includes("--turbo")
      ? []
      : ["--webpack"]),
    "--hostname",
    "127.0.0.1",
    ...nextArgs,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(enableCommunity ? { REACH_COMMUNITY_ENABLED: "true" } : {}),
    },
  },
);
child.on("error", () => {
  console.error("Could not start Reach. Run npm ci first.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
