import { access, open, readFile, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { pathToFileURL } from "node:url";

const expectedDatabase = "/var/lib/reach/community.sqlite";
const publicNominatimOrigin = "https://nominatim.openstreetmap.org";

function validOsmUserAgent(value: string | undefined) {
  const userAgent = value?.trim();
  return Boolean(
    userAgent &&
      userAgent.length <= 300 &&
      !/[\r\n]/.test(userAgent) &&
      /\breach\b/i.test(userAgent) &&
      /(https?:\/\/\S+|[^\s]+@[^\s]+\.[^\s]+)/.test(userAgent) &&
      !/(example\.(com|org|net)|your[-_ ]?(project|domain|app)|placeholder|replace[-_ ]?me|changeme)/i.test(
        userAgent,
      ),
  );
}

function invalidProviderOrigin(
  raw: string,
  environment: string,
  allowLocalhost: boolean,
) {
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    return (
      parsed.pathname !== "/" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      (parsed.protocol !== "https:" &&
        !(
          environment === "preview" &&
          local &&
          allowLocalhost &&
          parsed.protocol === "http:"
        )) ||
      (environment === "production" && local)
    );
  } catch {
    return true;
  }
}

export type ReleaseEnvironment = Record<string, string | undefined>;

export type ReleasePreflightOptions = {
  mountInfo?: string;
  writableDataDirectory?: boolean;
};

export function validateReleaseEnvironment(
  env: ReleaseEnvironment,
  options: ReleasePreflightOptions = {},
): string[] {
  const problems: string[] = [];
  const domain = env.REACH_DOMAIN;
  const origin = env.REACH_APP_ORIGIN;
  const profile = env.REACH_RELEASE_PROFILE || "core";
  const environment = env.REACH_ENVIRONMENT || "production";

  if (!domain || domain.trim() !== domain || /[/:?#@\s]/.test(domain)) {
    problems.push(
      "REACH_DOMAIN must be a hostname without a scheme, path, or port.",
    );
  }
  if (!origin) {
    problems.push("REACH_APP_ORIGIN must be set to the public HTTPS origin.");
  } else if (domain && origin !== `https://${domain}`) {
    problems.push(
      "REACH_APP_ORIGIN must equal https://REACH_DOMAIN with no trailing slash.",
    );
  }
  if (
    domain &&
    !/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/.test(
      domain,
    )
  ) {
    problems.push("REACH_DOMAIN must be a valid hostname.");
  }
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        problems.push(
          "REACH_APP_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment.",
        );
      }
    } catch {
      problems.push("REACH_APP_ORIGIN must be a valid HTTPS origin.");
    }
  }

  if (profile !== "core" && profile !== "extended") {
    problems.push("REACH_RELEASE_PROFILE must be core or extended.");
  }
  if (environment !== "production" && environment !== "preview") {
    problems.push("REACH_ENVIRONMENT must be production or preview.");
  }
  if (profile === "core") {
    for (const [name, value] of Object.entries(env)) {
      if (
        name.startsWith("REACH_RELEASE_") &&
        name !== "REACH_RELEASE_PROFILE" &&
        value === "true"
      ) {
        problems.push(`${name} must be false for the core release profile.`);
      }
    }
  }
  const processRole = env.REACH_PROCESS_ROLE || "app";
  if (processRole !== "app" && processRole !== "email-worker") {
    problems.push("REACH_PROCESS_ROLE must be app or email-worker.");
  }
  if (processRole === "email-worker") {
    if (profile !== "extended") {
      problems.push(
        "The email worker requires REACH_RELEASE_PROFILE=extended.",
      );
    }
    if (env.REACH_RELEASE_EMAIL !== "true") {
      problems.push("The email worker requires REACH_RELEASE_EMAIL=true.");
    }
    if (!env.REACH_EMAIL_PROVIDER || env.REACH_EMAIL_PROVIDER === "disabled") {
      problems.push("The email worker requires a configured email provider.");
    }
  }

  const database = env.REACH_COMMUNITY_DB;
  if (database !== expectedDatabase) {
    problems.push(
      "REACH_COMMUNITY_DB must use the persistent /var/lib/reach/community.sqlite path.",
    );
  }

  const routerMode = env.OSM_ROUTER_MODE || "disabled";
  if (
    !(["disabled", "valhalla", "valhalla-demo"] as string[]).includes(
      routerMode,
    )
  ) {
    problems.push(
      "OSM_ROUTER_MODE must be disabled, valhalla, or valhalla-demo.",
    );
  }
  if (routerMode === "valhalla") {
    if (!env.OSM_ROUTER_URL) {
      problems.push(
        "OSM_ROUTER_URL must select the hosted or self-hosted Valhalla service.",
      );
    } else {
      if (
        invalidProviderOrigin(
          env.OSM_ROUTER_URL,
          environment,
          env.OSM_ALLOW_LOCALHOST === "true",
        )
      ) {
        problems.push(
          "OSM_ROUTER_URL must be an HTTPS origin without credentials, path, query, or fragment; HTTP localhost is allowed only in an opted-in preview.",
        );
      }
    }
  }
  if (routerMode === "valhalla-demo") {
    if (environment !== "preview") {
      problems.push(
        "OSM_ROUTER_MODE=valhalla-demo is preview-only and cannot be used in production.",
      );
    }
    if (env.REACH_ROUTER_DEMO_ACKNOWLEDGED !== "true") {
      problems.push(
        "Set REACH_ROUTER_DEMO_ACKNOWLEDGED=true to acknowledge preview-only routing limits.",
      );
    }
  }

  const configuredGeocoder = env.OSM_GEOCODER_URL?.trim() || "";
  const geocoderEnabled =
    Boolean(configuredGeocoder) || env.OSM_NOMINATIM_SINGLE_INSTANCE === "true";
  const geocoderBase = configuredGeocoder || publicNominatimOrigin;
  if (geocoderEnabled) {
    let publicNominatim = false;
    try {
      const parsed = new URL(geocoderBase);
      publicNominatim =
        parsed.hostname.toLowerCase().replace(/\.$/, "") ===
        "nominatim.openstreetmap.org";
    } catch {
      // The origin check below reports the malformed URL without echoing it.
    }
    if (
      invalidProviderOrigin(
        geocoderBase,
        environment,
        env.OSM_ALLOW_LOCALHOST === "true",
      )
    ) {
      problems.push(
        "OSM_GEOCODER_URL must be an HTTPS origin without credentials, path, query, or fragment; HTTP localhost is allowed only in an opted-in preview.",
      );
    }
    if (publicNominatim) {
      if (env.OSM_NOMINATIM_SINGLE_INSTANCE !== "true") {
        problems.push(
          "Public Nominatim requires OSM_NOMINATIM_SINGLE_INSTANCE=true.",
        );
      }
      if (geocoderBase !== publicNominatimOrigin) {
        problems.push(
          "Public Nominatim must use the exact https://nominatim.openstreetmap.org origin.",
        );
      }
    }
  }

  if (
    geocoderEnabled ||
    routerMode === "valhalla" ||
    routerMode === "valhalla-demo"
  ) {
    if (!validOsmUserAgent(env.OSM_USER_AGENT)) {
      problems.push(
        "OSM_USER_AGENT must identify Reach and include a real project URL or contact email; replace all template values.",
      );
    }
  }

  if (options.mountInfo !== undefined) {
    const mounted = options.mountInfo.split("\n").some((line) => {
      const separator = line.indexOf(" - ");
      if (separator < 0) return false;
      const fields = line.slice(0, separator).split(" ");
      const fileSystem = line.slice(separator + 3).split(" ")[0];
      return (
        fields[4]?.replaceAll("\\040", " ") === "/var/lib/reach" &&
        fileSystem !== "tmpfs" &&
        fileSystem !== "ramfs"
      );
    });
    if (!mounted)
      problems.push(
        "/var/lib/reach must be a mounted persistent volume; tmpfs and ramfs are not durable.",
      );
  }
  if (options.writableDataDirectory === false) {
    problems.push(
      "The persistent database directory must be writable by the application user.",
    );
  }

  return problems;
}

