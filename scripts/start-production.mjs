import { spawn } from "node:child_process";
import { cpSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = join(projectRoot, ".next", "standalone");
const serverPath = join(standaloneRoot, "server.js");
const staticSource = join(projectRoot, ".next", "static");
const staticDestination = join(standaloneRoot, ".next", "static");
const publicSource = join(projectRoot, "public");
const publicDestination = join(standaloneRoot, "public");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(args) {
  let port = process.env.PORT || "3000";
  let hostname = process.env.REACH_BIND_HOST || "127.0.0.1";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const [flag, inlineValue] = arg.split(/=(.*)/s, 2);
    if (flag === "--help" || flag === "-h") {
      process.stdout.write(
        "Usage: npm start [-- --port PORT] [--hostname HOST]\n" +
          "Set REACH_BIND_HOST to choose the default bind host (default: 127.0.0.1).\n",
      );
      process.exit(0);
    }

    const option =
      flag === "--port" || flag === "-p"
        ? "port"
        : flag === "--hostname" || flag === "-H"
          ? "hostname"
          : null;
    if (!option) fail(`Unknown production start option: ${flag}`);

    let value = inlineValue;
    if (value === undefined) {
      value = args[++index];
      if (!value || value.startsWith("-")) fail(`Missing value for ${flag}.`);
    }
    if (option === "port") port = value;
    else hostname = value;
  }

  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    fail("The production server port must be an integer from 1 to 65535.");
  if (!hostname || /[\s\0]/.test(hostname))
    fail("The production server hostname is invalid.");
  return { port: String(Number(port)), hostname };
}

process.env.NODE_ENV = "production";
loadEnvConfig(projectRoot, false, { info() {}, error() {} });

const { port, hostname } = parseArgs(process.argv.slice(2));
// Standalone changes its working directory. Keep existing local data at the
// project-relative path used by development and the former start command.
const databasePath = resolve(
  projectRoot,
  process.env.REACH_COMMUNITY_DB || ".local/community.sqlite",
);
if (!existsSync(serverPath) || !statSync(serverPath).isFile())
  fail(
    "Production standalone output is missing. Run npm run build before npm start.",
  );
if (!existsSync(staticSource) || !statSync(staticSource).isDirectory())
  fail(
    "Production static build assets are missing. Run npm run build before npm start.",
  );

try {
  cpSync(staticSource, staticDestination, { recursive: true, force: true });
  if (existsSync(publicSource)) {
    if (!statSync(publicSource).isDirectory())
      fail("The public asset path is not a directory.");
    cpSync(publicSource, publicDestination, { recursive: true, force: true });
  }
} catch {
  fail(
    "Could not prepare the standalone runtime assets. Check build output permissions.",
  );
}

const child = spawn(process.execPath, [serverPath], {
  cwd: standaloneRoot,
  env: {
    ...process.env,
    REACH_COMMUNITY_DB: databasePath,
    PORT: port,
    HOSTNAME: hostname,
  },
  stdio: "inherit",
});
let shuttingDown = false;
let forceKillTimer;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    shuttingDown = true;
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill(signal);
    forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    forceKillTimer.unref();
  });
}

child.once("error", () => {
  process.stderr.write("Could not start the standalone production server.\n");
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (shuttingDown && signal) {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    return;
  }
  process.exitCode = code ?? 1;
});
