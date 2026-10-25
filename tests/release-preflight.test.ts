import { describe, expect, it } from "vitest";
import {
  validateReleaseEnvironment,
  type ReleaseEnvironment,
  type ReleasePreflightOptions,
} from "../scripts/release-preflight";

const volumeMount =
  "41 30 0:37 / /var/lib/reach rw,relatime - overlay overlay rw";

function validEnvironment(
  overrides: Record<string, string> = {},
): ReleaseEnvironment {
  return {
    REACH_DOMAIN: "reach.example.org",
    REACH_APP_ORIGIN: "https://reach.example.org",
    REACH_RELEASE_PROFILE: "core",
    REACH_ENVIRONMENT: "production",
    REACH_COMMUNITY_DB: "/var/lib/reach/community.sqlite",
    REACH_COMMUNITY_ENABLED: "false",
    REACH_ACCOUNT_ENABLED: "false",
    REACH_EMAIL_PROVIDER: "disabled",
    REACH_AI_PROVIDER: "disabled",
    OSM_ROUTER_MODE: "disabled",
    ...overrides,
  };
}

function issues(
  env: ReleaseEnvironment = validEnvironment(),
  options: ReleasePreflightOptions = { mountInfo: volumeMount },
) {
  return validateReleaseEnvironment(env, options);
}