async function verifyRuntimeStorage() {
  const mountInfo = await readFile("/proc/self/mountinfo", "utf8").catch(
    () => "",
  );
  const writable = await access("/var/lib/reach", constants.W_OK)
    .then(() => true)
    .catch(() => false);
  const probePath = `/var/lib/reach/.release-preflight-${randomUUID()}`;
  let probe: FileHandle | undefined;
  let wroteProbe = false;
  try {
    probe = await open(probePath, "wx", 0o600);
    await probe.writeFile(Buffer.alloc(4096));
    await probe.sync();
    wroteProbe = true;
  } catch {
    // A write or sync failure is reported as an unavailable writable volume.
  } finally {
    await probe?.close().catch(() => undefined);
    if (probe) await unlink(probePath).catch(() => undefined);
  }
  return { mountInfo, writableDataDirectory: writable && wroteProbe };
}

export async function runReleasePreflight(
  env: ReleaseEnvironment = process.env,
) {
  const storage = await verifyRuntimeStorage();
  const problems = validateReleaseEnvironment(env, storage);
  if (problems.length) {
    console.error(
      `Release preflight failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
    process.exitCode = 1;
    return false;
  }
  console.log(
    `Release preflight passed (profile ${env.REACH_RELEASE_PROFILE || "core"}; environment ${env.REACH_ENVIRONMENT || "production"}).`,
  );
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runReleasePreflight();
}
