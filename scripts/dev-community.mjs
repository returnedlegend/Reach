import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Loopback-only development entry point. Publication needs a separate review.
const next = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);
const child = spawn(
  process.execPath,
  [
    next,
    "dev",
    // Stable private-file preview workflow; Turbopack currently reloads continuously.
    ...(process.argv.includes("--webpack") || process.argv.includes("--turbopack") || process.argv.includes("--turbo") ? [] : ["--webpack"]),
    "--hostname", "127.0.0.1", ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: { ...process.env, REACH_COMMUNITY_ENABLED: "true" },
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