describe("release preflight", () => {
  it("accepts a core production setup with the expected mounted database path", () => {
    expect(issues()).toEqual([]);
  });

  it("requires the public HTTPS origin to match the configured domain exactly", () => {
    expect(
      issues(
        validEnvironment({ REACH_APP_ORIGIN: "http://reach.example.org" }),
      ),
    ).toContain(
      "REACH_APP_ORIGIN must equal https://REACH_DOMAIN with no trailing slash.",
    );
    expect(
      issues(
        validEnvironment({ REACH_APP_ORIGIN: "https://other.example.org" }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      issues(
        validEnvironment({ REACH_APP_ORIGIN: "https://reach.example.org/" }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("requires the durable database path and mounted writable volume", () => {
    expect(
      issues(validEnvironment({ REACH_COMMUNITY_DB: "/tmp/community.sqlite" })),
    ).toContain(
      "REACH_COMMUNITY_DB must use the persistent /var/lib/reach/community.sqlite path.",
    );
    expect(
      validateReleaseEnvironment(validEnvironment(), {
        mountInfo: "",
        writableDataDirectory: true,
      }),
    ).toContain(
      "/var/lib/reach must be a mounted persistent volume; tmpfs and ramfs are not durable.",
    );
    for (const fileSystem of ["tmpfs", "ramfs"]) {
      expect(
        validateReleaseEnvironment(validEnvironment(), {
          mountInfo: `41 30 0:37 / /var/lib/reach rw - ${fileSystem} ${fileSystem} rw`,
          writableDataDirectory: true,
        }),
      ).toContain(
        "/var/lib/reach must be a mounted persistent volume; tmpfs and ramfs are not durable.",
      );
    }
    expect(
      validateReleaseEnvironment(validEnvironment(), {
        mountInfo: volumeMount,
        writableDataDirectory: false,
      }),
    ).toContain(
      "The persistent database directory must be writable by the application user.",
    );
  });

  it("does not require optional provider settings for the hard-off core profile", () => {
    expect(
      issues({
        REACH_DOMAIN: "reach.example.org",
        REACH_APP_ORIGIN: "https://reach.example.org",
        REACH_RELEASE_PROFILE: "core",
        REACH_COMMUNITY_DB: "/var/lib/reach/community.sqlite",
        OSM_ROUTER_MODE: "disabled",
      }),
    ).toEqual([]);
  });

  it("rejects each enabled release attestation independently in core", () => {
    for (const name of [
      "REACH_RELEASE_ACCOUNTS",
      "REACH_RELEASE_GOOGLE",
      "REACH_RELEASE_EMAIL",
      "REACH_RELEASE_COMMUNITY",
      "REACH_RELEASE_VOLUNTEERING",
      "REACH_RELEASE_AI",
    ]) {
      expect(issues(validEnvironment({ [name]: "true" }))).toContain(
        `${name} must be false for the core release profile.`,
      );
    }
  });

  it("allows configured optional features in the explicit extended profile", () => {
    expect(
      issues(
        validEnvironment({
          REACH_RELEASE_PROFILE: "extended",
          REACH_COMMUNITY_ENABLED: "true",
          REACH_ACCOUNT_ENABLED: "true",
          REACH_EMAIL_PROVIDER: "smtp",
          REACH_AI_PROVIDER: "deepseek",
          REACH_RELEASE_ACCOUNTS: "true",
          REACH_RELEASE_AI: "true",
        }),
      ),
    ).toEqual([]);
  });

  it("requires an explicitly enabled provider before the email worker can start", () => {
    expect(
      issues(
        validEnvironment({
          REACH_PROCESS_ROLE: "email-worker",
          REACH_EMAIL_PROVIDER: "disabled",
        }),
      ),
    ).toContain("The email worker requires REACH_RELEASE_PROFILE=extended.");
    expect(
      issues(
        validEnvironment({
          REACH_RELEASE_PROFILE: "extended",
          REACH_PROCESS_ROLE: "email-worker",
          REACH_RELEASE_EMAIL: "true",
          REACH_EMAIL_PROVIDER: "smtp",
        }),
      ),
    ).toEqual([]);
  });

  it("requires a configured Valhalla endpoint and rejects public demo routing in production", () => {
    expect(issues(validEnvironment({ OSM_ROUTER_MODE: "valhalla" }))).toContain(
      "OSM_ROUTER_URL must select the hosted or self-hosted Valhalla service.",
    );
    expect(
      issues(
        validEnvironment({
          OSM_ROUTER_MODE: "valhalla-demo",
          REACH_ROUTER_DEMO_ACKNOWLEDGED: "true",
        }),
      ),
    ).toContain(
      "OSM_ROUTER_MODE=valhalla-demo is preview-only and cannot be used in production.",
    );
  });

  it("accepts production Valhalla only at a configured HTTPS origin", () => {
    expect(
      issues(
        validEnvironment({
          OSM_ROUTER_MODE: "valhalla",
          OSM_ROUTER_URL: "https://router.example.org",
          OSM_USER_AGENT: "Reach (https://reach.org; contact: maps@reach.org)",
        }),
      ),
    ).toEqual([]);
    for (const url of [
      "http://router.example.org",
      "https://router.example.org/routes",
      "https://router.example.org?key=private",
      "https://localhost",
    ]) {
      expect(
        issues(
          validEnvironment({
            OSM_ROUTER_MODE: "valhalla",
            OSM_ROUTER_URL: url,
            OSM_USER_AGENT:
              "Reach (https://reach.org; contact: maps@reach.org)",
          }),
        ),
      ).toContain(
        "OSM_ROUTER_URL must be an HTTPS origin without credentials, path, query, or fragment; HTTP localhost is allowed only in an opted-in preview.",
      );
    }
  });

  it("permits HTTP localhost only in an opted-in preview", () => {
    const previewRouter = {
      REACH_ENVIRONMENT: "preview",
      OSM_ROUTER_MODE: "valhalla",
      OSM_ROUTER_URL: "http://localhost:8002",
      OSM_ALLOW_LOCALHOST: "true",
      OSM_USER_AGENT: "Reach (https://reach.org; contact: maps@reach.org)",
    };
    expect(issues(validEnvironment(previewRouter))).toEqual([]);
    expect(
      issues(
        validEnvironment({
          ...previewRouter,
          OSM_ALLOW_LOCALHOST: "false",
        }),
      ),
    ).toContain(
      "OSM_ROUTER_URL must be an HTTPS origin without credentials, path, query, or fragment; HTTP localhost is allowed only in an opted-in preview.",
    );
  });

  it("allows demo routing only in an explicitly acknowledged preview", () => {
    expect(
      issues(
        validEnvironment({
          REACH_ENVIRONMENT: "preview",
          OSM_ROUTER_MODE: "valhalla-demo",
          REACH_ROUTER_DEMO_ACKNOWLEDGED: "true",
          OSM_USER_AGENT: "Reach (https://reach.org; contact: maps@reach.org)",
        }),
      ),
    ).toEqual([]);
    expect(
      issues(
        validEnvironment({
          REACH_ENVIRONMENT: "preview",
          OSM_ROUTER_MODE: "valhalla-demo",
          OSM_USER_AGENT: "Reach (https://reach.org; contact: maps@reach.org)",
        }),
      ),
    ).toContain(
      "Set REACH_ROUTER_DEMO_ACKNOWLEDGED=true to acknowledge preview-only routing limits.",
    );
  });

  it("requires public Nominatim opt-in, the exact HTTPS origin, and a real identifying user agent", () => {
    expect(
      issues(
        validEnvironment({
          OSM_GEOCODER_URL: "https://nominatim.openstreetmap.org",
          OSM_USER_AGENT: "Reach (https://reach.org; contact: maps@reach.org)",
        }),
      ),
    ).toContain(
      "Public Nominatim requires OSM_NOMINATIM_SINGLE_INSTANCE=true.",
    );
    expect(
      issues(
        validEnvironment({
          OSM_GEOCODER_URL: "https://NOMINATIM.OPENSTREETMAP.ORG.",
          OSM_NOMINATIM_SINGLE_INSTANCE: "true",
          OSM_USER_AGENT: "Reach (https://reach.org; contact: maps@reach.org)",
        }),
      ),
    ).toContain(
      "Public Nominatim must use the exact https://nominatim.openstreetmap.org origin.",
    );
    expect(
      issues(
        validEnvironment({
          OSM_GEOCODER_URL: "https://nominatim.openstreetmap.org",
          OSM_NOMINATIM_SINGLE_INSTANCE: "true",
          OSM_USER_AGENT: "Reach (https://reach.org; contact: maps@reach.org)",
        }),
      ),
    ).toEqual([]);
  });

  it("requires a non-placeholder identifying user agent for configured providers", () => {
    const geocoder = { OSM_GEOCODER_URL: "https://geocoder.reach.org" };
    expect(issues(validEnvironment(geocoder))).toContain(
      "OSM_USER_AGENT must identify Reach and include a real project URL or contact email; replace all template values.",
    );
    expect(
      issues(
        validEnvironment({
          ...geocoder,
          OSM_USER_AGENT:
            "Reach (https://example.org; contact: maps@example.org)",
        }),
      ),
    ).toContain(
      "OSM_USER_AGENT must identify Reach and include a real project URL or contact email; replace all template values.",
    );
    expect(
      issues(
        validEnvironment({
          ...geocoder,
          OSM_USER_AGENT: "Reach (https://reach.org; contact: maps@reach.org)",
        }),
      ),
    ).toEqual([]);
  });

  it("does not include configured secret values in validation errors", () => {
    const secret = "do-not-print-this-token";
    expect(
      issues(validEnvironment({ SMTP_PASSWORD: secret })).join(" "),
    ).not.toContain(secret);
  });
});
